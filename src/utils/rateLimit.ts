import rateLimit from 'express-rate-limit';

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.JEST_WORKER_ID !== undefined ||
  process.env.VITEST_WORKER_ID !== undefined;

export const createStandardRateLimiter = (options: {
  windowMs: number;
  max: number;
  skipSuccessfulRequests?: boolean;
}) =>
  rateLimit({
    ...options,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTestEnv,
  });

export const templateRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 200,
});

export const authenticatedRouteRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 600,
});

export const hostedInternalEventRateLimiter = createStandardRateLimiter({
  windowMs: 60 * 1000,
  max: 600,
});

export const mcpConnectionRateLimiter = createStandardRateLimiter({
  windowMs: 60 * 1000,
  max: 480,
});

// Only rejected attempts consume this budget. Counting successful logins would lock out
// API clients and service accounts that legitimately re-authenticate in bursts, for
// example after a restart invalidated their cached tokens.
export const authAttemptRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
});

export const spaPageRateLimiter = createStandardRateLimiter({
  windowMs: 60 * 1000,
  max: 600,
});
