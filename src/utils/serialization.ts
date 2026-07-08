/**
 * Utility functions for safe JSON serialization
 * Handles circular references and provides type-safe serialization
 */

const REDACTED_VALUE = '[REDACTED]';
const REMOTE_ERROR_REDACTED_MESSAGE = '[Remote request failed; response details omitted]';

const SENSITIVE_LOG_KEY_NAMES = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'token',
  'clientsecret',
  'secret',
  'password',
  'apikey',
  'xapikey',
  'initialaccesstoken',
  'registrationaccesstoken',
  'codeverifier',
  'privatekey',
  'assertion',
  'errordescription',
  'erroruri',
  'errorcode',
]);

const SENSITIVE_INLINE_KEY_PATTERN =
  'access_token|refresh_token|id_token|client_secret|api_key|token|password|authorization|secret|error_description|error_uri|error_code|code_verifier|codeverifier';

const AUTHORIZATION_CREDENTIAL_RE =
  /((?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+)[^\s",;]+/gi;
const BEARER_BASIC_CREDENTIAL_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi;
const SENSITIVE_QUERY_PARAM_RE = new RegExp(
  `([?&](?:${SENSITIVE_INLINE_KEY_PATTERN})=)[^&#\\s",;]+`,
  'gi',
);
const SENSITIVE_EQUALS_RE = new RegExp(
  `(\\b(?:${SENSITIVE_INLINE_KEY_PATTERN})\\s*[:=]\\s*)[^\\s",;]+`,
  'gi',
);
const SENSITIVE_JSON_DOUBLE_QUOTE_RE = new RegExp(
  `("(?:${SENSITIVE_INLINE_KEY_PATTERN})"\\s*:\\s*")([^"]*)(")`,
  'gi',
);
const SENSITIVE_JSON_SINGLE_QUOTE_RE = new RegExp(
  `('(?:${SENSITIVE_INLINE_KEY_PATTERN})'\\s*:\\s*')([^']*)(')`,
  'gi',
);

const normalizeKey = (key: string): string => key.replace(/[^a-z0-9]/gi, '').toLowerCase();

const isSensitiveLogKey = (key: string): boolean => {
  if (!key) {
    return false;
  }

  const normalizedKey = normalizeKey(key);
  return (
    SENSITIVE_LOG_KEY_NAMES.has(normalizedKey) ||
    normalizedKey.endsWith('token') ||
    normalizedKey.endsWith('secret') ||
    normalizedKey.endsWith('password') ||
    normalizedKey.endsWith('authorization') ||
    normalizedKey.endsWith('cookie')
  );
};

export const sanitizeStringForLogging = (value: string): string => {
  let sanitized = value;

  sanitized = sanitized.replace(AUTHORIZATION_CREDENTIAL_RE, `$1${REDACTED_VALUE}`);
  sanitized = sanitized.replace(BEARER_BASIC_CREDENTIAL_RE, `$1 ${REDACTED_VALUE}`);
  sanitized = sanitized.replace(SENSITIVE_QUERY_PARAM_RE, `$1${REDACTED_VALUE}`);
  sanitized = sanitized.replace(SENSITIVE_EQUALS_RE, `$1${REDACTED_VALUE}`);
  sanitized = sanitized.replace(SENSITIVE_JSON_DOUBLE_QUOTE_RE, `$1${REDACTED_VALUE}$3`);
  sanitized = sanitized.replace(SENSITIVE_JSON_SINGLE_QUOTE_RE, `$1${REDACTED_VALUE}$3`);

  return sanitized;
};

const isRemoteHttpError = (error: Error): boolean => {
  const candidate = error as Error & {
    status?: number;
    response?: { status?: number };
    request?: unknown;
    config?: unknown;
  };

  return (
    typeof candidate.status === 'number' ||
    typeof candidate.response?.status === 'number' ||
    candidate.request !== undefined ||
    candidate.config !== undefined
  );
};

const serializeRemoteError = (error: Error): Record<string, unknown> => {
  const candidate = error as Error & {
    code?: string;
    status?: number;
    response?: {
      status?: number;
      data?: unknown;
      headers?: Record<string, unknown>;
    };
  };
  const requestId =
    candidate.response?.headers?.['x-request-id'] ??
    candidate.response?.headers?.['request-id'] ??
    candidate.response?.headers?.['x-ms-request-id'] ??
    candidate.response?.headers?.['x-correlation-id'];

  return {
    name: error.name,
    message: REMOTE_ERROR_REDACTED_MESSAGE,
    code: candidate.code,
    status: typeof candidate.status === 'number' ? candidate.status : candidate.response?.status,
    requestId: typeof requestId === 'string' ? requestId : undefined,
    hasResponseBody: candidate.response?.data !== undefined,
  };
};

const serializeError = (error: Error): Record<string, unknown> => {
  if (isRemoteHttpError(error)) {
    return serializeRemoteError(error);
  }

  const serialized: Record<string, unknown> = {};

  Object.getOwnPropertyNames(error).forEach((propertyName) => {
    serialized[propertyName] = Reflect.get(error, propertyName) as unknown;
  });

  serialized.name = serialized.name ?? error.name;

  return serialized;
};

const summarizeSerializedErrorForLogging = (
  serialized: Record<string, unknown>,
): Record<string, unknown> => {
  const summary: Record<string, unknown> = {};

  ['name', 'message', 'stack', 'requestId'].forEach((key) => {
    if (typeof serialized[key] === 'string') {
      summary[key] = sanitizeStringForLogging(serialized[key]);
    }
  });
  if (typeof serialized.code === 'string') {
    summary.code = sanitizeStringForLogging(serialized.code);
  } else if (typeof serialized.code === 'number') {
    summary.code = serialized.code;
  }
  if (typeof serialized.status === 'number') {
    summary.status = serialized.status;
  }
  if (typeof serialized.hasResponseBody === 'boolean') {
    summary.hasResponseBody = serialized.hasResponseBody;
  }

  return summary;
};

export const summarizeErrorForLogging = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return summarizeSerializedErrorForLogging(serializeError(error));
  }

  if (typeof error === 'string') {
    return { message: sanitizeStringForLogging(error) };
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const summary: Record<string, unknown> = {};

    if (typeof record.name === 'string') {
      summary.name = sanitizeStringForLogging(record.name);
    }
    if (typeof record.message === 'string') {
      summary.message = sanitizeStringForLogging(record.message);
    }
    if (typeof record.code === 'string') {
      summary.code = sanitizeStringForLogging(record.code);
    } else if (typeof record.code === 'number') {
      summary.code = record.code;
    }
    if (typeof record.status === 'number') {
      summary.status = record.status;
    }
    if (typeof record.requestId === 'string') {
      summary.requestId = sanitizeStringForLogging(record.requestId);
    }

    if (Object.keys(summary).length > 0) {
      return summary;
    }

    const keys = Object.keys(record);
    return {
      type: 'object',
      keyCount: keys.length,
      keys: keys.slice(0, 10),
      truncated: keys.length > 10 || undefined,
    };
  }

  if (error === undefined) {
    return { message: 'undefined' };
  }

  if (error === null) {
    return { message: 'null' };
  }

  return {
    message: sanitizeStringForLogging(String(error)),
  };
};

