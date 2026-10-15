import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));
jest.mock('../../src/controllers/oauthServerController.js', () => {
  const ok = (_req: express.Request, res: express.Response) => res.json({ ok: true });
  return {
    getAuthorize: ok,
    postAuthorize: ok,
    postToken: ok,
    getUserInfo: ok,
    getMetadata: ok,
    getProtectedResourceMetadata: ok,
  };
});
jest.mock('../../src/controllers/oauthDynamicRegistrationController.js', () => {
  const ok = (_req: express.Request, res: express.Response) => res.json({ ok: true });
  return {
    registerClient: ok,
    getClientConfiguration: ok,
    updateClientConfiguration: ok,
    deleteClientRegistration: ok,
  };
});
jest.mock('../../src/controllers/oauthCallbackController.js', () => ({
  handleOAuthCallback: (_req: express.Request, res: express.Response) => res.json({ ok: true }),
}));

jest.mock('../../src/services/mcpService.js', () => ({}));
jest.mock('../../src/services/oauthService.js', () => ({}));
jest.mock('../../src/services/oauthClientRegistration.js', () => ({}));

const originalEnv = process.env;
beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    USE_DB: 'false',
    MCP_RATE_LIMIT_MAX: '2',
    MCP_RATE_LIMIT_WINDOW_MS: '60000',
    OAUTH_RATE_LIMIT_MAX: '2',
    OAUTH_RATE_LIMIT_WINDOW_MS: '60000',
    OAUTH_DISCOVERY_RATE_LIMIT_MAX: '2',
    OAUTH_DISCOVERY_RATE_LIMIT_WINDOW_MS: '60000',
    OAUTH_REGISTRATION_RATE_LIMIT_MAX: '2',
    OAUTH_REGISTRATION_RATE_LIMIT_WINDOW_MS: '60000',
  };
  delete process.env.JEST_WORKER_ID;
  delete process.env.VITEST_WORKER_ID;
});
afterEach(() => {
  process.env = originalEnv;
  jest.resetModules();
});

const createApp = async () => {
  const { initRoutes } = await import('../../src/routes/index.js');
  const { mcpConnectionRateLimiter } = await import('../../src/utils/rateLimit.js');
  const app = express();
  app.post('/mcp/example', mcpConnectionRateLimiter, (_req, res) => res.json({ ok: true }));
  await initRoutes(app);
  return app;
};

it('keeps OAuth recovery and discovery available after MCP traffic exhausts its budget', async () => {
  const app = await createApp();
  await request(app).post('/mcp/example').expect(200);
  await request(app).post('/mcp/example').expect(200);
  await request(app).post('/mcp/example').expect(429);
  await request(app).get('/.well-known/oauth-protected-resource/mcp/example').expect(200);
  await request(app).get('/.well-known/oauth-authorization-server').expect(200);
  await request(app)
    .post('/oauth/token')
    .type('form')
    .send({ grant_type: 'refresh_token' })
    .expect(200);
  await request(app).get('/oauth/authorize').expect(200);
});

it('isolates discovery and registration bursts from token refresh while keeping every budget capped', async () => {
  const app = await createApp();
  for (let i = 0; i < 2; i++) {
    await request(app).get('/.well-known/oauth-protected-resource').expect(200);
    await request(app).post('/oauth/register').expect(200);
  }
  await request(app).get('/.well-known/oauth-authorization-server').expect(429);
  await request(app).get('/oauth/register/client').expect(429);
  await request(app).post('/oauth/token').expect(200);
  await request(app).post('/oauth/token').expect(200);
  const blocked = await request(app).post('/oauth/token').expect(429);
  expect(blocked.body).toEqual({
    error: 'temporarily_unavailable',
    error_description: 'Too many requests, please try again later.',
  });
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  await request(app).post('/mcp/example').expect(200);
});

it.each([
  ['get', '/oauth/callback'],
  ['get', '/oauth/userinfo'],
  ['post', '/oauth/authorize'],
  ['put', '/oauth/register/client'],
  ['delete', '/oauth/register/client'],
] as const)('keeps the %s %s endpoint rate limited', async (method, path) => {
  const app = await createApp();
  await request(app)[method](path).expect(200);
  await request(app)[method](path).expect(200);
  await request(app)[method](path).expect(429);
  await request(app).post('/mcp/example').expect(200);
});
