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

/**
 * Reads a request cap, additionally accepting `0` or `off` to mean "no limit".
 *
 * The value cannot simply be forwarded to express-rate-limit: since v7 a `limit`
 * of 0 rejects every request instead of disabling the limiter, so an operator
 * reaching for "unlimited" would lock themselves out completely. Disabling is
 * expressed through `skip` instead.
 */
const envLimit = (name: string, fallback: number): number | typeof UNLIMITED => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === '0' || normalized === 'off' || normalized === 'unlimited') {
    logger.warn(
      `Rate limiting disabled by ${name}="${raw}". Requests to these routes are no longer capped; only do this where the deployment is protected by other means.`,
    );
    return UNLIMITED;
  }

  return envInt(name, fallback);
};

const UNLIMITED = Symbol('unlimited');

const MINUTES_15 = 15 * 60 * 1000;
const MINUTE_1 = 60 * 1000;

export const createStandardRateLimiter = (options: {
  windowMs: number;
  max: number | typeof UNLIMITED;
  skipSuccessfulRequests?: boolean;
}) => {
  const { max, ...rest } = options;

  return rateLimit({
    ...rest,
    // Kept positive so the middleware never blocks; `skip` is what disables it.
    max: max === UNLIMITED ? Number.MAX_SAFE_INTEGER : max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTestEnv || max === UNLIMITED,
    // The rest of the API answers with JSON; without this the 429 body is bare
    // text, so clients that parse the response as JSON lose the error entirely.
    message: { success: false, message: 'Too many requests, please try again later.' },
  });
};

export const templateRateLimiter = createStandardRateLimiter({
  windowMs: envInt('TEMPLATE_RATE_LIMIT_WINDOW_MS', MINUTES_15),
  max: envLimit('TEMPLATE_RATE_LIMIT_MAX', 200),
});

export const authenticatedRouteRateLimiter = createStandardRateLimiter({
  windowMs: envInt('API_RATE_LIMIT_WINDOW_MS', MINUTES_15),
  max: envLimit('API_RATE_LIMIT_MAX', 600),
});

export const hostedInternalEventRateLimiter = createStandardRateLimiter({
  windowMs: envInt('HOSTED_EVENT_RATE_LIMIT_WINDOW_MS', MINUTE_1),
  max: envLimit('HOSTED_EVENT_RATE_LIMIT_MAX', 600),
});

export const mcpConnectionRateLimiter = createStandardRateLimiter({
  windowMs: envInt('MCP_RATE_LIMIT_WINDOW_MS', MINUTE_1),
  max: envLimit('MCP_RATE_LIMIT_MAX', 480),
});

export const authAttemptRateLimiter = createStandardRateLimiter({
  windowMs: envInt('AUTH_RATE_LIMIT_WINDOW_MS', MINUTES_15),
  max: envLimit('AUTH_RATE_LIMIT_MAX', 20),
  // Brute-force protection is about failed credentials. Counting successful
  // logins adds no protection but locks out legitimate clients that hold no
  // session -- API consumers and service accounts re-authenticate on every
  // token expiry, and a burst of concurrent renewals exhausts the window.
  skipSuccessfulRequests: true,
});

// /auth/register is ungated and a successful request creates an account, so this
// limiter deliberately counts every request -- successes are the thing being
// capped. It is separate from the login limiter so the two cannot exhaust each
// other's budget.
export const authRegistrationRateLimiter = createStandardRateLimiter({
  windowMs: envInt('REGISTER_RATE_LIMIT_WINDOW_MS', MINUTES_15),
  max: envLimit('REGISTER_RATE_LIMIT_MAX', 20),
});

export const spaPageRateLimiter = createStandardRateLimiter({
  windowMs: envInt('SPA_RATE_LIMIT_WINDOW_MS', MINUTE_1),
  max: envLimit('SPA_RATE_LIMIT_MAX', 600),
});
