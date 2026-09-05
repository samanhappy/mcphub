import { Request, Response } from 'express';

const mockServerDao = {
  findById: jest.fn(),
  findAll: jest.fn(),
  findAllPaginated: jest.fn(),
  findByOwnerPaginated: jest.fn(),
  findVisibleToUserPaginated: jest.fn(),
  exists: jest.fn(),
  rename: jest.fn(),
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
  updateServerName: jest.fn(),
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
  updateServerName: jest.fn(),
};

const mockRemoveServerToolEmbeddings = jest.fn();
const mockNotifyToolChanged = jest.fn();
const mockBroadcastToolListChanged = jest.fn();
const mockBroadcastPromptListChanged = jest.fn();
const mockBroadcastResourceListChanged = jest.fn();
const mockSyncToolEmbedding = jest.fn();
const mockGetServerByName = jest.fn();
const mockAddServer = jest.fn();
const mockAddOrUpdateServer = jest.fn();
const mockRemoveServer = jest.fn();
const mockCloseServer = jest.fn();
const mockToggleServerStatus = jest.fn();
const mockReconnectServer = jest.fn();
const mockUpdateServerInfoVisibility = jest.fn();
const mockGetServersInfo = jest.fn();
const mockGetCurrentUser = jest.fn();
const mockDisconnectUpstreamOAuth = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: jest.fn(() => ({ delete: jest.fn().mockResolvedValue(undefined) })),
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
  closeServer: jest.fn((...args: unknown[]) => mockCloseServer(...args)),
  getServerByName: jest.fn(() => mockGetServerByName()),
  notifyToolChanged: jest.fn(() => mockNotifyToolChanged()),
  broadcastToolListChanged: jest.fn(() => mockBroadcastToolListChanged()),
  broadcastPromptListChanged: jest.fn(() => mockBroadcastPromptListChanged()),
  broadcastResourceListChanged: jest.fn(() => mockBroadcastResourceListChanged()),
  syncToolEmbedding: jest.fn((...args: unknown[]) => mockSyncToolEmbedding(...args)),
  toggleServerStatus: mockToggleServerStatus,
  reconnectServer: mockReconnectServer,
  updateServerInfoVisibility: jest.fn((...args: unknown[]) =>
    mockUpdateServerInfoVisibility(...args),
  ),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  syncAllServerToolsEmbeddings: jest.fn(),
  removeServerToolEmbeddings: jest.fn((...args: unknown[]) =>
    mockRemoveServerToolEmbeddings(...args),
  ),
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
  batchCreateServers,
  createServer,
  disconnectServerOAuth,
  getAllSettings,
  getAllServers,
  getServerConfig,
  getServerShareCandidates,
  resetPromptDescription,
  resetResourceDescription,
  resetToolDescription,
  toggleServer,
  updateServer,
  updateSystemConfig,
} from '../../src/controllers/serverController.js';

describe('serverController - server share candidates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.findById.mockResolvedValue({
      name: 'team-server',
      owner: 'bob',
      visibility: 'group',
    });
    mockUserDao.findAll.mockResolvedValue([
      { username: 'charlie', password: 'secret', isAdmin: false },
      { username: 'bob', password: 'secret', isAdmin: false },
      { username: 'alice', password: 'secret', isAdmin: false },
    ]);
  });

  it('returns sorted usernames to the server owner without passwords', async () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'team-server' },
      user: { username: 'bob', isAdmin: false },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await getServerShareCandidates(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: ['alice', 'charlie'],
    });
  });

  it('treats an empty/missing owner as "admin" so admin is excluded from candidates', async () => {
    mockServerDao.findById.mockResolvedValue({
      name: 'orphan-server',
      owner: '',
      visibility: 'group',
    });
    mockUserDao.findAll.mockResolvedValue([
      { username: 'charlie', password: 'secret', isAdmin: false },
      { username: 'admin', password: 'secret', isAdmin: true },
      { username: 'alice', password: 'secret', isAdmin: false },
    ]);

    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'orphan-server' },
      user: { username: 'admin', isAdmin: true },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await getServerShareCandidates(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: ['alice', 'charlie'],
    });
  });

  it('rejects a shared user who does not own the server', async () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'team-server' },
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await getServerShareCandidates(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(mockUserDao.findAll).not.toHaveBeenCalled();
  });
});