export const formatErrorForLogging = (error: unknown): string => {
  const summary = summarizeErrorForLogging(error);
  const parts: string[] = [];

  if (typeof summary.name === 'string') {
    parts.push(summary.name);
  }
  if (typeof summary.message === 'string') {
    parts.push(summary.message);
  }
  if (summary.status !== undefined) {
    parts.push(`status=${summary.status}`);
  }
  if (typeof summary.code === 'string' || typeof summary.code === 'number') {
    parts.push(`code=${summary.code}`);
  }
  if (typeof summary.requestId === 'string') {
    parts.push(`requestId=${summary.requestId}`);
  }

  return parts.join(' | ') || 'Unknown error';
};

const CIRCULAR_REFERENCE = '[Circular Reference]';

/**
 * Tracks the chain of ancestors during a single JSON.stringify traversal so
 * that only true circular references (an object that contains itself, directly
 * or transitively) are flagged — not diamond/shared references where the same
 * object is reachable from two sibling keys.
 *
 * A naive `WeakSet` of every visited object cannot tell the two apart: it marks
 * a shared-but-acyclic object as circular the second time it is seen, silently
 * dropping data. JSON.stringify traverses depth-first and invokes the replacer
 * with `this` bound to the object that holds the current value, so we keep an
 * ancestor stack and unwind it back to the current holder before each check.
 */
