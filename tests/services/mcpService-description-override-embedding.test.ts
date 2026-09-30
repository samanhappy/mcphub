// Regression tests for #1198: a per-tool description override must be applied
// to the text that is embedded for Smart Routing search, not just to the
// client-facing projection (tools/list, describe_tool, dashboard).
//
// The embedding text is produced by syncToolsAsVectorEmbeddings →
// saveToolsAsVectorEmbeddings. These tests drive the two public entry points
// that feed it (updateServerToolsCache on connect/reload, syncToolEmbedding on
// PUT/DELETE description) and assert what text reaches the vector store.

jest.mock('@modelcontextprotocol/client', () => ({
  ...jest.requireActual('@modelcontextprotocol/client'),
  Client: jest.fn(),
  SSEClientTransport: jest.fn(),
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: jest.fn(),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  registerOAuthClient: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
  getServerConfigsInGroup: jest.fn(),
  normalizeGroupServers: (servers: Array<string | { name: string }>) =>
    servers.map((server) =>
      typeof server === 'string'
        ? { name: server, tools: 'all', prompts: 'all', resources: 'all' }
        : { tools: 'all', prompts: 'all', resources: 'all', ...server },
    ),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

const mockSaveToolsAsVectorEmbeddings = jest.fn().mockResolvedValue(undefined);

const mockRemoveToolEmbeddings = jest.fn();
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn().mockResolvedValue(undefined),
  removeToolEmbeddings: mockRemoveToolEmbeddings,
  saveToolsAsVectorEmbeddings: mockSaveToolsAsVectorEmbeddings,
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
    logToolCall: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../src/services/hostedAuthService.js', () => ({
  assertHostedToolAllowed: jest.fn(),
  filterHostedTools: jest.fn((_auth: unknown, _serverName: string, tools: any[]) => tools),
  reserveHostedToolCall: jest.fn().mockResolvedValue(null),
  settleHostedToolCall: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

const mockFindServerById = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findAll: jest.fn(async () => []),
    findById: mockFindServerById,
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
    findByUri: jest.fn(async () => null),
  })),
}));

