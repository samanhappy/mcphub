import { afterEach, describe, expect, it, jest } from '@jest/globals';

const rateLimitMock = jest.fn((options: unknown) => options);

jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: rateLimitMock,
}));

import {
  authAttemptRateLimiter,
  authenticatedRouteRateLimiter,
  createStandardRateLimiter,
  mcpConnectionRateLimiter,
  templateRateLimiter,
} from './rateLimit.js';

const ENV_KEYS = [
  'AUTH_RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_WINDOW_MS',
  'API_RATE_LIMIT_MAX',
  'API_RATE_LIMIT_WINDOW_MS',
];

/** Re-evaluates the module so module-level limiters pick up the patched env. */
const reloadWithEnv = async (env: Record<string, string>) => {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  jest.resetModules();
  return import('./rateLimit.js');
};

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  jest.resetModules();
});

describe('rateLimit configuration', () => {
  it('uses relaxed default limits across authenticated, template, and MCP routes', () => {
    expect(templateRateLimiter).toMatchObject({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    });
    expect(authenticatedRouteRateLimiter).toMatchObject({
      windowMs: 15 * 60 * 1000,
      max: 600,
      standardHeaders: true,
      legacyHeaders: false,
    });
    expect(mcpConnectionRateLimiter).toMatchObject({
      windowMs: 60 * 1000,
      max: 480,
      standardHeaders: true,
      legacyHeaders: false,
    });
  });

  it('skips rate limiting automatically in test environments', () => {
    const limiter = createStandardRateLimiter({
      windowMs: 1000,
      max: 1,
    }) as { skip: () => boolean };

    expect(limiter.skip()).toBe(true);
  });

  it('answers with a JSON body so clients can parse the 429', () => {
    expect(authenticatedRouteRateLimiter).toMatchObject({
      message: { success: false, message: 'Too many requests, please try again later.' },
    });
  });

  describe('auth attempt limiter', () => {
    it('counts only failed attempts so successful logins never exhaust the window', () => {
      expect(authAttemptRateLimiter).toMatchObject({
        windowMs: 15 * 60 * 1000,
        max: 20,
        skipSuccessfulRequests: true,
      });
    });

    it('keeps counting every request on the other limiters', () => {
      expect(authenticatedRouteRateLimiter).not.toMatchObject({ skipSuccessfulRequests: true });
      expect(mcpConnectionRateLimiter).not.toMatchObject({ skipSuccessfulRequests: true });
    });
  });

  describe('environment overrides', () => {
    it('applies positive integer overrides', async () => {
      const mod = await reloadWithEnv({
        AUTH_RATE_LIMIT_MAX: '100',
        AUTH_RATE_LIMIT_WINDOW_MS: '60000',
        API_RATE_LIMIT_MAX: '5000',
      });

      expect(mod.authAttemptRateLimiter).toMatchObject({ windowMs: 60000, max: 100 });
      expect(mod.authenticatedRouteRateLimiter).toMatchObject({ max: 5000 });
    });

    it('falls back to the default when the value is not a positive integer', async () => {
      const mod = await reloadWithEnv({
        AUTH_RATE_LIMIT_MAX: 'not-a-number',
        API_RATE_LIMIT_MAX: '-5',
      });

      expect(mod.authAttemptRateLimiter).toMatchObject({ max: 20 });
      expect(mod.authenticatedRouteRateLimiter).toMatchObject({ max: 600 });
    });

    it('falls back to the default when the value is empty', async () => {
      const mod = await reloadWithEnv({ AUTH_RATE_LIMIT_MAX: '   ' });

      expect(mod.authAttemptRateLimiter).toMatchObject({ max: 20 });
    });
  });
});
