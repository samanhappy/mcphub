import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';

const ENV_KEYS = [
  'AUTH_RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_WINDOW_MS',
  'REGISTER_RATE_LIMIT_MAX',
  'REGISTER_RATE_LIMIT_WINDOW_MS',
];

const originalEnv = process.env;

/**
 * Loads the real limiters against an explicit environment.
 *
 * Two things are deliberate. Every limit this suite asserts is set explicitly
 * rather than relying on defaults, because `rateLimit.ts` calls `dotenv.config()`
 * at module scope and would otherwise read a developer's `.env`. And the test
 * runner markers are removed, because the shared limiters disable themselves
 * under a test runner (`skip: () => isTestEnv`) — without this the middleware
 * would be a no-op and prove nothing.
 */
const loadLimiters = async (env: Record<string, string>) => {
  jest.resetModules();
  process.env = { ...originalEnv, NODE_ENV: 'production' };
  delete process.env.JEST_WORKER_ID;
  delete process.env.VITEST_WORKER_ID;
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, env);

  const mod = await import('../../src/utils/rateLimit.js');
  return {
    login: mod.authAttemptRateLimiter as unknown as RequestHandler,
    register: mod.authRegistrationRateLimiter as unknown as RequestHandler,
  };
};

const buildApp = (limiters: { login: RequestHandler; register: RequestHandler }) => {
  const app = express();
  app.post('/api/auth/login', limiters.login, (req, res) => {
    if (req.headers['x-valid-credentials'] === 'true') {
      res.status(200).json({ success: true, token: 'token' });
      return;
    }
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  });
  app.post('/api/auth/register', limiters.register, (_req, res) => {
    res.status(200).json({ success: true });
  });
  return app;
};

const post = (app: express.Express, path: string, valid = false) => {
  const pending = request(app).post(path);
  return valid ? pending.set('x-valid-credentials', 'true') : pending;
};

describe('auth rate limiting', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('does not spend the login budget on successful logins', async () => {
    const app = buildApp(
      await loadLimiters({ AUTH_RATE_LIMIT_MAX: '20', AUTH_RATE_LIMIT_WINDOW_MS: '900000' }),
    );

    // A service account re-authenticating in a burst — for example after a restart
    // invalidated its cached token — must not lock itself out with valid credentials.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      expect((await post(app, '/api/auth/login', true)).status).toBe(200);
    }

    expect((await post(app, '/api/auth/login')).status).toBe(401);
  });

  it('still blocks repeated failed logins', async () => {
    const app = buildApp(
      await loadLimiters({ AUTH_RATE_LIMIT_MAX: '20', AUTH_RATE_LIMIT_WINDOW_MS: '900000' }),
    );

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      statuses.push((await post(app, '/api/auth/login')).status);
    }

    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(401));
    expect(statuses[20]).toBe(429);
  });

  it('answers a blocked request with a JSON body', async () => {
    const app = buildApp(
      await loadLimiters({ AUTH_RATE_LIMIT_MAX: '1', AUTH_RATE_LIMIT_WINDOW_MS: '900000' }),
    );

    await post(app, '/api/auth/login');
    const blocked = await post(app, '/api/auth/login');

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      success: false,
      message: 'Too many requests, please try again later.',
    });
  });

  it('keeps capping successful registrations', async () => {
    const app = buildApp(
      await loadLimiters({ REGISTER_RATE_LIMIT_MAX: '3', REGISTER_RATE_LIMIT_WINDOW_MS: '900000' }),
    );

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await post(app, '/api/auth/register')).status);
    }

    // Unlike login, a successful registration is exactly what the cap exists to limit.
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('does not let login traffic exhaust the registration budget', async () => {
    const app = buildApp(
      await loadLimiters({ AUTH_RATE_LIMIT_MAX: '2', REGISTER_RATE_LIMIT_MAX: '3' }),
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await post(app, '/api/auth/login');
    }
    expect((await post(app, '/api/auth/login')).status).toBe(429);

    expect((await post(app, '/api/auth/register')).status).toBe(200);
  });

  it('applies no limit at all when the cap is disabled', async () => {
    const app = buildApp(await loadLimiters({ AUTH_RATE_LIMIT_MAX: '0' }));

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      statuses.push((await post(app, '/api/auth/login')).status);
    }

    // Every one of these is a *failed* login: with the limiter disabled not even
    // those are capped, and none of them may turn into a 429.
    expect(statuses).toEqual(Array(40).fill(401));
  });
});