describe('serverController - stdio servers without arguments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddServer.mockResolvedValue({ success: true });
    mockAddOrUpdateServer.mockResolvedValue({ success: true });
    mockNotifyToolChanged.mockResolvedValue(undefined);
    mockServerDao.update = jest.fn().mockResolvedValue({
      name: 'no-args-server',
      type: 'stdio',
      command: '/usr/bin/some-tool',
      args: [],
      owner: 'admin',
      visibility: 'private',
    });
    mockServerDao.findById.mockResolvedValue({
      name: 'no-args-server',
      type: 'stdio',
      command: '/usr/bin/some-tool',
      args: [],
      owner: 'admin',
      visibility: 'private',
    });
  });

  const createResponse = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    return { json, status, response: { json, status } as unknown as Response };
  };

  const adminUser = {
    username: 'admin',
    isAdmin: true,
  };

  it('creates a stdio server with an empty arguments array', async () => {
    const { json, status, response } = createResponse();
    const request = {
      body: {
        name: 'no-args-server',
        config: {
          type: 'stdio',
          command: '/usr/bin/some-tool',
          args: [],
        },
      },
      user: adminUser,
    } as unknown as Request;

    await createServer(request, response);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(mockAddServer).toHaveBeenCalledWith(
      'no-args-server',
      expect.objectContaining({
        type: 'stdio',
        command: '/usr/bin/some-tool',
      }),
    );
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: 'Server added successfully',
    });
  });

  it('updates a stdio server with an empty arguments array', async () => {
    const { json, status, response } = createResponse();
    const request = {
      params: { name: 'no-args-server' },
      body: {
        config: {
          type: 'stdio',
          command: '/usr/bin/some-tool',
          args: [],
        },
      },
      user: adminUser,
    } as unknown as Request;

    await updateServer(request, response);

    expect(status).not.toHaveBeenCalledWith(400);
    // The payload is identical to the stored connection config (a no-op edit),
    // so it takes the fast path: persisted via DAO update, no runtime reload.
    expect(mockServerDao.update).toHaveBeenCalledWith(
      'no-args-server',
      expect.objectContaining({
        type: 'stdio',
        command: '/usr/bin/some-tool',
      }),
    );
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: 'Server updated successfully',
    });
  });

  it('imports a stdio server with an empty arguments array', async () => {
    const { json, status, response } = createResponse();
    const request = {
      body: {
        servers: [
          {
            name: 'no-args-server',
            config: {
              type: 'stdio',
              command: '/usr/bin/some-tool',
              args: [],
            },
          },
        ],
      },
      user: adminUser,
    } as unknown as Request;

    await batchCreateServers(request, response);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockAddServer).toHaveBeenCalledWith(
      'no-args-server',
      expect.objectContaining({
        type: 'stdio',
        command: '/usr/bin/some-tool',
      }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          successCount: 1,
          failureCount: 0,
        }),
      }),
    );
  });
});

