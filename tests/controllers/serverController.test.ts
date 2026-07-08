import { Request, Response } from 'express';

const mockServerDao = {
  findById: jest.fn(),
  findAll: jest.fn(),
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

const mockUserDao = {
  findAll: jest.fn(),
};

const mockGroupDao = {
  findAll: jest.fn(),
};

const mockUserConfigDao = {
  getAll: jest.fn(),
};

const mockOAuthClientDao = {
  findAll: jest.fn(),
};

const mockOAuthTokenDao = {
  findAll: jest.fn(),
};

const mockBearerKeyDao = {
  findAll: jest.fn(),
};

const mockNotifyToolChanged = jest.fn();
const mockBroadcastToolListChanged = jest.fn();
const mockBroadcastPromptListChanged = jest.fn();
const mockBroadcastResourceListChanged = jest.fn();
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
const mockDisconnectUpstreamOAuth = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getUserDao: jest.fn(() => mockUserDao),
  getGroupDao: jest.fn(() => mockGroupDao),
  getSystemConfigDao: jest.fn(() => mockSystemConfigDao),
  getUserConfigDao: jest.fn(() => mockUserConfigDao),
  getOAuthClientDao: jest.fn(() => mockOAuthClientDao),
  getOAuthTokenDao: jest.fn(() => mockOAuthTokenDao),
  getBearerKeyDao: jest.fn(() => mockBearerKeyDao),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: mockGetServersInfo,
  addServer: mockAddServer,
  addOrUpdateServer: mockAddOrUpdateServer,
  removeServer: mockRemoveServer,
  getServerByName: jest.fn(() => mockGetServerByName()),
  notifyToolChanged: jest.fn(() => mockNotifyToolChanged()),
  broadcastToolListChanged: jest.fn(() => mockBroadcastToolListChanged()),
  broadcastPromptListChanged: jest.fn(() => mockBroadcastPromptListChanged()),
  broadcastResourceListChanged: jest.fn(() => mockBroadcastResourceListChanged()),
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

jest.mock('../../src/services/upstreamOAuthDisconnectService.js', () => ({
  disconnectUpstreamOAuth: mockDisconnectUpstreamOAuth,
}));

import {
  createServer,
  disconnectServerOAuth,
  getAllSettings,
  getAllServers,
  getServerConfig,
  resetPromptDescription,
  resetResourceDescription,
  resetToolDescription,
  toggleServer,
  updateServer,
  updateSystemConfig,
} from '../../src/controllers/serverController.js';

describe('serverController - getAllSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.findAll.mockResolvedValue([]);
    mockUserDao.findAll.mockResolvedValue([]);
    mockGroupDao.findAll.mockResolvedValue([]);
    mockSystemConfigDao.get.mockResolvedValue({
      install: {
        baseUrl: 'https://hub.example.com',
      },
    });
    mockUserConfigDao.getAll.mockResolvedValue([]);
    mockOAuthClientDao.findAll.mockResolvedValue([]);
    mockOAuthTokenDao.findAll.mockResolvedValue([]);
    mockBearerKeyDao.findAll.mockResolvedValue([
      {
        id: 'alice-key',
        name: 'alice',
        token: 'mcphub_abcdefghijklmnopqrstuvwxyz',
        enabled: true,
        kind: 'user',
        owner: 'alice',
        accessType: 'all',
      },
      {
        id: 'bob-key',
        name: 'bob',
        token: 'mcphub_abcdefghijklmnopqrstuvwxyz',
        enabled: true,
        kind: 'user',
        owner: 'bob',
        accessType: 'all',
      },
      {
        id: 'system-key',
        name: 'system',
        token: 'mcphub_abcdefghijklmnopqrstuvwxyz',
        enabled: true,
        kind: 'system',
        accessType: 'all',
      },
    ]);
  });

  it('returns only the current user keys to non-admin users', async () => {
    const req = {
      user: {
        username: 'alice',
        isAdmin: false,
      },
    } as unknown as Request;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await getAllSettings(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        mcpServers: {},
        systemConfig: {
          install: {
            baseUrl: 'https://hub.example.com',
          },
        },
        bearerKeys: [
          expect.objectContaining({
            id: 'alice-key',
            kind: 'user',
            owner: 'alice',
            token: 'mcphub_a...wxyz',
          }),
        ],
      },
    });
  });
});

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

