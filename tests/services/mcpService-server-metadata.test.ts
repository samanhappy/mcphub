const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  getServerCapabilities: jest.fn(() => ({ tools: {}, prompts: {}, resources: {} })),
  getNegotiatedProtocolVersion: jest.fn(() => '2025-03-26'),
  getServerVersion: jest.fn(() => ({ name: 'upstream-weather', version: '1.2.3' })),
  getInstructions: jest.fn(() => 'Use the weather tools for forecast lookups.'),
  listTools: jest.fn().mockResolvedValue({ tools: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
};

jest.mock('@modelcontextprotocol/client', () => ({
  ...jest.requireActual('@modelcontextprotocol/client'),
  Client: jest.fn().mockImplementation(() => mockClient),
  SSEClientTransport: jest.fn(),
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
  })),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));

const mockGetServerConfigsInGroup = jest.fn();
const mockFindGroupByName = jest.fn();
const mockIsSmartRoutingGroup = jest.fn((_group?: string) => false);

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
  getServerConfigsInGroup: mockGetServerConfigsInGroup,
  normalizeGroupServers: jest.fn((servers: any[]) =>
    servers.map((server) => (typeof server === 'string' ? { name: server } : server)),
  ),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn().mockResolvedValue(undefined),
}));

const mockFilterData = jest.fn((data: any) => data);

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: mockFilterData,
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: mockIsSmartRoutingGroup,
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
    findByName: mockFindGroupByName,
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
  setServerInfosForTest,
} from '../../src/services/mcpService.js';

