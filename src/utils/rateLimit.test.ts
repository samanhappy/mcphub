import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const rateLimitMock = jest.fn((options: unknown) => options);

jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: rateLimitMock,
}));

// rateLimit.ts calls dotenv.config() at module scope so its limits do not depend
// on evaluation order. Stub it here: without this the module would read the
// developer's real .env, and the default-value assertions below would fail on
// exactly the machines this feature is aimed at - the ones that set these
// variables.
jest.mock('dotenv', () => ({
  __esModule: true,
  default: { config: jest.fn() },
}));

const warnMock = jest.fn();

jest.mock('./logger.js', () => ({
  __esModule: true,
  logger: { warn: warnMock, info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ENV_KEYS = [
  'AUTH_RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_WINDOW_MS',
  'REGISTER_RATE_LIMIT_MAX',
  'REGISTER_RATE_LIMIT_WINDOW_MS',
  'API_RATE_LIMIT_MAX',
  'API_RATE_LIMIT_WINDOW_MS',
  'MCP_RATE_LIMIT_MAX',
  'MCP_RATE_LIMIT_WINDOW_MS',
  'TEMPLATE_RATE_LIMIT_MAX',
  'TEMPLATE_RATE_LIMIT_WINDOW_MS',
  'SPA_RATE_LIMIT_MAX',
  'SPA_RATE_LIMIT_WINDOW_MS',
  'HOSTED_EVENT_RATE_LIMIT_MAX',
  'HOSTED_EVENT_RATE_LIMIT_WINDOW_MS',
];

const clearEnv = () => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
};

/**
 * Evaluates the module against a known environment. Every rate-limit variable is
 * cleared first, so a test asserting a default never depends on what happens to
 * be set in the ambient environment.
 */
const loadRateLimit = async (
  env: Record<string, string> = {},
  options: { productionLike?: boolean } = {},
) => {
  clearEnv();
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  // `skip()` is always true under a test runner, so asserting that a limiter is
  // disabled by configuration requires evaluating the module as production would.
  const restore: Array<() => void> = [];
  if (options.productionLike) {
    for (const key of ['NODE_ENV', 'JEST_WORKER_ID', 'VITEST_WORKER_ID']) {
      const previous = process.env[key];
      restore.push(() => {
        if (previous === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous;
        }
      });
      delete process.env[key];
    }
    process.env.NODE_ENV = 'production';
  }

  jest.resetModules();
  try {
    return await import('./rateLimit.js');
  } finally {
    for (const undo of restore) {
      undo();
    }
  }
};

beforeEach(() => {
  clearEnv();
  warnMock.mockClear();
});

afterEach(() => {
  clearEnv();
  jest.resetModules();
});

describe('rateLimit configuration', () => {
  it('uses relaxed default limits across authenticated, template, and MCP routes', async () => {
    const mod = await loadRateLimit();

    expect(mod.templateRateLimiter).toMatchObject({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    });
    expect(mod.authenticatedRouteRateLimiter).toMatchObject({
      windowMs: 15 * 60 * 1000,
      max: 600,
      standardHeaders: true,
      legacyHeaders: false,
    });
    expect(mod.mcpConnectionRateLimiter).toMatchObject({
      windowMs: 60 * 1000,
      max: 480,
      standardHeaders: true,
      legacyHeaders: false,
    });
  });

  it('skips rate limiting automatically in test environments', async () => {
    const mod = await loadRateLimit();

    const limiter = mod.createStandardRateLimiter({
      windowMs: 1000,
      max: 1,
    }) as unknown as { skip: () => boolean };

    expect(limiter.skip()).toBe(true);
  });

  it('answers with a JSON body so clients can parse the 429', async () => {
    const mod = await loadRateLimit();

    expect(mod.authenticatedRouteRateLimiter).toMatchObject({
      message: { success: false, message: 'Too many requests, please try again later.' },
    });
  });

  describe('auth attempt limiter', () => {
    it('counts only failed attempts so successful logins never exhaust the window', async () => {
      const mod = await loadRateLimit();

      expect(mod.authAttemptRateLimiter).toMatchObject({
        windowMs: 15 * 60 * 1000,
        max: 20,
        skipSuccessfulRequests: true,
      });
    });

    it('keeps counting every request on the other limiters', async () => {
      const mod = await loadRateLimit();

      for (const limiter of [
        mod.authenticatedRouteRateLimiter,
        mod.mcpConnectionRateLimiter,
        mod.templateRateLimiter,
        mod.spaPageRateLimiter,
        mod.hostedInternalEventRateLimiter,
        mod.authRegistrationRateLimiter,
      ]) {
        expect(limiter).not.toMatchObject({ skipSuccessfulRequests: true });
      }
    });
  });

  describe('registration limiter', () => {
    it('counts successful registrations so the per-IP account cap survives', async () => {
      const mod = await loadRateLimit();

      // /auth/register is ungated: a successful request creates an account, which is
      // exactly what the cap exists to limit. It must not inherit skipSuccessfulRequests
      // from the login limiter.
      expect(mod.authRegistrationRateLimiter).toMatchObject({
        windowMs: 15 * 60 * 1000,
        max: 20,
      });
      expect(mod.authRegistrationRateLimiter).not.toMatchObject({
        skipSuccessfulRequests: true,
      });
    });

    it('has its own budget so login traffic cannot exhaust it', async () => {
      const mod = await loadRateLimit({
        AUTH_RATE_LIMIT_MAX: '500',
        REGISTER_RATE_LIMIT_MAX: '5',
        REGISTER_RATE_LIMIT_WINDOW_MS: '60000',
      });

      expect(mod.authAttemptRateLimiter).toMatchObject({ max: 500 });
      expect(mod.authRegistrationRateLimiter).toMatchObject({ max: 5, windowMs: 60000 });
    });
  });

  describe('disabling a limiter', () => {
    it('treats 0 as unlimited rather than blocking every request', async () => {
      // express-rate-limit >= 7 rejects every request when limit is 0, so an operator
      // reaching for "no limit" must not have that value passed through verbatim.
      const mod = await loadRateLimit({ AUTH_RATE_LIMIT_MAX: '0' }, { productionLike: true });

      const auth = mod.authAttemptRateLimiter as unknown as { skip: () => boolean; max: number };
      expect(auth.skip()).toBe(true);
      expect(auth.max).toBeGreaterThan(0);
    });

    it('accepts off as a spelling of unlimited', async () => {
      const mod = await loadRateLimit({ API_RATE_LIMIT_MAX: 'off' }, { productionLike: true });

      expect((mod.authenticatedRouteRateLimiter as unknown as { skip: () => boolean }).skip()).toBe(
        true,
      );
    });

    it('leaves every other limiter enabled', async () => {
      const mod = await loadRateLimit({ AUTH_RATE_LIMIT_MAX: '0' }, { productionLike: true });

      for (const limiter of [
        mod.authenticatedRouteRateLimiter,
        mod.mcpConnectionRateLimiter,
        mod.authRegistrationRateLimiter,
      ]) {
        expect((limiter as unknown as { skip: () => boolean }).skip()).toBe(false);
      }
    });

    it('warns so a disabled limiter is visible in the logs', async () => {
      await loadRateLimit({ AUTH_RATE_LIMIT_MAX: '0' });

      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining('Rate limiting disabled by AUTH_RATE_LIMIT_MAX'),
      );
    });
  });

  describe('environment overrides', () => {
    it('applies positive integer overrides', async () => {
      const mod = await loadRateLimit({
        AUTH_RATE_LIMIT_MAX: '100',
        AUTH_RATE_LIMIT_WINDOW_MS: '60000',
        API_RATE_LIMIT_MAX: '5000',
      });

      expect(mod.authAttemptRateLimiter).toMatchObject({ windowMs: 60000, max: 100 });
      expect(mod.authenticatedRouteRateLimiter).toMatchObject({ max: 5000 });
    });

    it('covers every limiter family', async () => {
      const mod = await loadRateLimit({
        TEMPLATE_RATE_LIMIT_MAX: '11',
        API_RATE_LIMIT_MAX: '12',
        HOSTED_EVENT_RATE_LIMIT_MAX: '13',
        MCP_RATE_LIMIT_MAX: '14',
        AUTH_RATE_LIMIT_MAX: '15',
        SPA_RATE_LIMIT_MAX: '16',
      });

      expect(mod.templateRateLimiter).toMatchObject({ max: 11 });
      expect(mod.authenticatedRouteRateLimiter).toMatchObject({ max: 12 });
      expect(mod.hostedInternalEventRateLimiter).toMatchObject({ max: 13 });
      expect(mod.mcpConnectionRateLimiter).toMatchObject({ max: 14 });
      expect(mod.authAttemptRateLimiter).toMatchObject({ max: 15 });
      expect(mod.spaPageRateLimiter).toMatchObject({ max: 16 });
    });

    it('falls back to the default when the value is not a positive integer', async () => {
      const mod = await loadRateLimit({
        AUTH_RATE_LIMIT_MAX: 'not-a-number',
        API_RATE_LIMIT_MAX: '-5',
      });

      expect(mod.authAttemptRateLimiter).toMatchObject({ max: 20 });
      expect(mod.authenticatedRouteRateLimiter).toMatchObject({ max: 600 });
    });

    it('falls back to the default when the value is empty', async () => {
      const mod = await loadRateLimit({ AUTH_RATE_LIMIT_MAX: '   ' });

      expect(mod.authAttemptRateLimiter).toMatchObject({ max: 20 });
    });
  });
});
