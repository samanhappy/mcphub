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

it.each(['/mcp', '/mcp/team', '/alice/mcp/team', '/sse/team', '/mcp/team%20one'])(
  'publishes matching discovery metadata for %s behind a public prefix',
  async (path) => {
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
    const metadataUrl = challenge.headers['www-authenticate'].match(
      /resource_metadata="([^"]+)"/,
    )[1];
    expect(metadataUrl).toBe(
      `https://public.example/.well-known/oauth-protected-resource/hub${path}`,
    );
    const metadata = await request(app)
      .get(new URL(metadataUrl).pathname)
      .expect(200)
      .expect('Content-Type', /application\/json/);
    expect(metadata.body.resource).toBe(`https://public.example/hub${path}`);
    expect(metadata.body.authorization_servers).toEqual(['https://public.example/hub/']);
  },
);

it('uses the forwarded public authority throughout OAuth discovery without configured URLs', async () => {
  const originalBaseUrl = process.env.INSTALL_BASE_URL;
  delete process.env.INSTALL_BASE_URL;
  try {
    getSystemConfigMock.mockResolvedValue({
      oauthServer: { enabled: true, dynamicRegistration: { enabled: true } },
    });
    const app = express();
    app.get(
      '/.well-known/oauth-protected-resource/:resourcePath(*)',
      mcpConnectionRateLimiter,
      getProtectedResourceMetadata,
    );
    app.get('/.well-known/oauth-authorization-server', mcpConnectionRateLimiter, getMetadata);
    const headers = {
      Host: 'mcphub:3000',
      'X-Forwarded-Host': 'public.example',
      'X-Forwarded-Proto': 'https',
    };
    const resource = await request(app)
      .get('/.well-known/oauth-protected-resource/internal/mcp')
      .set(headers)
      .expect(200);
    expect(resource.body.resource).toBe('https://public.example/internal/mcp');
    expect(resource.body.authorization_servers).toEqual(['https://public.example']);
    const authorization = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set(headers)
      .expect(200);
    expect(authorization.body).toMatchObject({
      issuer: 'https://public.example',
      authorization_endpoint: 'https://public.example/oauth/authorize',
      token_endpoint: 'https://public.example/oauth/token',
      userinfo_endpoint: 'https://public.example/oauth/userinfo',
      registration_endpoint: 'https://public.example/oauth/register',
    });
  } finally {
    if (originalBaseUrl === undefined) delete process.env.INSTALL_BASE_URL;
    else process.env.INSTALL_BASE_URL = originalBaseUrl;
  }
});