jest.mock('../../src/config/index.js', () => ({
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
  setServerInfosForTest,
  syncCredentialServerToolEmbeddings,
  syncToolEmbedding,
  syncToolsAsVectorEmbeddings,
  updateServerToolsCache,
} from '../../src/services/mcpService.js';
import type { ServerInfo, Tool } from '../../src/types/index.js';

const flushPromises = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

const RAW_DESCRIPTION = 'VERY LONG raw upstream description with lots of subcommand detail';

const rawTool = (name: string): Tool => ({
  name,
  description: RAW_DESCRIPTION,
  inputSchema: { type: 'object', properties: {} },
});

const makeServerInfo = (): ServerInfo =>
  ({
    name: 'redis',
    tools: [],
    status: 'connected',
    enabled: true,
  }) as unknown as ServerInfo;

describe('MCP Service — description override applied to embedding text (#1198)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setServerInfosForTest([]);
    mockFindServerById.mockResolvedValue(null);
    mockSaveToolsAsVectorEmbeddings.mockResolvedValue(undefined);
  });

  it('embeds the overridden description when a prefixed tool config override exists', async () => {
    const serverInfo = makeServerInfo();
    setServerInfosForTest([serverInfo]);
    mockFindServerById.mockResolvedValue({
      name: 'redis',
      tools: { 'redis::redis-get': { description: 'SHORT override text' } },
    });

    updateServerToolsCache(serverInfo, [rawTool('redis-get')]);
    await flushPromises();

    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(1);
    const syncedTools = mockSaveToolsAsVectorEmbeddings.mock.calls[0][1] as Tool[];
    expect(syncedTools).toHaveLength(1);
    expect(syncedTools[0].description).toBe('SHORT override text');
  });

  it('embeds the overridden description when the config key is the bare upstream name', async () => {
    const serverInfo = makeServerInfo();
    setServerInfosForTest([serverInfo]);
    mockFindServerById.mockResolvedValue({
      name: 'redis',
      tools: { 'redis-get': { description: 'BARE KEY override' } },
    });

    updateServerToolsCache(serverInfo, [rawTool('redis-get')]);
    await flushPromises();

    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(1);
    const syncedTools = mockSaveToolsAsVectorEmbeddings.mock.calls[0][1] as Tool[];
    expect(syncedTools[0].description).toBe('BARE KEY override');
  });

  it('keeps the raw upstream description when no override is configured', async () => {
    const serverInfo = makeServerInfo();
    setServerInfosForTest([serverInfo]);
    mockFindServerById.mockResolvedValue({ name: 'redis', tools: {} });

    updateServerToolsCache(serverInfo, [rawTool('redis-get')]);
    await flushPromises();

    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(1);
    const syncedTools = mockSaveToolsAsVectorEmbeddings.mock.calls[0][1] as Tool[];
    expect(syncedTools[0].description).toBe(RAW_DESCRIPTION);
  });

  it('applies the override on the single-tool sync triggered by a description update', async () => {
    const serverInfo = makeServerInfo();
    // serverInfo.tools is the runtime cache built by normalizeToolForCache, so
    // tool names carry the server prefix.
    serverInfo.tools = [{ ...rawTool('redis-get'), name: 'redis::redis-get' }];
    setServerInfosForTest([serverInfo]);
    mockFindServerById.mockResolvedValue({
      name: 'redis',
      tools: { 'redis::redis-get': { description: 'SHORT override text' } },
    });

    syncToolEmbedding('redis', 'redis::redis-get');
    await flushPromises();

    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(1);
    const syncedTools = mockSaveToolsAsVectorEmbeddings.mock.calls[0][1] as Tool[];
    expect(syncedTools).toHaveLength(1);
    expect(syncedTools[0].description).toBe('SHORT override text');
  });

  it('keeps the raw description on the single-tool sync when no override is configured', async () => {
    const serverInfo = makeServerInfo();
    serverInfo.tools = [{ ...rawTool('redis-get'), name: 'redis::redis-get' }];
    setServerInfosForTest([serverInfo]);
    mockFindServerById.mockResolvedValue({ name: 'redis', tools: {} });

    syncToolEmbedding('redis', 'redis::redis-get');
    await flushPromises();

    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(1);
    const syncedTools = mockSaveToolsAsVectorEmbeddings.mock.calls[0][1] as Tool[];
    expect(syncedTools[0].description).toBe(RAW_DESCRIPTION);
  });

  it('resolves the tool by bare name on the single-tool sync (direct API call uses the upstream name)', async () => {
    const serverInfo = makeServerInfo();
    serverInfo.tools = [{ ...rawTool('redis-get'), name: 'redis::redis-get' }];
    setServerInfosForTest([serverInfo]);
    // A direct API call to PUT .../tools/redis-get/description stores the bare
    // key; the sync must still find the prefixed cache entry and embed the override.
    mockFindServerById.mockResolvedValue({
      name: 'redis',
      tools: { 'redis-get': { description: 'BARE KEY override' } },
    });

    serverInfo.tools.push({ ...rawTool('redis-set'), name: 'redis::redis-set' });
    syncToolEmbedding('redis', 'redis-get');
    await flushPromises();

    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(1);
    const syncedTools = mockSaveToolsAsVectorEmbeddings.mock.calls[0][1] as Tool[];
    expect(syncedTools).toHaveLength(1);
    expect(syncedTools[0].description).toBe('BARE KEY override');
    expect(mockSaveToolsAsVectorEmbeddings.mock.calls[0][2]).toEqual({ partial: true });
  });
});