describe('serverController - server name charset validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddServer.mockResolvedValue({ success: true });
  });

  const createResponse = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    return { json, status, response: { json, status } as unknown as Response };
  };

  const adminUser = {
    username: 'admin',
    isAdmin: true,
  };

  const validConfig = {
    type: 'sse',
    url: 'http://localhost:3001/mcp',
  };

  it('rejects a server name containing spaces on create', async () => {
    const { json, status, response } = createResponse();
    const request = {
      body: { name: 'my server', config: validConfig },
      user: adminUser,
    } as unknown as Request;

    await createServer(request, response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('only contain letters'),
      }),
    );
    expect(mockAddServer).not.toHaveBeenCalled();
  });

  it('rejects a server name with non-ASCII (CJK) characters on create', async () => {
    const { json, status, response } = createResponse();
    const request = {
      body: { name: '我的伺服器', config: validConfig },
      user: adminUser,
    } as unknown as Request;

    await createServer(request, response);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockAddServer).not.toHaveBeenCalled();
  });

  it('rejects a registry-style reverse-DNS name on create (path separator)', async () => {
    const { json, status, response } = createResponse();
    const request = {
      body: { name: 'io.github.user/weather', config: validConfig },
      user: adminUser,
    } as unknown as Request;

    await createServer(request, response);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockAddServer).not.toHaveBeenCalled();
  });

  it('accepts a trimmed valid name on create', async () => {
    const { status, response } = createResponse();
    const request = {
      body: { name: '  weather-server  ', config: validConfig },
      user: adminUser,
    } as unknown as Request;

    await createServer(request, response);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(mockAddServer).toHaveBeenCalledWith(
      'weather-server',
      expect.objectContaining({ type: 'sse' }),
    );
  });

  it('reports an invalid name as a failed item in batch import', async () => {
    const { json, status, response } = createResponse();
    const request = {
      body: {
        servers: [
          { name: 'ok-server', config: validConfig },
          { name: 'bad server', config: validConfig },
        ],
      },
      user: adminUser,
    } as unknown as Request;

    await batchCreateServers(request, response);

    expect(status).toHaveBeenCalledWith(207);
    expect(mockAddServer).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          successCount: 1,
          failureCount: 1,
          results: expect.arrayContaining([
            expect.objectContaining({
              name: 'bad server',
              success: false,
              message: expect.stringContaining('only contain letters'),
            }),
          ]),
        }),
      }),
    );
  });

  it('rejects an invalid newName when renaming', async () => {
    mockServerDao.findById.mockResolvedValue({
      name: 'old-server',
      type: 'sse',
      url: 'http://localhost:3001/mcp',
      owner: 'admin',
      visibility: 'private',
    });

    const { json, status, response } = createResponse();
    const request = {
      params: { name: 'old-server' },
      body: {
        config: { type: 'sse', url: 'http://localhost:3001/mcp' },
        newName: 'new server',
      },
      user: adminUser,
    } as unknown as Request;

    await updateServer(request, response);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockServerDao.rename).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('only contain letters'),
      }),
    );
  });
});

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
      user: {
        username: 'admin',
        isAdmin: true,
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

  it('rejects system configuration updates from non-admin users', async () => {
    mockRequest.user = {
      username: 'regular-user',
      isAdmin: false,
    };
    mockRequest.body = {
      routing: {
        skipAuth: true,
      },
    };

    await updateSystemConfig(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(403);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      message: 'Admin privileges required',
    });
    expect(mockSystemConfigDao.get).not.toHaveBeenCalled();
    expect(mockSystemConfigDao.update).not.toHaveBeenCalled();
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

  it('persists a positive embedding dimension setting', async () => {
    mockRequest.body = {
      smartRouting: {
        embeddingDimensions: 768,
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
      smartRouting: {
        enabled: false,
        dbUrl: 'postgres://localhost/test',
        embeddingProvider: 'openai',
        openaiApiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: 'sk-test',
        openaiApiEmbeddingModel: 'text-embedding-3-small',
      },
    });

    await updateSystemConfig(mockRequest as Request, mockResponse as Response);

    expect(mockSystemConfigDao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        smartRouting: expect.objectContaining({
          embeddingDimensions: 768,
        }),
      }),
    );
  });

  it('persists Better Auth settings via auth.betterAuth', async () => {
    mockRequest.body = {
      auth: {
        betterAuth: {
          enabled: true,
          baseUrl: ' https://mcp.example.com ',
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
            baseUrl: 'https://mcp.example.com',
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

  it('persists a baseUrl-only Better Auth update', async () => {
    mockRequest.body = {
      auth: {
        betterAuth: {
          baseUrl: ' https://mcp.example.com ',
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

    expect(mockStatus).not.toHaveBeenCalledWith(400);

    expect(mockSystemConfigDao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          betterAuth: expect.objectContaining({
            baseUrl: 'https://mcp.example.com',
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
    expect(mockUpdateServerInfoVisibility).toHaveBeenCalledWith('test-server', 'public', undefined);
    expect(mockBroadcastToolListChanged).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Server updated successfully',
    });
  });

  it('updates the sharing allowlist without reinitializing the server runtime', async () => {
    mockRequest.body.config.visibility = 'group';
    mockRequest.body.config.sharedWithUsers = ['bob'];
    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
      owner: 'admin',
      visibility: 'group',
      sharedWithUsers: ['alice'],
    });

    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).toHaveBeenCalledWith(
      'test-server',
      expect.objectContaining({
        visibility: 'group',
        sharedWithUsers: ['bob'],
      }),
    );
    expect(mockUpdateServerInfoVisibility).toHaveBeenCalledWith('test-server', 'group', ['bob']);
    expect(mockBroadcastToolListChanged).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
  });

  it('uses the access-only fast path when the payload omits enabled (real dashboard payload)', async () => {
    // The dashboard's buildServerPayload never sends `enabled`, while servers
    // created through the DAO are persisted with `enabled: true`. The comparable
    // config must therefore ignore `enabled`, or every visibility-only edit
    // would tear down and reconnect the server runtime for no reason.
    mockRequest.body.config = {
      type: 'sse',
      url: 'https://example.com/sse',
      description: '',
      visibility: 'public',
      sharedWithUsers: undefined,
      perSessionClient: undefined,
      startOnDemand: undefined,
      idleTimeoutMs: undefined,
    };
    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
      owner: 'admin',
      visibility: 'private',
    });

    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).toHaveBeenCalled();
    expect(mockUpdateServerInfoVisibility).toHaveBeenCalledWith('test-server', 'public', undefined);
    expect(mockBroadcastToolListChanged).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Server updated successfully',
    });
  });

  it('uses the access-only fast path for a sharedWithUsers-only edit (real dashboard payload)', async () => {
    // Same asymmetry as above, but for the sharing allowlist on a group server:
    // the stored record carries `enabled: true` and the existing allowlist, while
    // the dashboard payload omits `enabled`. A pure allowlist edit must not
    // tear down and reconnect the runtime either.
    mockRequest.body.config = {
      type: 'sse',
      url: 'https://example.com/sse',
      description: '',
      visibility: 'group',
      sharedWithUsers: ['alice', 'bob'],
      perSessionClient: undefined,
      startOnDemand: undefined,
      idleTimeoutMs: undefined,
    };
    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
      owner: 'admin',
      visibility: 'group',
      sharedWithUsers: ['alice'],
    });

    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).toHaveBeenCalled();
    expect(mockUpdateServerInfoVisibility).toHaveBeenCalledWith('test-server', 'group', [
      'alice',
      'bob',
    ]);
    expect(mockBroadcastToolListChanged).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Server updated successfully',
    });
  });

  it('uses the access-only fast path when the stored config carries tool/prompt/resource overrides', async () => {
    // The dashboard payload never sends `tools`/`prompts`/`resources` (they are
    // edited via dedicated endpoints and applied at read time), but a server may
    // well have such overrides persisted. If they stay part of the comparable
    // config, any access-only edit of such a server (e.g. changing the sharing
    // allowlist) tears down and reconnects the runtime for nothing.
    mockRequest.body.config = {
      type: 'stdio',
      command: 'uvx',
      args: ['--with', 'mcp<2', 'mcp-server-fetch'],
      description: '',
      options: { resetTimeoutOnProgress: true },
      visibility: 'group',
      sharedWithUsers: ['admin2', 'test2'],
      perSessionClient: undefined,
      startOnDemand: undefined,
      idleTimeoutMs: undefined,
      env: {},
    };
    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      enabled: true,
      owner: 'admin',
      type: 'stdio',
      command: 'uvx',
      args: ['--with', 'mcp<2', 'mcp-server-fetch'],
      visibility: 'group',
      options: { resetTimeoutOnProgress: true },
      prompts: {
        'test-server::fetch': {
          enabled: true,
          description: 'Custom prompt description',
        },
      },
      sharedWithUsers: ['admin2', 'test'],
    });

    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).toHaveBeenCalled();
    expect(mockUpdateServerInfoVisibility).toHaveBeenCalledWith('test-server', 'group', [
      'admin2',
      'test2',
    ]);
    expect(mockBroadcastToolListChanged).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Server updated successfully',
    });
  });

  it('does not reload the runtime for a description-only edit', async () => {
    // The server description is read-time display metadata. Changing it (while
    // every connection-relevant field stays the same) must not tear down and
    // reconnect the runtime.
    mockRequest.body.config = {
      type: 'sse',
      url: 'https://example.com/sse',
      description: 'New note text',
      visibility: 'private',
      sharedWithUsers: undefined,
      perSessionClient: undefined,
      startOnDemand: undefined,
      idleTimeoutMs: undefined,
    };
    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
      owner: 'admin',
      visibility: 'private',
      description: 'Old note text',
    });

    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).toHaveBeenCalled();
    expect(mockUpdateServerInfoVisibility).toHaveBeenCalledWith('test-server', 'private', undefined);
    expect(mockBroadcastToolListChanged).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Server updated successfully',
    });
  });

  it('reloads the runtime when a connection-relevant field changes', async () => {
    // Changing the launch command is a real connection change and must go
    // through the reload path (addOrUpdateServer + targeted reconnect).
    mockRequest.body.config = {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      description: '',
      visibility: 'private',
      sharedWithUsers: undefined,
      perSessionClient: undefined,
      startOnDemand: undefined,
      idleTimeoutMs: undefined,
      env: {},
    };
    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      enabled: true,
      owner: 'admin',
      visibility: 'private',
    });
    mockAddOrUpdateServer.mockResolvedValue({ success: true });

    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).not.toHaveBeenCalled();
    expect(mockAddOrUpdateServer).toHaveBeenCalledWith('test-server', expect.any(Object), true);
    expect(mockNotifyToolChanged).toHaveBeenCalled();
  });

  it('does not reload when the stored config carries an explicit default timeout the payload omits', async () => {
    // The old dashboard payload dropped `timeout` when it equaled the 60000
    // default. A server persisted with an explicit `timeout: 60000` (e.g. via
    // API/file import) would then differ from the payload on every edit and
    // reload for nothing. An explicit default timeout and an absent one are the
    // same effective connection setting.
    mockRequest.body.config = {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      description: '',
      options: { resetTimeoutOnProgress: true },
      visibility: 'private',
      sharedWithUsers: undefined,
      perSessionClient: undefined,
      startOnDemand: undefined,
      idleTimeoutMs: undefined,
      env: {},
    };
    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      options: { timeout: 60000, resetTimeoutOnProgress: true },
      enabled: true,
      owner: 'admin',
      visibility: 'private',
    });

    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
  });

  it('does not reload when the payload echoes the default timeout onto a server without one', async () => {
    // Mirror case: the (new) dashboard always echoes `timeout: 60000`, while a
    // form-created server has no explicit timeout persisted. The comparison must
    // treat them as equal too.
    mockRequest.body.config = {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      description: '',
      options: { timeout: 60000, resetTimeoutOnProgress: true },
      visibility: 'private',
      sharedWithUsers: undefined,
      perSessionClient: undefined,
      startOnDemand: undefined,
      idleTimeoutMs: undefined,
      env: {},
    };
    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      options: { resetTimeoutOnProgress: true },
      enabled: true,
      owner: 'admin',
      visibility: 'private',
    });

    await updateServer(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.update).toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
  });

  describe('when renaming a server', () => {
    beforeEach(() => {
      mockServerDao.exists.mockResolvedValue(false);
      mockServerDao.rename.mockResolvedValue(true);
      mockGroupDao.updateServerName.mockResolvedValue(undefined);
      mockBearerKeyDao.updateServerName.mockResolvedValue(undefined);
      mockAddOrUpdateServer.mockResolvedValue({ success: true });
      mockRemoveServerToolEmbeddings.mockResolvedValue(undefined);

      mockRequest.body = {
        ...mockRequest.body,
        newName: 'renamed-server',
      };
    });

    it('updates every reference to the old name, including vector embeddings', async () => {
      await updateServer(mockRequest as Request, mockResponse as Response);

      expect(mockServerDao.rename).toHaveBeenCalledWith('test-server', 'renamed-server');
      expect(mockGroupDao.updateServerName).toHaveBeenCalledWith('test-server', 'renamed-server');
      expect(mockBearerKeyDao.updateServerName).toHaveBeenCalledWith(
        'test-server',
        'renamed-server',
      );
      // Orphaned embeddings under the old name would make search_tools advertise
      // uncallable phantom tools, so the rename must drop them; addOrUpdateServer
      // regenerates embeddings under the new name.
      expect(mockRemoveServerToolEmbeddings).toHaveBeenCalledWith('test-server');
      expect(mockAddOrUpdateServer).toHaveBeenCalledWith(
        'renamed-server',
        expect.any(Object),
        true,
      );
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        message: 'Server renamed and updated successfully',
      });
    });

    it('still succeeds when embedding cleanup fails', async () => {
      mockRemoveServerToolEmbeddings.mockRejectedValue(new Error('db unavailable'));

      await updateServer(mockRequest as Request, mockResponse as Response);

      expect(mockRemoveServerToolEmbeddings).toHaveBeenCalledWith('test-server');
      expect(mockAddOrUpdateServer).toHaveBeenCalledWith(
        'renamed-server',
        expect.any(Object),
        true,
      );
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        message: 'Server renamed and updated successfully',
      });
    });

    it('closes the runtime still registered under the old name', async () => {
      // addOrUpdateServer closes by the NEW name, which finds nothing - the
      // runtime stays keyed by the old name until the rebuild drops it. Without
      // an explicit close of the old name the stdio child process is orphaned.
      await updateServer(mockRequest as Request, mockResponse as Response);

      expect(mockCloseServer).toHaveBeenCalledWith('test-server');
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
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('disabling a server broadcasts tools/prompts/resources and does not trigger a fleet-wide re-init', async () => {
    const { req, res, json } = makeReqRes(false);

    await toggleServer(req, res);

    expect(mockToggleServerStatus).toHaveBeenCalledWith('target', false);
    expect(mockNotifyToolChanged).not.toHaveBeenCalled();
    expect(mockBroadcastToolListChanged).toHaveBeenCalledTimes(1);
    expect(mockBroadcastPromptListChanged).toHaveBeenCalledTimes(1);
    expect(mockBroadcastResourceListChanged).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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

// Issue #1036 Phase 1: shared users may read a safe configuration view of
// public/group servers, but secret-bearing fields must never appear in any
// serialized response. Owner/admin keep the full view; unrelated users and
// every write path stay owner/admin-gated.
describe('serverController - getServerConfig shared use / private config (#1036)', () => {
  const secretServer = {
    name: 'org-search',
    type: 'streamable-http',
    url: 'https://mcp.example.com/mcp',
    description: 'Org web search',
    owner: 'bob',
    env: { UPSTREAM_API_KEY: 'mcphub-phase1-api-key' },
    headers: { Authorization: 'Bearer mcphub-phase1-secret' },
    args: ['--token', 'mcphub-phase1-secret'],
    oauth: {
      clientId: 'client-123',
      clientSecret: 'mcphub-phase1-client-secret',
      refreshToken: 'mcphub-phase1-refresh-token',
    },
    openapi: {
      url: 'https://api.example.com/openapi.json',
      security: { type: 'apiKey', apiKey: { name: 'X-Key', in: 'header', value: 'k' } },
    },
    proxy: { server: 'proxy.example.com', password: 'mcphub-phase1-proxy-password' },
    enabled: true,
    tools: { search: { enabled: true } },
    // Unrecognized ServerConfig field simulating a future addition — the
    // allowlisted safe view must withhold it.
    futureSetting: 'mcphub-phase1-unrecognized-secret',
  };

  const SENTINELS = [
    'Bearer mcphub-phase1-secret',
    'mcphub-phase1-api-key',
    'mcphub-phase1-client-secret',
    'mcphub-phase1-refresh-token',
    'mcphub-phase1-proxy-password',
    'mcphub-phase1-unrecognized-secret',
  ];

  const runGetServerConfig = async (user: { username: string; isAdmin?: boolean } | null) => {
    mockGetServersInfo.mockResolvedValue([
      {
        name: 'org-search',
        status: 'connected',
        tools: [{ name: 'search', description: 'Search' }],
      },
    ]);
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'org-search' },
      ...(user ? { user } : {}),
    } as unknown as Request;
    const res = { json, status } as unknown as Response;
    await getServerConfig(req, res);
    return { json, status };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUser.mockReturnValue(undefined);
  });

  it('gives a shared user a safe view of a public server with no sentinel secrets', async () => {
    mockServerDao.findById.mockResolvedValue({
      ...secretServer,
      visibility: 'public',
    });

    const { json, status } = await runGetServerConfig({ username: 'alice', isAdmin: false });

    expect(status).not.toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledTimes(1);
    const body = JSON.stringify(json.mock.calls[0][0]);
    for (const sentinel of SENTINELS) {
      expect(body).not.toContain(sentinel);
    }
    // Allowlisted metadata survives; raw connection config does not.
    expect(body).toContain('Org web search');
    const data = json.mock.calls[0][0].data;
    expect(data.config.env).toBeUndefined();
    expect(data.config.headers).toBeUndefined();
    expect(data.config.args).toBeUndefined();
    expect(data.config.oauth).toBeUndefined();
    expect(data.config.proxy).toBeUndefined();
    expect(data.config.openapi).toBeUndefined();
    expect(data.config.url).toBeUndefined();
    expect(data.config.options).toBeUndefined();
    expect(data.config.futureSetting).toBeUndefined();
    expect(data.config.configRestricted).toBe(true);
    expect(data.tools).toEqual([{ name: 'search', description: 'Search' }]);
  });

  it('gives an explicitly shared group member the same safe view', async () => {
    mockServerDao.findById.mockResolvedValue({
      ...secretServer,
      visibility: 'group',
      sharedWithUsers: ['alice'],
    });

    const { json, status } = await runGetServerConfig({ username: 'alice', isAdmin: false });

    expect(status).not.toHaveBeenCalledWith(403);
    const body = JSON.stringify(json.mock.calls[0][0]);
    for (const sentinel of SENTINELS) {
      expect(body).not.toContain(sentinel);
    }
  });

  it('still rejects a group server from a user who is not in the allowlist', async () => {
    mockServerDao.findById.mockResolvedValue({
      ...secretServer,
      visibility: 'group',
      sharedWithUsers: ['charlie'],
    });

    const { status } = await runGetServerConfig({ username: 'alice', isAdmin: false });

    expect(status).toHaveBeenCalledWith(403);
  });

  it('keeps the full configuration available to the owner', async () => {
    mockServerDao.findById.mockResolvedValue({
      ...secretServer,
      visibility: 'public',
    });

    const { json } = await runGetServerConfig({ username: 'bob', isAdmin: false });

    const data = json.mock.calls[0][0].data;
    expect(data.config).toEqual(
      expect.objectContaining({
        headers: { Authorization: 'Bearer mcphub-phase1-secret' },
        env: { UPSTREAM_API_KEY: 'mcphub-phase1-api-key' },
        oauth: expect.objectContaining({ clientSecret: 'mcphub-phase1-client-secret' }),
      }),
    );
  });

  it('keeps the full configuration available to admins', async () => {
    mockServerDao.findById.mockResolvedValue({
      ...secretServer,
      visibility: 'public',
    });

    const { json } = await runGetServerConfig({ username: 'admin', isAdmin: true });

    expect(json.mock.calls[0][0].data.config.oauth).toBeDefined();
  });
});

describe('serverController - updateServer write-path stays owner/admin-only (#1036)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a shared user from writing a public server so secrets cannot be overwritten', async () => {
    mockServerDao.findById.mockResolvedValue({
      name: 'org-search',
      type: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      owner: 'bob',
      visibility: 'public',
      headers: { Authorization: 'Bearer mcphub-phase1-secret' },
    });

    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const req = {
      params: { name: 'org-search' },
      body: {
        config: {
          type: 'streamable-http',
          url: 'https://mcp.example.com/mcp',
          headers: { Authorization: 'Bearer tampered' },
          visibility: 'public',
        },
      },
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;
    const res = { json, status } as unknown as Response;

    await updateServer(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(mockServerDao.update).not.toHaveBeenCalled();
    expect(mockAddOrUpdateServer).not.toHaveBeenCalled();
  });
});

describe('serverController - getAllServers OAuth session scrub (#1036)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.findAllPaginated.mockResolvedValue({
      data: [],
      page: 1,
      limit: 5,
      total: 1,
      totalPages: 1,
    });
    mockServerDao.findVisibleToUserPaginated.mockResolvedValue({
      data: [],
      page: 1,
      limit: 5,
      total: 1,
      totalPages: 1,
    });
    mockServerDao.findByOwnerPaginated.mockResolvedValue({
      data: [],
      page: 1,
      limit: 5,
      total: 1,
      totalPages: 1,
    });
  });

  it('strips OAuth authorizationUrl/state from list entries for non-owner users in both collections', async () => {
    mockGetCurrentUser.mockReturnValue({ username: 'alice', isAdmin: false });
    const entry = {
      name: 'org-search',
      owner: 'bob',
      visibility: 'public',
      status: 'connected',
      tools: [],
      oauth: {
        authorizationUrl: 'https://auth.example.com/authorize?state=mcphub-phase1-oauth-state',
        state: 'mcphub-phase1-oauth-state',
        clientIdConfigured: true,
        connected: false,
      },
      config: {
        type: 'streamable-http',
        description: 'Org web search',
        command: 'npx',
      },
      error: 'Failed to connect to https://mcp.example.com/mcp?token=mcphub-runtime-secret',
    };
    mockGetServersInfo
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([{ ...entry, oauth: { ...entry.oauth } }]);

    const json = jest.fn();
    const req = {
      query: { page: '1', limit: '5' },
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;
    const res = { json } as unknown as Response;

    await getAllServers(req, res);

    const body = JSON.stringify(json.mock.calls[0][0]);
    expect(body).not.toContain('mcphub-phase1-oauth-state');
    expect(body).not.toContain('authorizationUrl');
    expect(body).not.toContain('"command"');
    expect(body).not.toContain('mcphub-runtime-secret');
    expect(body).toContain('Server connection failed');
    expect(body).toContain('clientIdConfigured');
    const data = json.mock.calls[0][0];
    expect(data.data[0].oauth.state).toBeUndefined();
    expect(data.allServers[0].oauth.state).toBeUndefined();
    expect(data.data[0].config.type).toBe('streamable-http');
    expect(data.data[0].config.command).toBeUndefined();
    expect(data.data[0].error).toBe('Server connection failed');
  });

  it('keeps OAuth session fields and raw errors for admins', async () => {
    mockGetCurrentUser.mockReturnValue({ username: 'admin', isAdmin: true });
    const entry = {
      name: 'org-search',
      owner: 'bob',
      status: 'disconnected',
      tools: [],
      oauth: { state: 'owner-state', connected: false },
      error: 'Failed to connect to https://mcp.example.com/mcp?token=mcphub-runtime-secret',
    };
    mockGetServersInfo.mockResolvedValueOnce([entry]).mockResolvedValueOnce([entry]);

    const json = jest.fn();
    const req = {
      query: { page: '1', limit: '5' },
      user: { username: 'admin', isAdmin: true },
    } as unknown as Request;
    const res = { json } as unknown as Response;

    await getAllServers(req, res);

    expect(json.mock.calls[0][0].data[0].oauth.state).toBe('owner-state');
    expect(json.mock.calls[0][0].data[0].error).toBe(
      'Failed to connect to https://mcp.example.com/mcp?token=mcphub-runtime-secret',
    );
  });
});
