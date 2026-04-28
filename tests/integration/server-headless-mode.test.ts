import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

const initMiddlewaresMock = jest.fn();
const initRoutesMock = jest.fn();
const initUpstreamServersMock = jest.fn().mockResolvedValue(undefined);
const handleSseConnectionMock = jest.fn((_req, res) => res.status(204).send());
const handleSseMessageMock = jest.fn((_req, res) => res.status(204).send());
const handleMcpPostRequestMock = jest.fn((_req, res) => res.status(204).send());
const handleMcpOtherRequestMock = jest.fn((_req, res) => res.status(204).send());
const sseUserContextMiddlewareMock = jest.fn((_req, _res, next) => next());
const mcpConnectionRateLimiterMock = jest.fn((_req, _res, next) => next());

jest.mock('../../src/utils/i18n.js', () => ({
  __esModule: true,
  initI18n: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/models/User.js', () => ({
  __esModule: true,
  initializeDefaultUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  __esModule: true,
  initOAuthProvider: jest.fn(),
  getOAuthRouter: jest.fn(() => null),
}));

jest.mock('../../src/services/oauthServerService.js', () => ({
  __esModule: true,
  initOAuthServer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/middlewares/index.js', () => ({
  __esModule: true,
  initMiddlewares: initMiddlewaresMock,
}));

jest.mock('../../src/routes/index.js', () => ({
  __esModule: true,
  initRoutes: initRoutesMock,
}));

jest.mock('../../src/services/mcpService.js', () => ({
  __esModule: true,
  initUpstreamServers: initUpstreamServersMock,
  connected: jest.fn().mockReturnValue(true),
  cleanupAllServers: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  __esModule: true,
  handleSseConnection: handleSseConnectionMock,
  handleSseMessage: handleSseMessageMock,
  handleMcpPostRequest: handleMcpPostRequestMock,
  handleMcpOtherRequest: handleMcpOtherRequestMock,
}));

jest.mock('../../src/middlewares/userContext.js', () => ({
  __esModule: true,
  userContextMiddleware: jest.fn((_req, _res, next) => next()),
  sseUserContextMiddleware: sseUserContextMiddlewareMock,
}));

jest.mock('../../src/utils/rateLimit.js', () => ({
  __esModule: true,
  mcpConnectionRateLimiter: mcpConnectionRateLimiterMock,
}));

import { AppServer } from '../../src/server.js';

const flushPromises = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('AppServer headless web mode', () => {
  const originalDisableWeb = process.env.DISABLE_WEB;
  let frontendDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DISABLE_WEB;
    frontendDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-frontend-'));
    fs.writeFileSync(path.join(frontendDir, 'index.html'), '<html><body>test ui</body></html>');
    jest.spyOn(AppServer.prototype as never, 'findFrontendDistPath' as never).mockReturnValue(frontendDir);
  });

  afterEach(() => {
    if (originalDisableWeb === undefined) {
      delete process.env.DISABLE_WEB;
    } else {
      process.env.DISABLE_WEB = originalDisableWeb;
    }

    jest.restoreAllMocks();
    fs.rmSync(frontendDir, { recursive: true, force: true });
  });

  const createApp = async () => {
    const appServer = new AppServer();
    await appServer.initialize();
    await flushPromises();
    return appServer.getApp();
  };

  it('serves the frontend by default when a build is available', async () => {
    const app = await createApp();

    const response = await request(app).get('/').expect(200);

    expect(response.text).toContain('test ui');
  });

  it('disables the web UI while keeping MCP routes available when DISABLE_WEB=true', async () => {
    process.env.DISABLE_WEB = 'true';
    const app = await createApp();

    const rootResponse = await request(app).get('/').expect(404);
    await request(app).post('/mcp/test-group').send({}).expect(204);

    expect(rootResponse.text).toContain('UI is not available');
    expect(handleMcpPostRequestMock).toHaveBeenCalledTimes(1);
  });
});
