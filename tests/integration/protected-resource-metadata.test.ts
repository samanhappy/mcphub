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
import { getProtectedResourceMetadata } from '../../src/controllers/oauthServerController.js';
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
