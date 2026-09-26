import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import {
  createServer,
  updateServer,
  getServerConfig,
} from '../../src/controllers/serverController.js';
import { auth } from '../../src/middlewares/auth.js';
import { userContextMiddleware } from '../../src/middlewares/userContext.js';
import { authenticatedRouteRateLimiter } from '../../src/utils/rateLimit.js';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { clearSettingsCache } from '../../src/config/index.js';
import { createUserToken } from '../utils/testHelpers.js';
import * as mcpService from '../../src/services/mcpService.js';
import type { McpSettings } from '../../src/types/index.js';

// openid-client pulls in a real issuer-discovery HTTP path at import time that
// is not needed here; stub it like the sibling integration suites do.
jest.mock('openid-client', () => ({}));
jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/toolResultCompressionService.js', () => ({
  maybeCompressToolResult: (result: unknown) => result,
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: () => ({ logToolCall: jest.fn() }),
}));

const adminToken = createUserToken('admin', true);
let directory: string;
let app: express.Express;
const originalEnv = {
  path: process.env.MCPHUB_SETTING_PATH,
  useDb: process.env.USE_DB,
};

beforeAll(async () => {
  // The controller fires background tool-registration/notification after a
  // write (notifyToolChanged -> registerAllTools), which would otherwise try
  // to open a real upstream connection to the test server's placeholder URL.
  // Neutralize only the notification side-effects; addServer/addOrUpdateServer
  // and the DAO reads stay fully real so persistence is exercised end-to-end.
  jest.spyOn(mcpService, 'notifyToolChanged').mockResolvedValue(undefined);
  jest.spyOn(mcpService, 'broadcastToolListChanged').mockImplementation(() => undefined);

  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-server-config-e2e-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  const settings: McpSettings = {
    mcpServers: {},
    users: [],
    groups: [],
    systemConfig: {
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: false,
        skipAuth: false,
      },
    },
  };
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH, JSON.stringify(settings));
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());

  app = express();
  app.use(express.json());
  app.use('/api', authenticatedRouteRateLimiter, auth, userContextMiddleware);
  app.post('/api/servers', createServer);
  app.put('/api/servers/:name', updateServer);
  app.get('/api/servers/:name', getServerConfig);
});

afterAll(async () => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries({
    MCPHUB_SETTING_PATH: originalEnv.path,
    USE_DB: originalEnv.useDb,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

describe('server config persistence — oauth redirectUri / revocationEndpoint', () => {
  it('persists and round-trips oauth.redirectUri, revocationEndpoint and dynamicRegistration through the real REST path', async () => {
    const config = {
      type: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      oauth: {
        redirectUri: 'https://app.example.com/callback',
        revocationEndpoint: 'https://auth.example.com/revoke',
        dynamicRegistration: { enabled: true, issuer: 'https://issuer.example.com' },
      },
    };

    const createRes = await request(app)
      .post('/api/servers')
      .set('x-auth-token', adminToken)
      .send({ name: 'oauth-keep-server', config });
    expect(createRes.status).toBe(200);

    const readRes = await request(app)
      .get('/api/servers/oauth-keep-server')
      .set('x-auth-token', adminToken);
    expect(readRes.status).toBe(200);
    expect(readRes.body.data.config.oauth.redirectUri).toBe('https://app.example.com/callback');
    expect(readRes.body.data.config.oauth.revocationEndpoint).toBe(
      'https://auth.example.com/revoke',
    );
    expect(readRes.body.data.config.oauth.dynamicRegistration).toEqual({
      enabled: true,
      issuer: 'https://issuer.example.com',
    });
  });

  it('does not synthesize oauth.redirectUri / revocationEndpoint when absent', async () => {
    const config = {
      type: 'streamable-http',
      url: 'https://mcp-no-redirect.example.com/mcp',
      oauth: { dynamicRegistration: { enabled: true, issuer: 'https://issuer.example.com' } },
    };

    const createRes = await request(app)
      .post('/api/servers')
      .set('x-auth-token', adminToken)
      .send({ name: 'oauth-no-redirect', config });
    expect(createRes.status).toBe(200);

    const readRes = await request(app)
      .get('/api/servers/oauth-no-redirect')
      .set('x-auth-token', adminToken);
    expect(readRes.status).toBe(200);
    const oauth = readRes.body.data.config.oauth;
    expect(oauth).not.toHaveProperty('redirectUri');
    expect(oauth).not.toHaveProperty('revocationEndpoint');
    expect(oauth.dynamicRegistration).toEqual({
      enabled: true,
      issuer: 'https://issuer.example.com',
    });
  });

  it('keeps oauth.redirectUri / revocationEndpoint alive across a second (update) save', async () => {
    const config = {
      type: 'streamable-http',
      url: 'https://mcp-update.example.com/mcp',
      oauth: {
        redirectUri: 'https://app.example.com/cb-update',
        revocationEndpoint: 'https://auth.example.com/revoke-update',
      },
    };

    const createRes = await request(app)
      .post('/api/servers')
      .set('x-auth-token', adminToken)
      .send({ name: 'oauth-update-server', config });
    expect(createRes.status).toBe(200);

    const updateRes = await request(app)
      .put('/api/servers/oauth-update-server')
      .set('x-auth-token', adminToken)
      .send({ config: { ...config, url: 'https://mcp-update2.example.com/mcp' } });
    expect(updateRes.status).toBe(200);

    const readRes = await request(app)
      .get('/api/servers/oauth-update-server')
      .set('x-auth-token', adminToken);
    expect(readRes.status).toBe(200);
    expect(readRes.body.data.config.oauth.redirectUri).toBe('https://app.example.com/cb-update');
    expect(readRes.body.data.config.oauth.revocationEndpoint).toBe(
      'https://auth.example.com/revoke-update',
    );
  });
});