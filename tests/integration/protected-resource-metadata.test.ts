const getSystemConfigMock = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: getSystemConfigMock,
  })),
}));

jest.mock('../../src/services/oauthServerService.js', () => ({
  getOAuthServer: jest.fn(),
  handleTokenRequest: jest.fn(),
  handleAuthenticateRequest: jest.fn(),
}));

jest.mock('../../src/models/OAuth.js', () => ({
  findOAuthClientById: jest.fn(),
}));

jest.mock('../../src/services/betterAuthSession.js', () => ({
  resolveBetterAuthUser: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import { mcpConnectionRateLimiter } from '../../src/utils/rateLimit.js';
import {
  getMetadata,
  getProtectedResourceMetadata,
} from '../../src/controllers/oauthServerController.js';
import { getPublicResourceUrl, getResourceMetadataUrl } from '../../src/utils/protectedResource.js';

jest.mock('../../src/config/index.js', () => ({
  __esModule: true,
  default: { basePath: '/internal' },
}));

it.each([
  '/mcp',
  '/mcp/team',
  '/alice/mcp/team',
  '/sse/team',
  '/messages',
  '/alice/messages',
  '/alice/sse/team',
  '/mcp/team%20one',
])('publishes matching discovery metadata for %s behind a public prefix', async (path) => {
  const settings = {
    install: { baseUrl: 'https://public.example/hub/' },
    oauthServer: { enabled: true },
  };
  getSystemConfigMock.mockResolvedValue(settings);
  const app = express();
  app.get(
    [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/:resourcePath(*)',
    ],
    mcpConnectionRateLimiter,
    getProtectedResourceMetadata,
  );
  app.get(`/internal${path}`, (req, res) => {
    const resource = getPublicResourceUrl(req, settings);
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${getResourceMetadataUrl(resource)}"`,
    );
    res.status(401).end();
  });
  const challenge = await request(app).get(`/internal${path}?ignored=true`).expect(401);
  const metadataUrl = challenge.headers['www-authenticate'].match(/resource_metadata="([^"]+)"/)[1];
  expect(metadataUrl).toBe(
    `https://public.example/.well-known/oauth-protected-resource/hub${path}`,
  );
  const metadata = await request(app)
    .get(new URL(metadataUrl).pathname)
    .expect(200)
    .expect('Content-Type', /application\/json/);
  expect(metadata.body.resource).toBe(`https://public.example/hub${path}`);
  expect(metadata.body.authorization_servers).toEqual(['https://public.example/hub/']);
});

it.each([false, 1])(
  'uses Host and Express protocol throughout OAuth discovery with trust proxy=%s',
  async (trustProxy) => {
    const originalBaseUrl = process.env.INSTALL_BASE_URL;
    delete process.env.INSTALL_BASE_URL;
    try {
      getSystemConfigMock.mockResolvedValue({
        oauthServer: { enabled: true, dynamicRegistration: { enabled: true } },
      });
      const app = express();
      app.set('trust proxy', trustProxy);
      const origin = `${trustProxy ? 'https' : 'http'}://edge.example`;
      app.get(
        '/.well-known/oauth-protected-resource/:resourcePath(*)',
        mcpConnectionRateLimiter,
        getProtectedResourceMetadata,
      );
      app.get('/.well-known/oauth-authorization-server', mcpConnectionRateLimiter, getMetadata);
      const headers = {
        Host: 'edge.example',
        'X-Forwarded-Host': 'attacker.example',
        'X-Forwarded-Proto': 'https',
      };
      const resource = await request(app)
        .get('/.well-known/oauth-protected-resource/internal/mcp')
        .set(headers)
        .expect(200);
      expect(resource.body.resource).toBe(`${origin}/internal/mcp`);
      expect(resource.body.authorization_servers).toEqual([origin]);
      const authorization = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .set(headers)
        .expect(200);
      expect(authorization.body).toMatchObject({
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        userinfo_endpoint: `${origin}/oauth/userinfo`,
        registration_endpoint: `${origin}/oauth/register`,
      });
    } finally {
      if (originalBaseUrl === undefined) delete process.env.INSTALL_BASE_URL;
      else process.env.INSTALL_BASE_URL = originalBaseUrl;
    }
  },
);

it.each(['/hub/api/settings', '/evil/mcp', '/hub/messages/extra', '/hub/alice/messages/extra'])(
  'rejects metadata for paths outside the protected transport surface: %s',
  async (path) => {
    getSystemConfigMock.mockResolvedValue({
      install: { baseUrl: 'https://public.example/hub' },
      oauthServer: { enabled: true },
    });
    const app = express();
    app.get(
      '/.well-known/oauth-protected-resource/:resourcePath(*)',
      mcpConnectionRateLimiter,
      getProtectedResourceMetadata,
    );
    await request(app).get(`/.well-known/oauth-protected-resource${path}`).expect(404);
  },
);