// Regression test for issue #959: OpenAPI specs loaded via URL can define
// recursive JSON schemas. SwaggerParser.dereference turns those $ref cycles
// into live circular references on the tool inputSchemas held in serverInfos.
// getServerConfig must return a JSON-serializable payload (matching the list
// endpoint's use of createSafeJSON), otherwise res.json throws and the edit
// modal reports "Could not find configuration data for <server>".
describe('serverController - getServerConfig openapi circular schemas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a JSON-serializable response when openapi tool inputSchemas are circular', async () => {
    // Recursive OpenAPI schema: after dereference, `properties.self` points
    // back at the schema object — exactly the cycle JSON.stringify rejects.
    const recursiveSchema: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };
    (recursiveSchema.properties as Record<string, unknown>).self = recursiveSchema;

    mockServerDao.findById.mockResolvedValue({
      name: 'seerr',
      type: 'openapi',
      openapi: { url: 'https://example.com/seerr-api.yml' },
      owner: 'admin',
      visibility: 'private',
      enabled: true,
    });
    mockGetServersInfo.mockResolvedValue([
      {
        name: 'seerr',
        status: 'connected',
        tools: [
          {
            name: 'seerr-get_movie',
            description: 'Get a movie',
            inputSchema: recursiveSchema,
          },
        ],
      },
    ]);

    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'seerr' },
      user: { username: 'admin', isAdmin: true },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await getServerConfig(req, res);

    expect(status).not.toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledTimes(1);
    const responseArg = json.mock.calls[0][0];
    // Express res.json JSON.stringifies the payload; circular inputSchemas
    // would make it throw. The payload must therefore be serializable.
    expect(() => JSON.stringify(responseArg)).not.toThrow();
    expect(responseArg).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          name: 'seerr',
          status: 'connected',
          config: expect.objectContaining({
            type: 'openapi',
            openapi: { url: 'https://example.com/seerr-api.yml' },
          }),
        }),
      }),
    );
  });
});

