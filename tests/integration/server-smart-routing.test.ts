import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

const findGroupsMock = jest.fn().mockResolvedValue([]);
const findServersMock = jest.fn().mockResolvedValue([]);

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

jest.mock('../../src/services/oauthServerService.js', () => ({
  initOAuthServer: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getGroupDao: () => ({ findAll: findGroupsMock }),
  getServerDao: () => ({ findAll: findServersMock }),
  getBearerKeyDao: () => ({ hashLegacyTokens: async () => 0 }),
}));

import config from '../../src/config/index.js';
import { AppServer } from '../../src/server.js';

const flushPromises = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('AppServer smart routing group paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SMART_ROUTING_PATH;
    config.smartRoutingPath = '$smart';
    config.basePath = '';
    handleMcpOtherRequestMock.mockImplementation((_req, res) => res.status(204).send());
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

describe('custom smart routing path', () => {
  beforeEach(() => {
    findGroupsMock.mockResolvedValue([]);
    findServersMock.mockResolvedValue([]);
    handleMcpPostRequestMock.mockImplementation((_req, res) => res.status(204).send());
    handleMcpOtherRequestMock.mockImplementation((_req, res) => res.status(204).send());
  });
  afterEach(() => {
    delete process.env.SMART_ROUTING_PATH;
    config.smartRoutingPath = '$smart';
    config.basePath = '';
  });

  it.each(['post', 'get', 'delete'] as const)(
    'normalizes aliases before auth for %s without rewriting the resource URL',
    async (method) => {
      process.env.SMART_ROUTING_PATH = 'my_smart';
      config.smartRoutingPath = 'my_smart';
      config.basePath = '/hub';
      const server = new AppServer();
      await server.initialize();
      await flushPromises();
      const listener = await new Promise<import('node:http').Server>((resolve) => {
        const listening = server.getApp().listen(0, '127.0.0.1', () => resolve(listening));
      });
      try {
        for (const [path, group, user] of [
          ['/mcp/my_smart', '$smart', undefined],
          ['/mcp/my_smart/team', '$smart/team', undefined],
          ['/alice/mcp/my_smart/team', '$smart/team', 'alice'],
          ['/mcp/$smart/team', '$smart/team', undefined],
          ['/mcp/my_smart-other', 'my_smart-other', undefined],
        ]) {
          sseUserContextMiddlewareMock.mockClear();
          sseUserContextMiddlewareMock.mockImplementation((req, _res, next) => {
            expect(req.params.group).toBe(group);
            expect(req.params.user).toBe(user);
            expect(req.originalUrl).toBe(`/hub${path}`);
            next();
          });
          await request(listener)[method](`/hub${path}`).expect(204);
          expect(sseUserContextMiddlewareMock).toHaveBeenCalledTimes(1);
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          listener.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
  it.each(['server', 'group', 'group-id'])('rejects a startup %s collision', async (kind) => {
    process.env.SMART_ROUTING_PATH = 'my_smart';
    config.smartRoutingPath = 'my_smart';
    if (kind === 'server') findServersMock.mockResolvedValue([{ name: 'my_smart' }]);
    else
      findGroupsMock.mockResolvedValue([
        {
          name: kind === 'group' ? 'my_smart' : 'team',
          id: kind === 'group-id' ? 'my_smart' : 'team-id',
        },
      ]);
    await expect(new AppServer().initialize()).rejects.toThrow('reserved');
  });
});
