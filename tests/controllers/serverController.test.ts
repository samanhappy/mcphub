import { Request, Response } from 'express';

const mockServerDao = {
  findById: jest.fn(),
  findAllPaginated: jest.fn(),
  findByOwnerPaginated: jest.fn(),
  findVisibleToUserPaginated: jest.fn(),
  updateTools: jest.fn(),
  updatePrompts: jest.fn(),
  updateResources: jest.fn(),
};

const mockSystemConfigDao = {
  get: jest.fn(),
  update: jest.fn(),
};

const mockNotifyToolChanged = jest.fn();
const mockBroadcastToolListChanged = jest.fn();
const mockSyncToolEmbedding = jest.fn();
const mockGetServerByName = jest.fn();
const mockAddServer = jest.fn();
const mockAddOrUpdateServer = jest.fn();
const mockRemoveServer = jest.fn();
const mockToggleServerStatus = jest.fn();
const mockReconnectServer = jest.fn();
const mockUpdateServerInfoVisibility = jest.fn();
const mockGetServersInfo = jest.fn();
const mockGetCurrentUser = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getGroupDao: jest.fn(),
  getSystemConfigDao: jest.fn(() => mockSystemConfigDao),
  getBearerKeyDao: jest.fn(),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: mockGetServersInfo,
  addServer: mockAddServer,
  addOrUpdateServer: mockAddOrUpdateServer,
  removeServer: mockRemoveServer,
  getServerByName: jest.fn(() => mockGetServerByName()),
  notifyToolChanged: jest.fn(() => mockNotifyToolChanged()),
  broadcastToolListChanged: jest.fn(() => mockBroadcastToolListChanged()),
  syncToolEmbedding: jest.fn((...args: unknown[]) => mockSyncToolEmbedding(...args)),
  toggleServerStatus: mockToggleServerStatus,
  reconnectServer: mockReconnectServer,
  updateServerInfoVisibility: jest.fn((...args: unknown[]) => mockUpdateServerInfoVisibility(...args)),
}));

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({
      getCurrentUser: mockGetCurrentUser,
    })),
  },
}));

import {
  createServer,
  getAllServers,
  getServerConfig,
  resetPromptDescription,
  resetResourceDescription,
  resetToolDescription,
  updateServer,
  updateSystemConfig,
} from '../../src/controllers/serverController.js';

describe('serverController - updateSystemConfig', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      body: {
        routing: {
          bearerAuthHeaderName: 'X-MCP-Authorization',
          jsonBodyLimit: '2mb',
        },
      },
    };

    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockSystemConfigDao.get.mockResolvedValue({
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        bearerAuthKey: '',
        bearerAuthHeaderName: 'Authorization',
        jsonBodyLimit: '1mb',
        skipAuth: false,
      },
    });
    mockSystemConfigDao.update.mockResolvedValue(true);
  });

  it('persists bearer auth header name and JSON body limit routing settings', async () => {
    await updateSystemConfig(mockRequest as Request, mockResponse as Response);

    expect(mockSystemConfigDao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: expect.objectContaining({
          bearerAuthHeaderName: 'X-MCP-Authorization',
          jsonBodyLimit: '2mb',
        }),
      }),
    );

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          routing: expect.objectContaining({
            bearerAuthHeaderName: 'X-MCP-Authorization',
            jsonBodyLimit: '2mb',
          }),
        }),
      }),
    );
  });

  it('persists Better Auth settings via auth.betterAuth', async () => {
    mockRequest.body = {
      auth: {
        betterAuth: {
          enabled: true,
          basePath: '/custom-auth',
          trustedOrigins: ['https://mcp.example.com', '  '],
          providers: {
            google: {
              enabled: true,
            },
            github: {
              enabled: false,
            },
            oidc: {
              enabled: true,
              providerId: ' local-oidc ',
              discoveryUrl: ' https://auth.example.com/.well-known/openid-configuration ',
              scopes: ['openid', 'profile', 'email'],
              pkce: false,
              prompt: 'login consent',
            },
          },
        },
      },
    };

    mockSystemConfigDao.get.mockResolvedValue({
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        bearerAuthKey: '',
        bearerAuthHeaderName: 'Authorization',
        jsonBodyLimit: '1mb',
        skipAuth: false,
      },
      auth: {},
    });

    await updateSystemConfig(mockRequest as Request, mockResponse as Response);

    expect(mockSystemConfigDao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: {
          betterAuth: {
            enabled: true,
            basePath: '/custom-auth',
            trustedOrigins: ['https://mcp.example.com'],
            providers: {
              google: {
                enabled: true,
              },
              github: {
                enabled: false,
              },
              oidc: {
                enabled: true,
                providerId: 'local-oidc',
                discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
                scopes: ['openid', 'profile', 'email'],
                pkce: false,
                prompt: 'login consent',
              },
            },
          },
        },
      }),
    );

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          auth: expect.objectContaining({
            betterAuth: expect.objectContaining({
              enabled: true,
              basePath: '/custom-auth',
            }),
          }),
        }),
      }),
    );
  });
});

