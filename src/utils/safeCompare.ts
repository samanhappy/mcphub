import { timingSafeEqual } from 'crypto';

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Returns true if both strings are equal.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  const areSameLength = bufA.length === bufB.length;
  // If lengths differ, compare bufA with itself so timingSafeEqual always
  // runs in time proportional to the secret's length, preventing length leakage.
  const bufToCompare = areSameLength ? bufB : bufA;

  const result = timingSafeEqual(bufA, bufToCompare);

  return areSameLength && result;
}