describe('serverController - system bearer auth context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates server with stable owner from system bearer user context', async () => {
    mockAddServer.mockResolvedValue({ success: true });

    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      body: {
        name: 'openapi-server',
        config: {
          type: 'openapi',
          openapi: {
            url: 'https://api.example.com/openapi.json',
            version: '3.1.0',
          },
        },
      },
      user: {
        username: 'system-owner',
        isAdmin: true,
      },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await createServer(req, res);

    expect(mockAddServer).toHaveBeenCalledWith(
      'openapi-server',
      expect.objectContaining({
        owner: 'system-owner',
        type: 'openapi',
      }),
    );
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: 'Server added successfully',
    });
  });

  it('allows reading an existing server with system bearer admin context', async () => {
    mockServerDao.findById.mockResolvedValue({
      name: 'existing-server',
      type: 'openapi',
      url: 'https://api.example.com/openapi.json',
      owner: 'system-owner',
      visibility: 'private',
    });
    mockGetServersInfo.mockResolvedValue([
      { name: 'existing-server', status: 'connected', tools: [] },
    ]);

    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'existing-server' },
      user: {
        username: 'system-owner',
        isAdmin: true,
      },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await getServerConfig(req, res);

    expect(mockServerDao.findById).toHaveBeenCalledWith('existing-server');
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        name: 'existing-server',
        status: 'connected',
        tools: [],
        config: expect.objectContaining({
          type: 'openapi',
          url: 'https://api.example.com/openapi.json',
        }),
      },
    });
  });

  it('allows updating an existing server with system bearer admin context', async () => {
    mockServerDao.findById.mockResolvedValue({
      name: 'existing-server',
      type: 'openapi',
      url: 'https://api.example.com/openapi.json',
      owner: 'system-owner',
      visibility: 'private',
    });
    mockAddOrUpdateServer.mockResolvedValue({ success: true });

    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'existing-server' },
      body: {
        config: {
          type: 'openapi',
          openapi: {
            url: 'https://api.example.com/v2/openapi.json',
            version: '3.1.0',
          },
          visibility: 'public',
        },
      },
      user: {
        username: 'system-owner',
        isAdmin: true,
      },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await updateServer(req, res);

    expect(mockAddOrUpdateServer).toHaveBeenCalledWith(
      'existing-server',
      expect.objectContaining({
        visibility: 'public',
      }),
      true,
    );
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: 'Server updated successfully',
    });
  });

  it('denies non-admin user from reading another users server', async () => {
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

describe('serverController - toggleServer (issue #938)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.findById.mockResolvedValue({
      name: 'target',
      owner: 'admin',
    });
    mockToggleServerStatus.mockResolvedValue({ success: true });
  });

  const makeReqRes = (enabled: boolean) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'target' },
      body: { enabled },
      user: { username: 'admin', isAdmin: true },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;
    return { req, res, json, status };
  };

  // toggleServerStatus already scopes work to the target server (disable closes
  // it; enable runs a targeted initializeClientsFromSettings(false, name)). The
  // controller must NOT call the unscoped notifyToolChanged(), which would
  // re-initialize every non-connected server in the fleet and spike CPU.
  //
  // On enable, the connection completes asynchronously and mcpService broadcasts
  // itself once tools/prompts/resources are loaded — so the controller must NOT
  // broadcast here (it would race ahead and push a stale, empty list). On
  // disable, work is synchronous, so the controller broadcasts all three lists.
  it('enabling a server does not broadcast from the controller (mcpService broadcasts after load)', async () => {
    const { req, res, json } = makeReqRes(true);

    await toggleServer(req, res);

    expect(mockToggleServerStatus).toHaveBeenCalledWith('target', true);
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockBroadcastToolListChanged).not.toHaveBeenCalled();
    expect(mockBroadcastPromptListChanged).not.toHaveBeenCalled();
    expect(mockBroadcastResourceListChanged).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('disabling a server broadcasts tools/prompts/resources and does not trigger a fleet-wide re-init', async () => {
    const { req, res, json } = makeReqRes(false);

    await toggleServer(req, res);

    expect(mockToggleServerStatus).toHaveBeenCalledWith('target', false);
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockBroadcastToolListChanged).toHaveBeenCalledTimes(1);
    expect(mockBroadcastPromptListChanged).toHaveBeenCalledTimes(1);
    expect(mockBroadcastResourceListChanged).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });
});

describe('serverController - disconnectServerOAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.findById.mockResolvedValue({
      name: 'notion',
      owner: 'admin',
      oauth: {
        accessToken: 'access-token',
      },
    });
    mockDisconnectUpstreamOAuth.mockResolvedValue({
      success: true,
      scope: 'tokens',
      revoked: {
        attempted: 1,
        succeeded: 1,
        failed: 0,
      },
      revocationEndpoint: 'https://issuer.example.com/oauth/revoke',
    });
  });

  const makeReqRes = (body: Record<string, unknown> = {}) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'notion' },
      body,
      user: { username: 'admin', isAdmin: true },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;
    return { req, res, json, status };
  };

  it('disconnects upstream OAuth with token scope by default', async () => {
    const { req, res, json } = makeReqRes();

    await disconnectServerOAuth(req, res);

    expect(mockDisconnectUpstreamOAuth).toHaveBeenCalledWith('notion', { scope: 'tokens' });
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: 'Server notion OAuth disconnected successfully',
      data: {
        scope: 'tokens',
        revoked: {
          attempted: 1,
          succeeded: 1,
          failed: 0,
        },
        revocationEndpoint: 'https://issuer.example.com/oauth/revoke',
      },
    });
  });

  it('rejects unsupported disconnect scopes', async () => {
    const { req, res, status, json } = makeReqRes({ scope: 'client' });

    await disconnectServerOAuth(req, res);

    expect(mockDisconnectUpstreamOAuth).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'OAuth disconnect scope must be "tokens" or "all"',
    });
  });
});
