import type { BearerKey } from '../types/index.js';

export const MIN_BEARER_KEY_EXPIRES_IN_DAYS = 1;
export const MAX_BEARER_KEY_EXPIRES_IN_DAYS = 3650;
const MS_PER_DAY = 86_400_000;

export type ExpiryParseResult =
  | { ok: true; specified: false }
  | { ok: true; specified: true; expiresAt: string | null }
  | { ok: false; message: string };

/**
 * Normalize an unknown timestamp (Date or ISO string) into a UTC ISO-8601 string or undefined.
 */
export const normalizeBearerKeyTimestamp = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
  }
  return undefined;
};

/**
 * Returns true if the key has an expiry timestamp and `now` is at or past it.
 * Keys without `expiresAt` never expire.
 */
export const isBearerKeyExpired = (
  key: Pick<BearerKey, 'expiresAt'>,
  now: Date = new Date(),
): boolean => {
  if (!key.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(key.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    // Fail closed if a corrupted non-empty expiry string is ever stored.
    return true;
  }
  return now.getTime() >= expiresAtMs;
};

/**
 * Parse and validate optional expiry fields (`expiresInDays` or `expiresAt`) from a request body.
 *
 * - Omitting both fields returns `{ ok: true, specified: false }` so callers can preserve the
 *   existing value on edit/reset or default to no expiry on create.
 * - Passing `expiresInDays: null` or `expiresAt: null` explicitly clears expiry (`expiresAt: null`).
 * - Passing `expiresInDays` as an integer in `[1, 3650]` computes a UTC ISO timestamp from `now`.
 * - Passing `expiresAt` as a valid ISO timestamp string normalizes it to UTC ISO-8601.
 */
export const parseBearerKeyExpiryInput = (
  body: Record<string, unknown> | undefined,
  now: Date = new Date(),
): ExpiryParseResult => {
  if (!body || typeof body !== 'object') {
    return { ok: true, specified: false };
  }

  const hasDays = Object.prototype.hasOwnProperty.call(body, 'expiresInDays') && body.expiresInDays !== undefined;
  const hasDate = Object.prototype.hasOwnProperty.call(body, 'expiresAt') && body.expiresAt !== undefined;

  if (!hasDays && !hasDate) {
    return { ok: true, specified: false };
  }

  if (hasDays && hasDate) {
    return {
      ok: false,
      message: 'Specify either expiresInDays or expiresAt, not both',
    };
  }

  if (hasDays) {
    const rawDays = body.expiresInDays;
    if (rawDays === null) {
      return { ok: true, specified: true, expiresAt: null };
    }
    if (
      typeof rawDays !== 'number' ||
      !Number.isInteger(rawDays) ||
      rawDays < MIN_BEARER_KEY_EXPIRES_IN_DAYS ||
      rawDays > MAX_BEARER_KEY_EXPIRES_IN_DAYS
    ) {
      return {
        ok: false,
        message: `expiresInDays must be an integer between ${MIN_BEARER_KEY_EXPIRES_IN_DAYS} and ${MAX_BEARER_KEY_EXPIRES_IN_DAYS}`,
      };
    }
    return {
      ok: true,
      specified: true,
      expiresAt: new Date(now.getTime() + rawDays * MS_PER_DAY).toISOString(),
    };
  }

  const rawDate = body.expiresAt;
  if (rawDate === null) {
    return { ok: true, specified: true, expiresAt: null };
  }
  if (typeof rawDate !== 'string' || rawDate.trim().length === 0) {
    return { ok: false, message: 'expiresAt must be an ISO-8601 UTC date string or null' };
  }
  const parsed = Date.parse(rawDate);
  if (Number.isNaN(parsed)) {
    return { ok: false, message: 'Invalid expiresAt timestamp' };
  }
  return {
    ok: true,
    specified: true,
    expiresAt: new Date(parsed).toISOString(),
  };
};
