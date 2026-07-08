const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  getServerCapabilities: jest.fn(() => ({ tools: {} })),
  getServerVersion: jest.fn(() => ({ name: 'upstream-weather', version: '1.2.3' })),
  getInstructions: jest.fn(() => 'Use the weather tools for forecast lookups.'),
  listTools: jest.fn().mockResolvedValue({ tools: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));

const mockGetServerConfigsInGroup = jest.fn();

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
  getServerConfigsInGroup: mockGetServerConfigsInGroup,
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn(),
  })),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

const mockFindAll = jest.fn();
const mockFindAllPaginated = jest.fn();
const mockFindVisibleToUserPaginated = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findAll: mockFindAll,
    findAllPaginated: mockFindAllPaginated,
    findVisibleToUserPaginated: mockFindVisibleToUserPaginated,
    findById: jest.fn(),
  })),
  getGroupDao: jest.fn(() => ({
    findByName: jest.fn(async () => null),
    findById: jest.fn(async () => null),
  })),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(async () => ({})),
  })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
  getBuiltinResourceDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
}));

jest.mock('../../src/config/index.js', () => ({
  __esModule: true,
  expandEnvVars: jest.fn((value: string) => value),
  replaceEnvVars: jest.fn((value: any) => value),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import {
  cleanupAllServers,
  getMcpServer,
  getServersInfo,
  initUpstreamServers,
} from '../../src/services/mcpService.js';

describe('mcpService initialize metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupAllServers();
  });

  afterEach(() => {
    cleanupAllServers();
  });

  it('uses upstream server metadata for a single server route', async () => {
    mockFindAll.mockResolvedValue([
      {
        name: 'weather-server',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
      },
    ]);
    mockGetServerConfigsInGroup.mockResolvedValue([]);

    await initUpstreamServers();

    const server = await getMcpServer('session-1', 'weather-server');

    expect((server as any)._serverInfo).toEqual({
      name: 'weather-server',
      version: '1.2.3',
    });
    expect((server as any)._instructions).toBe('Use the weather tools for forecast lookups.');
  });

  it('keeps hub metadata for multi-server groups', async () => {
    mockFindAll.mockResolvedValue([
      {
        name: 'weather-server',
        type: 'stdio',
        command: 'node',
        args: ['weather.js'],
        enabled: true,
      },
      {
        name: 'calendar-server',
        type: 'stdio',
        command: 'node',
        args: ['calendar.js'],
        enabled: true,
      },
    ]);
    mockGetServerConfigsInGroup.mockResolvedValue([
      { name: 'weather-server', tools: 'all', prompts: 'all', resources: 'all' },
      { name: 'calendar-server', tools: 'all', prompts: 'all', resources: 'all' },
    ]);

    await initUpstreamServers();

    const server = await getMcpServer('session-1', 'team-a');

    expect((server as any)._serverInfo).toEqual({
      name: 'test-hub_team-a_group',
      version: '1.0.0',
    });
    expect((server as any)._instructions).toBeUndefined();
  });

  it('uses visibility-aware pagination and returns owner metadata for non-admin server lists', async () => {
    mockFindVisibleToUserPaginated.mockResolvedValue({
      data: [
        {
          name: 'alice-private',
          owner: 'alice',
          visibility: 'private',
          enabled: true,
        },
        {
          name: 'shared-public',
          owner: 'bob',
          visibility: 'public',
          enabled: true,
        },
      ],
      total: 2,
      page: 1,
      limit: 5,
      totalPages: 1,
    });

    const result = await getServersInfo(1, 5, {
      username: 'alice',
      isAdmin: false,
    });

    expect(mockFindVisibleToUserPaginated).toHaveBeenCalledWith('alice', 1, 5);
    expect(mockFindAllPaginated).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({
        name: 'alice-private',
        owner: 'alice',
        visibility: 'private',
      }),
      expect.objectContaining({
        name: 'shared-public',
        owner: 'bob',
        visibility: 'public',
      }),
    ]);
  });

  it('exposes whether a server has stored upstream OAuth credentials', async () => {
    mockFindAll.mockResolvedValue([
      {
        name: 'notion',
        type: 'streamable-http',
        url: 'https://mcp.notion.com/mcp',
        enabled: true,
        oauth: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      },
    ]);

    const result = await getServersInfo();

    expect(result).toEqual([
      expect.objectContaining({
        name: 'notion',
        oauth: {
          connected: true,
        },
      }),
    ]);
  });

  it('exposes tool description override metadata for dashboard consumers', async () => {
    mockFindAll.mockResolvedValue([
      {
        name: 'weather-server',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
        tools: {
          'weather-server::current': {
            enabled: true,
            description: 'Custom current conditions lookup',
          },
          'weather-server::blank': {
            enabled: true,
            description: '',
          },
          'weather-server::undefined': {
            enabled: true,
            description: undefined,
          },
        },
      },
    ]);
    mockClient.listTools.mockResolvedValueOnce({
      tools: [
        {
          name: 'current',
          description: 'Fetch current conditions',
          inputSchema: { type: 'object' },
        },
        {
          name: 'blank',
          description: 'Fetch fallback conditions',
          inputSchema: { type: 'object' },
        },
        {
          name: 'undefined',
          description: 'Fetch undefined fallback conditions',
          inputSchema: { type: 'object' },
        },
      ],
    });

    await initUpstreamServers();
    await Promise.resolve();
    await Promise.resolve();

    const result = await getServersInfo();

    expect(result).toEqual([
      expect.objectContaining({
        name: 'weather-server',
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'weather-server::current',
            description: 'Custom current conditions lookup',
            defaultDescription: 'Fetch current conditions',
            hasDescriptionOverride: true,
            enabled: true,
          }),
          expect.objectContaining({
            name: 'weather-server::blank',
            description: '',
            defaultDescription: 'Fetch fallback conditions',
            hasDescriptionOverride: true,
            enabled: true,
          }),
          expect.objectContaining({
            name: 'weather-server::undefined',
            description: 'Fetch undefined fallback conditions',
            defaultDescription: 'Fetch undefined fallback conditions',
            hasDescriptionOverride: false,
            enabled: true,
          }),
        ]),
      }),
    ]);
  });
});