describe('MCP Service — embedding syncs per server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindServerById.mockResolvedValue(null);
    mockSaveToolsAsVectorEmbeddings.mockResolvedValue(undefined);
  });

  it('runs syncs of one server one after another, and of different servers side by side', async () => {
    let finishFirst!: () => void;
    mockSaveToolsAsVectorEmbeddings.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );

    const first = syncToolsAsVectorEmbeddings('redis', [rawTool('a')]);
    const second = syncToolsAsVectorEmbeddings('redis', [rawTool('b')]);
    const other = syncToolsAsVectorEmbeddings('fetch', [rawTool('c')]);
    await other;
    await flushPromises();

    expect(mockSaveToolsAsVectorEmbeddings.mock.calls.map((call) => call[0])).toEqual([
      'redis',
      'fetch',
    ]);

    finishFirst();
    await Promise.all([first, second]);
    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(3);
    expect(mockSaveToolsAsVectorEmbeddings.mock.calls[2][1]).toEqual([rawTool('b')]);
  });

  it('keeps the queue moving after a failed sync', async () => {
    mockSaveToolsAsVectorEmbeddings.mockRejectedValueOnce(new Error('provider down'));

    await expect(syncToolsAsVectorEmbeddings('redis', [rawTool('a')])).rejects.toThrow(
      'provider down',
    );
    await syncToolsAsVectorEmbeddings('redis', [rawTool('a')]);
    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(2);
  });

  it('drops tools disabled in the config before embedding a credential server', async () => {
    mockFindServerById.mockResolvedValue({
      name: 'redis',
      tools: { 'redis::redis-set': { enabled: false }, 'redis-del': { enabled: false } },
    });

    const count = await syncCredentialServerToolEmbeddings('redis', [
      { ...rawTool('redis-get'), name: 'redis::redis-get' },
      { ...rawTool('redis-set'), name: 'redis::redis-set' },
      { ...rawTool('redis-del'), name: 'redis::redis-del' },
    ]);

    expect(count).toBe(1);
    const syncedTools = mockSaveToolsAsVectorEmbeddings.mock.calls[0][1] as Tool[];
    expect(syncedTools.map((tool) => tool.name)).toEqual(['redis::redis-get']);
  });

  it('adds a per-user list without pruning, and removes only its disabled tools, first', async () => {
    mockRemoveToolEmbeddings.mockResolvedValue(undefined);
    mockFindServerById.mockResolvedValue({
      name: 'redis',
      tools: { 'redis::redis-set': { enabled: false } },
    });

    const count = await syncCredentialServerToolEmbeddings(
      'redis',
      [
        { ...rawTool('redis-get'), name: 'redis::redis-get' },
        { ...rawTool('redis-set'), name: 'redis::redis-set' },
      ],
      { partial: true },
    );

    expect(count).toBe(1);
    expect(mockRemoveToolEmbeddings).toHaveBeenCalledWith('redis', ['redis::redis-set']);
    const [serverName, syncedTools, options] = mockSaveToolsAsVectorEmbeddings.mock.calls[0];
    expect(serverName).toBe('redis');
    expect((syncedTools as Tool[]).map((tool) => tool.name)).toEqual(['redis::redis-get']);
    expect(options).toEqual({ partial: true });
    // Queued on the same per-server queue, ahead of the sync
    expect(mockRemoveToolEmbeddings.mock.invocationCallOrder[0]).toBeLessThan(
      mockSaveToolsAsVectorEmbeddings.mock.invocationCallOrder[0],
    );
  });

  it('removes nothing by name for a complete list, which the vector store prunes itself', async () => {
    mockFindServerById.mockResolvedValue({
      name: 'redis',
      tools: { 'redis::redis-set': { enabled: false } },
    });

    await syncCredentialServerToolEmbeddings('redis', [
      { ...rawTool('redis-get'), name: 'redis::redis-get' },
      { ...rawTool('redis-set'), name: 'redis::redis-set' },
    ]);

    expect(mockRemoveToolEmbeddings).not.toHaveBeenCalled();
    expect(mockSaveToolsAsVectorEmbeddings.mock.calls[0][2]).toBeUndefined();
  });
});
