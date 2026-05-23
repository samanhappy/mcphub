import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

const SIGNATURE_HEADER = 'x-internal-signature';
const TIMESTAMP_HEADER = 'x-internal-timestamp';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export { SIGNATURE_HEADER, TIMESTAMP_HEADER, REPLAY_WINDOW_MS };

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
  body = '',
): { timestamp: string; signature: string } {
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', getSecret())
    .update(payload(timestamp, method, path, body))
    .digest('hex');
  return { timestamp, signature: `sha256=${signature}` };
}

export function verifyInternalSignature(opts: {
  method: string;
  path: string;
  body: string;
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
      .update(payload(opts.timestamp, opts.method, opts.path, opts.body))
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
  body: string,
): { ok: true } | { ok: false; reason: string } {
  return verifyInternalSignature({
    method: req.method,
    path: req.path,
    body,
    timestamp: req.header(TIMESTAMP_HEADER),
    signature: req.header(SIGNATURE_HEADER),
  });
}
