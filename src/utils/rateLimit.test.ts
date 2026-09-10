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

const ENV_KEYS = [
  'AUTH_RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_WINDOW_MS',
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
const loadRateLimit = async (env: Record<string, string> = {}) => {
  clearEnv();
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  jest.resetModules();
  return import('./rateLimit.js');
};

beforeEach(() => {
  clearEnv();
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

      expect(mod.authenticatedRouteRateLimiter).not.toMatchObject({
        skipSuccessfulRequests: true,
      });
      expect(mod.mcpConnectionRateLimiter).not.toMatchObject({ skipSuccessfulRequests: true });
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
