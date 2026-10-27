import { createHash } from 'node:crypto';
import type { BearerKey } from '../types/index.js';
import { safeCompare } from './safeCompare.js';

// shortcut: plain SHA-256 is enough because generated tokens carry 256 bits of entropy;
// switch to HMAC with a server secret if user-chosen (low-entropy) tokens are ever allowed.
export const hashBearerToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

// Capped at a third of the token so short, user-chosen legacy keys are never shown whole.
export const bearerTokenPrefix = (token: string): string =>
  token.slice(0, Math.min(12, Math.floor(token.length / 3)));

/** Fields persisted for a key instead of the raw token. */
export const toStoredToken = (token: string) => ({
  tokenHash: hashBearerToken(token),
  tokenPrefix: bearerTokenPrefix(token),
});

/**
 * Constant-time match of a presented token against a key. Keys not yet migrated
 * (raw `token` still stored) are still accepted so upgrades never lock anyone out.
 */
export const bearerKeyMatches = (key: BearerKey, presented: string): boolean =>
  key.tokenHash
    ? safeCompare(key.tokenHash, hashBearerToken(presented))
    : !!key.token && safeCompare(key.token, presented);

/** Display form for API/CLI/UI listings; never reveals more than the prefix. */
export const maskBearerKey = (key: Pick<BearerKey, 'token' | 'tokenPrefix'>): string => {
  if (key.tokenPrefix) return `${key.tokenPrefix}...`;
  // not yet hashed: never reveal short (possibly user-chosen) secrets
  return !key.token || key.token.length <= 12 ? '********' : `${key.token.slice(0, 12)}...`;
};