describe('serverController - resetToolDescription', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      params: {
        serverName: 'test-server',
        toolName: 'test-server::search',
      },
      user: {
        username: 'admin',
        isAdmin: true,
      },
    };

    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      tools: {
        'test-server::search': {
          enabled: true,
          description: 'Custom description',
        },
      },
    });
    mockServerDao.updateTools.mockResolvedValue(true);
    mockGetServerByName.mockReturnValue({
      tools: [
        {
          name: 'test-server::search',
          description: 'Default description',
        },
      ],
    });
  });

  it('removes the description override and returns the upstream default description', async () => {
    await resetToolDescription(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.updateTools).toHaveBeenCalledWith('test-server', {});
    expect(mockNotifyToolChanged).toHaveBeenCalled();
    expect(mockSyncToolEmbedding).toHaveBeenCalledWith('test-server', 'test-server::search');
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Tool test-server::search description reset successfully',
      data: {
        description: 'Default description',
      },
    });
  });

  it('preserves a disabled tool override while clearing the description override', async () => {
    mockServerDao.findById.mockResolvedValueOnce({
      name: 'test-server',
      tools: {
        'test-server::search': {
          enabled: false,
          description: 'Custom description',
        },
      },
    });

    await resetToolDescription(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.updateTools).toHaveBeenCalledWith('test-server', {
      'test-server::search': {
        enabled: false,
      },
    });
  });

  it('returns 404 when the server does not exist', async () => {
    mockServerDao.findById.mockResolvedValueOnce(null);

    await resetToolDescription(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      message: 'Server not found',
    });
  });
});

describe('serverController - updateServer', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      params: {
        name: 'test-server',
      },
      body: {
        config: {
          type: 'sse',
          url: 'https://example.com/sse',
          enabled: true,
          owner: 'admin',
          visibility: 'public',
        },
      },
      user: {
        username: 'admin',
        isAdmin: true,
      },
    };

    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
      owner: 'admin',
      visibility: 'private',
    });
    mockServerDao.update = jest.fn().mockResolvedValue({
      name: 'test-server',
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
      owner: 'admin',
      visibility: 'public',
    });
  });

  it('updates visibility without reinitializing the server runtime', async () => {
    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).toHaveBeenCalledWith('test-server', {
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
      owner: 'admin',
      visibility: 'public',
      description: undefined,
      options: undefined,
      command: undefined,
      args: undefined,
      env: undefined,
      headers: undefined,
      passthroughHeaders: undefined,
      oauth: undefined,
      enableKeepAlive: false,
      keepAliveInterval: 60000,
      openapi: undefined,
    });
    expect(mockUpdateServerInfoVisibility).toHaveBeenCalledWith('test-server', 'public');
    expect(mockBroadcastToolListChanged).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Server updated successfully',
    });
  });
});

describe('serverController - resetPromptDescription', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();
    mockRequest = {
      params: {
        serverName: 'test-server',
        promptName: 'test-server::prompt',
      },
      user: {
        username: 'admin',
        isAdmin: true,
      },
    };
    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      prompts: {
        'test-server::prompt': {
          enabled: true,
          description: 'Custom prompt description',
        },
      },
    });
    mockServerDao.updatePrompts.mockResolvedValue(true);
    mockGetServerByName.mockReturnValue({
      prompts: [
        {
          name: 'test-server::prompt',
          description: 'Default prompt description',
        },
      ],
    });
  });

  it('removes the prompt description override and returns the upstream default description', async () => {
    await resetPromptDescription(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.updatePrompts).toHaveBeenCalledWith('test-server', {});
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Prompt test-server::prompt description reset successfully',
      data: {
        description: 'Default prompt description',
      },
    });
  });
});

