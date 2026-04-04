import { beforeEach, describe, expect, it, jest } from '@jest/globals';
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

describe('AppServer MCP routes use rate limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sseUserContextMiddlewareMock.mockImplementation((_req, _res, next) => next());
    mcpConnectionRateLimiterMock.mockImplementation((_req, _res, next) => next());
  });

  const createApp = async () => {
    const appServer = new AppServer();
    await appServer.initialize();
    await flushPromises();
    return appServer.getApp();
  };

  it('applies the MCP route rate limiter before handling SSE and MCP endpoints', async () => {
    const app = await createApp();

    await request(app).get('/sse/test-group').expect(204);
    await request(app).post('/messages').send({}).expect(204);
    await request(app).post('/mcp/test-group').send({}).expect(204);
    await request(app).get('/mcp/test-group').expect(204);
    await request(app).delete('/mcp/test-group').expect(204);

    expect(mcpConnectionRateLimiterMock).toHaveBeenCalledTimes(5);
    expect(handleSseConnectionMock).toHaveBeenCalledTimes(1);
    expect(handleSseMessageMock).toHaveBeenCalledTimes(1);
    expect(handleMcpPostRequestMock).toHaveBeenCalledTimes(1);
    expect(handleMcpOtherRequestMock).toHaveBeenCalledTimes(2);
  });
});