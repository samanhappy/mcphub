import { createHash } from 'node:crypto';
import type { BearerKey } from '../types/index.js';
import { safeCompare } from './safeCompare.js';

// shortcut: plain SHA-256 is enough because generated tokens carry 256 bits of entropy;
// switch to HMAC with a server secret if user-chosen (low-entropy) tokens are ever allowed.
export const hashBearerToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const bearerTokenPrefix = (token: string): string => token.slice(0, 8);

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
export const maskBearerKey = (key: Pick<BearerKey, 'token' | 'tokenPrefix'>): string =>
  `${key.tokenPrefix ?? key.token?.slice(0, 8) ?? ''}...`;
