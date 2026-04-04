import rateLimit from 'express-rate-limit';

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.JEST_WORKER_ID !== undefined ||
  process.env.VITEST_WORKER_ID !== undefined;

export const createStandardRateLimiter = (options: {
  windowMs: number;
  max: number;
}) =>
  rateLimit({
    ...options,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTestEnv,
  });

export const templateRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

export const authenticatedRouteRateLimiter = createStandardRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
});

export const mcpConnectionRateLimiter = createStandardRateLimiter({
  windowMs: 60 * 1000,
  max: 240,
});