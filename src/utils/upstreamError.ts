import type { ServerConfig } from '../types/index.js';
import {
  formatErrorForLogging,
  sanitizeStringForLogging,
  summarizeErrorForLogging,
} from './serialization.js';

/** A safe diagnostic that can cross both the logging and client-response boundaries. */
export class UpstreamRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamRequestError';
  }
}

export const createUpstreamRequestError = (
  server: string,
  operation: string,
  error: unknown,
  config: ServerConfig,
): UpstreamRequestError => {
  // Personal values can be opaque strings with no recognizable token shape.
  // Remove them before formatting/truncation, including URL-encoded echoes.
  const secrets = (config.credentialTemplate ?? [])
    .map((slot) => config[slot.target]?.[slot.name])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .flatMap((value) => [value, value.replace(/^(?:Bearer|Basic)\s+/i, '')])
    .flatMap((value) => {
      const variants = [value, JSON.stringify(value).slice(1, -1)];
      try {
        variants.push(encodeURIComponent(value));
      } catch {
        // A credential can contain an unpaired surrogate; literal redaction still applies.
      }
      return variants;
    })
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length);
  const redact = (value: string): string => {
    for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
    return sanitizeStringForLogging(value).slice(0, 2048);
  };
  // Never attach the original cause/config/body/stack to the safe error.
  const record =
    error && typeof error === 'object'
      ? (error as {
          message?: unknown;
          name?: unknown;
          code?: unknown;
          status?: unknown;
          response?: { status?: unknown; headers?: Record<string, unknown> };
        })
      : undefined;
  const requestId =
    record?.response?.headers?.['x-request-id'] ??
    record?.response?.headers?.['request-id'] ??
    record?.response?.headers?.['x-ms-request-id'] ??
    record?.response?.headers?.['x-correlation-id'];
  const summary = summarizeErrorForLogging({
    name: typeof record?.name === 'string' ? redact(record.name) : 'Error',
    message: redact(
      typeof record?.message === 'string'
        ? record.message
        : typeof error === 'string'
          ? error
          : 'Upstream request failed',
    ),
    code: typeof record?.code === 'string' ? redact(record.code) : record?.code,
    status: record?.status ?? record?.response?.status,
    requestId: typeof requestId === 'string' ? redact(requestId) : undefined,
  });
  return new UpstreamRequestError(
    `Upstream '${redact(server)}' ${operation} failed: ${formatErrorForLogging(summary)}`,
  );
};

export const isUpstreamConnectionFailure = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === 'string' && ['ECONNRESET', 'EPIPE', 'ENOTCONN', 'ECONNREFUSED'].includes(code)
  );
};