describe('mcpService initialize metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindGroupByName.mockResolvedValue(null);
    mockFilterData.mockImplementation((data: any) => data);
    mockIsSmartRoutingGroup.mockImplementation(() => false);
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

  it('exposes the negotiated protocol separately from the server software version', async () => {
    mockFindAll.mockResolvedValue([
      { name: 'weather-server', type: 'stdio', command: 'node', args: ['server.js'] },
    ]);
    await initUpstreamServers();
    const [server] = await getServersInfo();
    expect(server.version).toBe('1.2.3');
    expect(server.protocolVersion).toBe('2025-03-26');
  });

  it('exposes stable server IDs for policy selection, including disabled servers', async () => {
    mockFindAll.mockResolvedValue([
      { id: 'persistent-id', name: 'waiting', type: 'stdio', command: 'node', enabled: false },
    ]);
    const [server] = await getServersInfo();
    expect(server.config?.id).toBe('persistent-id');
  });

  it('does not invent a protocol version before initialization', async () => {
    mockFindAll.mockResolvedValue([
      { name: 'waiting', type: 'stdio', command: 'node', enabled: false },
    ]);
    const [server] = await getServersInfo();
    expect(server.protocolVersion).toBeUndefined();
  });

  it.each([
    { type: 'stdio', status: 'disconnected', enabled: true },
    { type: 'stdio', status: 'connected', enabled: false },
    { type: 'openapi', status: 'connected', enabled: true },
  ] as const)('omits the protocol for $type/$status/enabled=$enabled', async (state) => {
    mockFindAll.mockResolvedValue([{ name: 'metadata', ...state }]);
    setServerInfosForTest([
      {
        name: 'metadata',
        status: state.status,
        client: mockClient as unknown as import('../../src/clients/mcpSdkClient.js').Client,
        tools: [],
        prompts: [],
        resources: [],
        createTime: Date.now(),
      },
    ]);
    const [server] = await getServersInfo();
    expect(server.protocolVersion).toBeUndefined();
  });

  it('exposes retry metadata without serializing runtime timers', async () => {
    mockFindAll.mockResolvedValue([
      { name: 'remote', type: 'sse', url: 'https://example.com/sse' },
    ]);
    const recovery = { attempts: 3, lastAttemptAt: 1000, nextAttemptAt: 2000 };
    setServerInfosForTest([
      {
        name: 'remote',
        status: 'disconnected',
        error: 'offline',
        recovery,
        tools: [],
        prompts: [],
        resources: [],
        createTime: Date.now(),
      },
    ]);
    const [server] = await getServersInfo();
    expect(server.recovery).toEqual(recovery);
    expect(JSON.stringify(server)).not.toContain('keepAliveIntervalId');
    mockFindAll.mockResolvedValue([{ name: 'remote', type: 'sse', enabled: false }]);
    expect((await getServersInfo())[0].recovery).toBeUndefined();
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

  describe('group instructions', () => {
    const twoServers = [
      { name: 'weather-server', type: 'stdio', command: 'node', args: ['w.js'], enabled: true },
      { name: 'calendar-server', type: 'stdio', command: 'node', args: ['c.js'], enabled: true },
    ];
    const groupWith = (instructions: string, servers = ['weather-server', 'calendar-server']) => ({
      id: 'group-a',
      name: 'team-a',
      owner: 'admin',
      instructions,
      servers,
    });

    it('sends the group instructions for a multi-server group', async () => {
      mockFindAll.mockResolvedValue(twoServers);
      mockGetServerConfigsInGroup.mockResolvedValue([
        { name: 'weather-server', tools: 'all', prompts: 'all', resources: 'all' },
        { name: 'calendar-server', tools: 'all', prompts: 'all', resources: 'all' },
      ]);
      mockFindGroupByName.mockResolvedValue(groupWith('Prefer the calendar for dates.'));
      await initUpstreamServers();

      const server = await getMcpServer('session-1', 'team-a');

      expect(mockFindGroupByName).toHaveBeenCalledWith('team-a');
      expect((server as any)._instructions).toBe('Prefer the calendar for dates.');
    });

    it('puts the group instructions before the upstream ones for a single-server group', async () => {
      mockFindAll.mockResolvedValue([twoServers[0]]);
      mockGetServerConfigsInGroup.mockResolvedValue([
        { name: 'weather-server', tools: 'all', prompts: 'all', resources: 'all' },
      ]);
      mockFindGroupByName.mockResolvedValue(
        groupWith('  Ask before calling paid APIs.\n', ['weather-server']),
      );
      await initUpstreamServers();

      const server = await getMcpServer('session-1', 'team-a');

      expect((server as any)._serverInfo).toEqual({ name: 'weather-server', version: '1.2.3' });
      expect((server as any)._instructions).toBe(
        'Ask before calling paid APIs.\n\nUse the weather tools for forecast lookups.',
      );
    });

    it('sends the group instructions on $smart/<group>', async () => {
      mockIsSmartRoutingGroup.mockImplementation((group?: string) => !!group?.startsWith('$smart'));
      mockFindGroupByName.mockResolvedValue(groupWith('Search before you call.'));

      const server = await getMcpServer('session-1', '$smart/team-a');

      expect(mockFindGroupByName).toHaveBeenCalledWith('team-a');
      expect((server as any)._serverInfo).toEqual({
        name: 'test-hub_$smart/team-a_group',
        version: '1.0.0',
      });
      expect((server as any)._instructions).toBe('Search before you call.');
    });

    it('sends no instructions on bare $smart', async () => {
      mockIsSmartRoutingGroup.mockImplementation((group?: string) => !!group?.startsWith('$smart'));

      const server = await getMcpServer('session-1', '$smart');

      expect(mockFindGroupByName).not.toHaveBeenCalled();
      expect((server as any)._instructions).toBeUndefined();
    });

    it('sends no group instructions to a caller who cannot access the group', async () => {
      mockIsSmartRoutingGroup.mockImplementation((group?: string) => !!group?.startsWith('$smart'));
      mockFindGroupByName.mockResolvedValue({
        ...groupWith('Internal notes.'),
        visibility: 'private',
      });
      mockFilterData.mockImplementation(() => []);

      const server = await getMcpServer('session-1', '$smart/team-a');

      expect((server as any)._instructions).toBeUndefined();
    });

    it('treats blank group instructions as none', async () => {
      mockFindAll.mockResolvedValue(twoServers);
      mockGetServerConfigsInGroup.mockResolvedValue([
        { name: 'weather-server', tools: 'all', prompts: 'all', resources: 'all' },
        { name: 'calendar-server', tools: 'all', prompts: 'all', resources: 'all' },
      ]);
      mockFindGroupByName.mockResolvedValue(groupWith('   '));
      await initUpstreamServers();

      const server = await getMcpServer('session-1', 'team-a');

      expect((server as any)._instructions).toBeUndefined();
    });
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

  it('exposes resource description and enabled overrides for dashboard consumers', async () => {
    mockFindAll.mockResolvedValue([
      {
        name: 'zabbix',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
        resources: {
          'resource://hosts': {
            enabled: true,
            description: 'Custom hosts description',
          },
          'resource://disabled': {
            enabled: false,
            description: 'Disabled resource',
          },
          'resource://no-override': {
            enabled: true,
            description: undefined,
          },
        },
      },
    ]);
    mockClient.listResources.mockResolvedValueOnce({
      resources: [
        {
          uri: 'resource://hosts',
          name: 'resource_hosts',
          description: 'Upstream hosts description',
          mimeType: 'text/plain',
        },
        {
          uri: 'resource://disabled',
          name: 'resource_disabled',
          description: 'Upstream disabled description',
          mimeType: 'text/plain',
        },
        {
          uri: 'resource://no-override',
          name: 'resource_no_override',
          description: 'Upstream no-override description',
          mimeType: 'text/plain',
        },
      ],
    });

    await initUpstreamServers();
    await Promise.resolve();
    await Promise.resolve();

    const result = await getServersInfo();

    expect(result).toEqual([
      expect.objectContaining({
        name: 'zabbix',
        resources: expect.arrayContaining([
          expect.objectContaining({
            uri: 'resource://hosts',
            description: 'Custom hosts description',
            enabled: true,
          }),
          expect.objectContaining({
            uri: 'resource://disabled',
            description: 'Disabled resource',
            enabled: false,
          }),
          expect.objectContaining({
            uri: 'resource://no-override',
            description: 'Upstream no-override description',
            enabled: true,
          }),
        ]),
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
