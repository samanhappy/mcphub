import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

const handleSseConnectionMock = jest.fn();
const handleSseMessageMock = jest.fn();
const handleMcpPostRequestMock = jest.fn();
const handleMcpOtherRequestMock = jest.fn();
const sseUserContextMiddlewareMock = jest.fn((_req, _res, next) => next());

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
  initMiddlewares: jest.fn(),
}));

jest.mock('../../src/routes/index.js', () => ({
  __esModule: true,
  initRoutes: jest.fn(),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  __esModule: true,
  initUpstreamServers: jest.fn().mockResolvedValue(undefined),
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

import { AppServer } from '../../src/server.js';

const flushPromises = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('AppServer smart routing group paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    handleMcpPostRequestMock.mockImplementation(async (_req, res) => {
      res.status(204).send();
    });
    sseUserContextMiddlewareMock.mockImplementation((_req, _res, next) => next());
  });

  const createApp = async () => {
    const appServer = new AppServer();
    await appServer.initialize();
    await flushPromises();
    return appServer.getApp();
  };

  it('routes global MCP requests with nested smart group segments', async () => {
    const app = await createApp();

    await request(app).post('/mcp/$smart/test-group').send({}).expect(204);

    expect(handleMcpPostRequestMock).toHaveBeenCalledTimes(1);
    const [req] = handleMcpPostRequestMock.mock.calls[0];
    expect(req.params.group).toBe('$smart/test-group');
  });

  it('routes user-scoped MCP requests with nested smart group segments', async () => {
    const app = await createApp();

    await request(app).post('/alice/mcp/$smart/staging').send({}).expect(204);

    expect(handleMcpPostRequestMock).toHaveBeenCalledTimes(1);
    const [req] = handleMcpPostRequestMock.mock.calls[0];
    expect(req.params.group).toBe('$smart/staging');
    expect(req.params.user).toBe('alice');
  });
});
