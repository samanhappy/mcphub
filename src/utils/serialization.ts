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
  'privatekey',
  'assertion',
]);

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

  sanitized = sanitized.replace(
    /((?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+)[^\s",;]+/gi,
    `$1${REDACTED_VALUE}`,
  );
  sanitized = sanitized.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, `$1 ${REDACTED_VALUE}`);
  sanitized = sanitized.replace(
    /([?&](?:access_token|refresh_token|id_token|client_secret|api_key|token|password|authorization)=)[^&#\s"]+/gi,
    `$1${REDACTED_VALUE}`,
  );
  sanitized = sanitized.replace(
    /("(?:access_token|refresh_token|id_token|client_secret|api_key|authorization|token|password|secret)"\s*:\s*")([^"]*)(")/gi,
    `$1${REDACTED_VALUE}$3`,
  );
  sanitized = sanitized.replace(
    /('(?:access_token|refresh_token|id_token|client_secret|api_key|authorization|token|password|secret)'\s*:\s*')([^']*)(')/gi,
    `$1${REDACTED_VALUE}$3`,
  );

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
    status:
      typeof candidate.status === 'number' ? candidate.status : candidate.response?.status,
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

export const summarizeErrorForLogging = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return serializeError(error);
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
  if (typeof summary.code === 'string') {
    parts.push(`code=${summary.code}`);
  }
  if (typeof summary.requestId === 'string') {
    parts.push(`requestId=${summary.requestId}`);
  }

  return parts.join(' | ') || 'Unknown error';
};

const createSafeJsonReplacer = () => {
  const seen = new WeakSet<object>();

  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }

      seen.add(value);

      if (value instanceof Error) {
        return serializeError(value);
      }
    }

    return value;
  };
};

const createSafeLogReplacer = () => {
  const seen = new WeakSet<object>();

  return (key: string, value: unknown): unknown => {
    if (isSensitiveLogKey(key)) {
      return REDACTED_VALUE;
    }

    if (typeof value === 'string') {
      return sanitizeStringForLogging(value);
    }

    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }

      seen.add(value);

      if (value instanceof Error) {
        return serializeError(value);
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