describe('serverController - resetResourceDescription', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();
    mockRequest = {
      params: {
        serverName: 'test-server',
        resourceUri: 'resource://test',
      },
      user: {
        username: 'admin',
        isAdmin: true,
      },
    };
    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      resources: {
        'resource://test': {
          enabled: true,
          description: 'Custom resource description',
        },
      },
    });
    mockServerDao.updateResources.mockResolvedValue(true);
    mockGetServerByName.mockReturnValue({
      resources: [
        {
          uri: 'resource://test',
          description: 'Default resource description',
        },
      ],
    });
  });

  it('removes the resource description override and returns the upstream default description', async () => {
    await resetResourceDescription(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.updateResources).toHaveBeenCalledWith('test-server', {});
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Resource resource://test description reset successfully',
      data: {
        description: 'Default resource description',
      },
    });
  });
});

describe('serverController - authorization hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-admin stdio server creation', async () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      body: {
        name: 'stdio-server',
        config: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      },
      user: {
        username: 'alice',
        isAdmin: false,
      },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await createServer(req, res);

    expect(mockAddServer).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Only admins can create or modify stdio-based servers',
    });
  });

  it('rejects reading another user server by direct name lookup', async () => {
    mockServerDao.findById.mockResolvedValue({
      name: 'shared-server',
      owner: 'bob',
    });

    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'shared-server' },
      user: {
        username: 'alice',
        isAdmin: false,
      },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await getServerConfig(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Forbidden',
    });
  });
});

describe('serverController - getAllServers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUser.mockReturnValue(undefined);
    mockServerDao.findAllPaginated.mockResolvedValue({
      data: [{ name: 'alpha' }],
      page: 1,
      limit: 5,
      total: 2,
      totalPages: 1,
    });
    mockServerDao.findByOwnerPaginated.mockResolvedValue({
      data: [{ name: 'alpha' }],
      page: 1,
      limit: 5,
      total: 2,
      totalPages: 1,
    });
    mockServerDao.findVisibleToUserPaginated.mockResolvedValue({
      data: [{ name: 'alpha' }],
      page: 1,
      limit: 5,
      total: 2,
      totalPages: 1,
    });
  });

  it('returns allServers alongside paginated data to support dashboard consumers without a second request', async () => {
    mockGetServersInfo
      .mockResolvedValueOnce([{ name: 'alpha', status: 'connected', tools: [] }])
      .mockResolvedValueOnce([
        { name: 'alpha', status: 'connected', tools: [] },
        { name: 'beta', status: 'disconnected', tools: [] },
      ]);

    const json = jest.fn();
    const req = {
      query: {
        page: '1',
        limit: '5',
      },
    } as unknown as Request;
    const res = { json } as unknown as Response;

    await getAllServers(req, res);

    expect(mockGetServersInfo).toHaveBeenNthCalledWith(1, 1, 5, undefined);
    expect(mockGetServersInfo).toHaveBeenNthCalledWith(2, undefined, undefined, undefined);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: [{ name: 'alpha', status: 'connected', tools: [] }],
      allServers: [
        { name: 'alpha', status: 'connected', tools: [] },
        { name: 'beta', status: 'disconnected', tools: [] },
      ],
      pagination: {
        page: 1,
        limit: 5,
        total: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });
  });

  it('uses visibility-aware pagination for non-admin users', async () => {
    mockGetCurrentUser.mockReturnValue({
      username: 'alice',
      isAdmin: false,
    });
    mockServerDao.findVisibleToUserPaginated.mockResolvedValue({
      data: [{ name: 'alice-private' }, { name: 'shared-public' }],
      page: 1,
      limit: 5,
      total: 7,
      totalPages: 2,
    });
    mockGetServersInfo
      .mockResolvedValueOnce([
        { name: 'alice-private', status: 'connected', tools: [] },
        { name: 'shared-public', status: 'disconnected', tools: [] },
      ])
      .mockResolvedValueOnce([
        { name: 'alice-private', status: 'connected', tools: [] },
        { name: 'shared-public', status: 'disconnected', tools: [] },
      ]);

    const json = jest.fn();
    const req = {
      query: {
        page: '1',
        limit: '5',
      },
    } as unknown as Request;
    const res = { json } as unknown as Response;

    await getAllServers(req, res);

    expect(mockServerDao.findVisibleToUserPaginated).toHaveBeenCalledWith('alice', 1, 5);
    expect(mockServerDao.findByOwnerPaginated).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        pagination: expect.objectContaining({
          total: 7,
          totalPages: 2,
        }),
      }),
    );
  });
});
