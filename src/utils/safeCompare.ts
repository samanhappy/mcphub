import { timingSafeEqual } from 'crypto';

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Returns true if both strings are equal.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid leaking length info via early return timing
    timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