const createAncestorTracker = () => {
  const stack: unknown[] = [];

  return {
    isCircular(holder: unknown, value: unknown): boolean {
      // Unwind to the current holder: siblings share a holder, so anything still
      // on the stack below it belongs to an already-finished branch.
      while (stack.length > 0 && stack[stack.length - 1] !== holder) {
        stack.pop();
      }

      if (stack.includes(value)) {
        return true;
      }

      stack.push(value);
      return false;
    },
    // When a value is replaced mid-traversal (an Error becomes a plain object),
    // swap it on the stack too. JSON.stringify walks the *replacement's*
    // properties next, passing it as the holder, so the stack must reference the
    // replacement or the unwind above would empty the stack and miss cycles that
    // close through the error.
    replace(oldValue: unknown, newValue: unknown): void {
      const index = stack.indexOf(oldValue);
      if (index !== -1) {
        stack[index] = newValue;
      }
    },
  };
};

const createSafeJsonReplacer = () => {
  const tracker = createAncestorTracker();
  // serializeError() returns a fresh object on each call, so a cyclic
  // Error.cause chain would keep producing new objects forever; this guard
  // breaks it independently of the ancestor stack.
  const seenErrors = new WeakSet<Error>();

  return function (this: unknown, _key: string, value: unknown): unknown {
    if (typeof value === 'object' && value !== null) {
      if (tracker.isCircular(this, value)) {
        return CIRCULAR_REFERENCE;
      }

      if (value instanceof Error) {
        if (seenErrors.has(value)) {
          return CIRCULAR_REFERENCE;
        }
        seenErrors.add(value);
        const serialized = serializeError(value);
        tracker.replace(value, serialized);
        return serialized;
      }
    }

    return value;
  };
};

const createSafeLogReplacer = () => {
  const tracker = createAncestorTracker();
  const seenErrors = new WeakSet<Error>();

  return function (this: unknown, key: string, value: unknown): unknown {
    if (isSensitiveLogKey(key)) {
      return REDACTED_VALUE;
    }

    if (typeof value === 'string') {
      return sanitizeStringForLogging(value);
    }

    if (typeof value === 'object' && value !== null) {
      if (tracker.isCircular(this, value)) {
        return CIRCULAR_REFERENCE;
      }

      if (value instanceof Error) {
        if (seenErrors.has(value)) {
          return CIRCULAR_REFERENCE;
        }
        seenErrors.add(value);
        const serialized = serializeError(value);
        tracker.replace(value, serialized);
        return serialized;
      }
    }

    return value;
  };
};

/**
 * Creates a JSON-safe copy of an object by removing circular references
 * Uses a replacer function with WeakSet to efficiently track visited objects
 *
 * @param obj - The object to make JSON-safe
 * @returns A new object that can be safely serialized to JSON
 */
export const createSafeJSON = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj, createSafeJsonReplacer()));
};

/**
 * Safe JSON stringifier that handles circular references
 * Useful for logging or debugging purposes
 *
 * @param obj - The object to stringify
 * @param space - Number of spaces to use for indentation (optional)
 * @returns JSON string representation of the object
 */
export const safeStringify = (obj: any, space?: number): string => {
  return JSON.stringify(obj, createSafeLogReplacer(), space);
};

/**
 * JSON stringifier that is safe against circular references and serializes
 * Error instances, but does NOT redact field values.
 *
 * Use this for persisting tool call input/output verbatim: heuristic
 * (key-name / regex) redaction produces both false positives that corrupt the
 * audit record and false negatives that give a misleading sense of safety, so
 * whether such payloads are stored at all is a deployment decision (config
 * switch) rather than something to guess at per field.
 *
 * @param obj - The object to stringify
 * @param space - Number of spaces to use for indentation (optional)
 * @returns JSON string representation of the object
 */
export const stringifyWithoutRedaction = (obj: any, space?: number): string => {
  return JSON.stringify(obj, createSafeJsonReplacer(), space);
};

/**
 * Removes specific properties that might contain circular references
 * More targeted approach for known problematic properties
 *
 * @param obj - The object to clean
 * @param excludeProps - Array of property names to exclude
 * @returns A new object without the specified properties
 */
export const excludeCircularProps = <T extends Record<string, any>>(
  obj: T,
  excludeProps: string[],
): Omit<T, keyof (typeof excludeProps)[number]> => {
  const result = { ...obj };
  excludeProps.forEach((prop) => {
    delete result[prop];
  });
  return result;
};
