import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const SIGNATURE_HEADER = 'x-internal-signature';
const TIMESTAMP_HEADER = 'x-internal-timestamp';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const REDACTED_SIGNATURE_VALUE = '[REDACTED]';
const REDACTED_SIGNATURE_FIELDS = new Set(['apiKey', 'apiKeyId']);

export { SIGNATURE_HEADER, TIMESTAMP_HEADER, REPLAY_WINDOW_MS, REDACTED_SIGNATURE_VALUE };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function normalizeSignatureObject(value: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    if (REDACTED_SIGNATURE_FIELDS.has(key)) {
      // Sensitive credential values must never be read during signature canonicalization.
      normalized[key] = REDACTED_SIGNATURE_VALUE;
      continue;
    }

    normalized[key] = normalizeSignatureBody(value[key]);
  }

  return normalized;
}

function normalizeSignatureBody(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return normalizeSignatureBody(value.toString('utf8'));
  }

  if (typeof value === 'string') {
    if (!value) return '';

    try {
      return normalizeSignatureBody(JSON.parse(value));
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeSignatureBody(item));
  }

  if (isPlainObject(value)) {
    return normalizeSignatureObject(value);
  }

  return value;
}

export function serializeInternalRequestBodyForSignature(body?: unknown): string {
  if (body === undefined || body === null || body === '') {
    return '';
  }

  return JSON.stringify(normalizeSignatureBody(body));
}

function getSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('INTERNAL_API_SECRET is not configured or is shorter than 32 chars');
  }
  return secret;
}

function payload(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

export function signInternalRequest(
  method: string,
  path: string,
  body?: unknown,
): { timestamp: string; signature: string } {
  const timestamp = Date.now().toString();
  const serializedBody = serializeInternalRequestBodyForSignature(body);
  const signature = createHmac('sha256', getSecret())
    .update(payload(timestamp, method, path, serializedBody))
    .digest('hex');
  return { timestamp, signature: `sha256=${signature}` };
}

export function verifyInternalSignature(opts: {
  method: string;
  path: string;
  body?: unknown;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
}): { ok: true } | { ok: false; reason: string } {
  if (!opts.timestamp || !opts.signature) {
    return { ok: false, reason: 'missing_signature_headers' };
  }

  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'bad_timestamp' };
  }

  if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return { ok: false, reason: 'secret_not_configured' };
  }

  const expected =
    'sha256=' +
    createHmac('sha256', secret)
      .update(
        payload(
          opts.timestamp,
          opts.method,
          opts.path,
          serializeInternalRequestBodyForSignature(opts.body),
        ),
      )
      .digest('hex');

  const actualBuffer = Buffer.from(opts.signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true };
}

export function verifyInternalExpressRequest(
  req: Request,
  body?: unknown,
): { ok: true } | { ok: false; reason: string } {
  return verifyInternalSignature({
    method: req.method,
    path: req.path,
    body,
    timestamp: req.header(TIMESTAMP_HEADER),
    signature: req.header(SIGNATURE_HEADER),
  });
}
