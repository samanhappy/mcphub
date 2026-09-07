import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { logger } from './logger.js';

// Self-contained so the limits below do not depend on this module being
// evaluated after src/config, which also loads the environment.
dotenv.config({ quiet: true });

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.JEST_WORKER_ID !== undefined ||
  process.env.VITEST_WORKER_ID !== undefined;

/**
 * Reads a positive integer from the environment, falling back to the built-in
 * default when the variable is unset, empty, or not a positive integer. Every
 * limit below keeps its previous value when the variable is absent, so this is
 * opt-in for operators who need different thresholds.
 */
const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn(
      `Ignoring invalid ${name}="${raw}"; expected a positive integer. Using ${fallback}.`,
    );
    return fallback;
  }

  return parsed;
};

const MINUTES_15 = 15 * 60 * 1000;
const MINUTE_1 = 60 * 1000;

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
    // The rest of the API answers with JSON; without this the 429 body is bare
    // text, so clients that parse the response as JSON lose the error entirely.
    message: { success: false, message: 'Too many requests, please try again later.' },
  });

export const templateRateLimiter = createStandardRateLimiter({
  windowMs: envInt('TEMPLATE_RATE_LIMIT_WINDOW_MS', MINUTES_15),
  max: envInt('TEMPLATE_RATE_LIMIT_MAX', 200),
});

export const authenticatedRouteRateLimiter = createStandardRateLimiter({
  windowMs: envInt('API_RATE_LIMIT_WINDOW_MS', MINUTES_15),
  max: envInt('API_RATE_LIMIT_MAX', 600),
});

export const hostedInternalEventRateLimiter = createStandardRateLimiter({
  windowMs: envInt('HOSTED_EVENT_RATE_LIMIT_WINDOW_MS', MINUTE_1),
  max: envInt('HOSTED_EVENT_RATE_LIMIT_MAX', 600),
});

export const mcpConnectionRateLimiter = createStandardRateLimiter({
  windowMs: envInt('MCP_RATE_LIMIT_WINDOW_MS', MINUTE_1),
  max: envInt('MCP_RATE_LIMIT_MAX', 480),
});

export const authAttemptRateLimiter = createStandardRateLimiter({
  windowMs: envInt('AUTH_RATE_LIMIT_WINDOW_MS', MINUTES_15),
  max: envInt('AUTH_RATE_LIMIT_MAX', 20),
  // Brute-force protection is about failed credentials. Counting successful
  // logins adds no protection but locks out legitimate clients that hold no
  // session -- API consumers and service accounts re-authenticate on every
  // token expiry, and a burst of concurrent renewals exhausts the window.
  skipSuccessfulRequests: true,
});

export const spaPageRateLimiter = createStandardRateLimiter({
  windowMs: envInt('SPA_RATE_LIMIT_WINDOW_MS', MINUTE_1),
  max: envInt('SPA_RATE_LIMIT_MAX', 600),
});
