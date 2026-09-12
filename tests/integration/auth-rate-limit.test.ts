import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';

const originalEnv = process.env;

/**
 * The shared limiters disable themselves under test runners (`skip: () => isTestEnv`),
 * so the module is re-imported with a production-like environment to exercise the real
 * counting behavior rather than a bypassed middleware.
 */
const loadAuthAttemptRateLimiter = async (): Promise<RequestHandler> => {
  jest.resetModules();
  process.env = { ...originalEnv, NODE_ENV: 'production' };
  delete process.env.JEST_WORKER_ID;
  delete process.env.VITEST_WORKER_ID;

  const { authAttemptRateLimiter } = await import('../../src/utils/rateLimit.js');
  return authAttemptRateLimiter as unknown as RequestHandler;
};

const buildLoginApp = (limiter: RequestHandler) => {
  const app = express();
  app.post('/api/auth/login', limiter, (req, res) => {
    if (req.headers['x-valid-credentials'] === 'true') {
      res.status(200).json({ success: true, token: 'token' });
      return;
    }
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  });
  return app;
};

describe('auth attempt rate limiting', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('does not spend the auth attempt budget on successful logins', async () => {
    const app = buildLoginApp(await loadAuthAttemptRateLimiter());

    // Well beyond the 20-attempt cap: a service account that re-authenticates in a burst
    // (for example after a restart invalidated its cached token) must not lock itself out.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .set('x-valid-credentials', 'true')
        .send({ username: 'admin', password: 'correct' });

      expect(response.status).toBe(200);
    }

    const afterSuccesses = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });

    expect(afterSuccesses.status).toBe(401);
  });

  it('still blocks repeated failed logins', async () => {
    const app = buildLoginApp(await loadAuthAttemptRateLimiter());

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'wrong' });

      statuses.push(response.status);
    }

    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(401));
    expect(statuses[20]).toBe(429);
  });
});
