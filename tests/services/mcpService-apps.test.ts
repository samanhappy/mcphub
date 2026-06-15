const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  getServerCapabilities: jest.fn(() => ({ tools: {}, resources: {}, prompts: {} })),
  getServerVersion: jest.fn(() => ({ name: 'apps-upstream', version: '1.0.0' })),
  getInstructions: jest.fn(),
  listTools: jest.fn(),
  listPrompts: jest.fn(),
  listResources: jest.fn(),
  readResource: jest.fn(),
  callTool: jest.fn(),
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
  getGroup: jest.fn((sessionId: string) => {
    if (sessionId === 'apps-session' || sessionId === 'ordinary-session') return 'apps-server';
    if (sessionId === 'aggregate-session') return 'pair';
    if (sessionId === 'other-session') return 'other-server';
    return '';
  }),
}));

const mockSaveToolsAsVectorEmbeddings = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn().mockResolvedValue(undefined),
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
  filterHostedTools: jest.fn((_auth, _serverName, tools) => tools),
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

const mockFindAll = jest.fn();
const mockFindById = jest.fn();
const mockFindBuiltinResourceByUri = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findAll: mockFindAll,
    findById: mockFindById,
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
    findByUri: mockFindBuiltinResourceByUri,
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

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  broadcastToolListChanged,
  cleanupAllServers,
  getMcpServer,
  getServerByName,
  handleCallToolRequest,
  handleListToolsRequest,
  handleReadResourceRequest,
  initUpstreamServers,
} from '../../src/services/mcpService.js';
import { MCP_APPS_CAPABILITIES } from '../../src/utils/mcpApps.js';

const appsTools = [
  {
    name: 'open-dashboard',
    title: 'Open dashboard',
    description: 'Open the dashboard',
    inputSchema: { type: 'object', $schema: 'https://json-schema.org/draft/2020-12/schema' },
    outputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
    icons: [{ src: 'https://example.com/dashboard.svg' }],
    _meta: {
      ui: { resourceUri: 'ui://apps/dashboard.html' },
      trace: 'keep-me',
    },
  },
  {
    name: 'poll-dashboard',
    description: 'Refresh dashboard data',
    inputSchema: { type: 'object' },
    _meta: {
      ui: { visibility: ['app'] },
    },
  },
];

const flushPromises = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

const makeServerConfig = (name: string) => ({
  name,
  type: 'stdio' as const,
  command: 'node',
  args: [`${name}.js`],
  enabled: true,
});

const markSessionAsAppsCapable = async (sessionId: string, group: string) => {
  const server = await getMcpServer(sessionId, group);
  (server as any)._clientCapabilities = MCP_APPS_CAPABILITIES;
  return server;
};

describe('mcpService MCP Apps transparent proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupAllServers();
    mockFindAll.mockResolvedValue([makeServerConfig('apps-server')]);
    mockFindById.mockImplementation(async (name: string) => makeServerConfig(name));
    mockGetServerConfigsInGroup.mockResolvedValue([]);
    mockFindBuiltinResourceByUri.mockResolvedValue(undefined);
    mockClient.listTools.mockResolvedValue({ tools: appsTools });
    mockClient.listPrompts.mockResolvedValue({ prompts: [] });
    mockClient.listResources.mockResolvedValue({ resources: [] });
    mockClient.readResource.mockResolvedValue({
      contents: [
        {
          uri: 'ui://apps/dashboard.html',
          mimeType: 'text/html;profile=mcp-app',
          text: '<html></html>',
          _meta: { ui: { csp: { connectDomains: [] } }, trace: 'keep-me' },
        },
      ],
    });
    mockClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    });
  });

  afterEach(() => {
    cleanupAllServers();
  });

  it('advertises MCP Apps upstream and configures dynamic list refresh callbacks', async () => {
    await initUpstreamServers();

    expect(Client).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        capabilities: MCP_APPS_CAPABILITIES,
        listChanged: expect.objectContaining({
          tools: expect.objectContaining({ onChanged: expect.any(Function) }),
          prompts: expect.objectContaining({ onChanged: expect.any(Function) }),
          resources: expect.objectContaining({ onChanged: expect.any(Function) }),
        }),
      }),
    );
  });

  it('hides app-only tools and strips Apps metadata on ordinary MCP routes', async () => {
    await initUpstreamServers();
    await flushPromises();
    await getMcpServer('ordinary-session', 'apps-server');

    const result = await handleListToolsRequest({}, { sessionId: 'ordinary-session' });

    expect(result.tools).toEqual([
      expect.objectContaining({
        name: 'apps-server::open-dashboard',
        title: 'Open dashboard',
        outputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
        icons: [{ src: 'https://example.com/dashboard.svg' }],
        inputSchema: { type: 'object' },
        _meta: { trace: 'keep-me' },
      }),
    ]);
  });

  it('passes complete Apps metadata and raw tool names on an eligible single-upstream route', async () => {
    await initUpstreamServers();
    await flushPromises();
    await markSessionAsAppsCapable('apps-session', 'apps-server');

    const result = await handleListToolsRequest({}, { sessionId: 'apps-session' });

    expect(result.tools.map((tool) => tool.name)).toEqual(['open-dashboard', 'poll-dashboard']);
    expect(result.tools[0]._meta).toEqual(appsTools[0]._meta);
  });

  it('allows raw app-only calls only on an eligible Apps route', async () => {
    await initUpstreamServers();
    await flushPromises();
    await markSessionAsAppsCapable('apps-session', 'apps-server');

    const appsResult = await handleCallToolRequest(
      { params: { name: 'poll-dashboard', arguments: {} } },
      { sessionId: 'apps-session' },
    );
    const ordinaryResult = await handleCallToolRequest(
      { params: { name: 'apps-server::poll-dashboard', arguments: {} } },
      { sessionId: 'ordinary-session' },
    );

    expect(appsResult.isError).toBe(false);
    expect(mockClient.callTool).toHaveBeenCalledWith(
      { name: 'poll-dashboard', arguments: {} },
      undefined,
      expect.anything(),
    );
    expect(ordinaryResult.isError).toBe(true);
    expect(ordinaryResult.content[0].text).toContain('only available to MCP Apps');
  });

  it('allows unlisted ui resources only on an eligible Apps route', async () => {
    await initUpstreamServers();
    await flushPromises();
    await markSessionAsAppsCapable('apps-session', 'apps-server');

    const appsResult = await handleReadResourceRequest(
      { params: { uri: 'ui://apps/dashboard.html' } },
      { sessionId: 'apps-session' },
    );
    mockClient.readResource.mockClear();
    const ordinaryResult = await handleReadResourceRequest(
      { params: { uri: 'ui://apps/dashboard.html' } },
      { sessionId: 'ordinary-session' },
    );

    expect(appsResult.contents[0]._meta).toEqual({
      ui: { csp: { connectDomains: [] } },
      trace: 'keep-me',
    });
    expect(ordinaryResult.contents[0].text).toContain('Resource not found');
    expect(mockClient.readResource).not.toHaveBeenCalled();
  });

  it('strips Apps metadata when an ordinary route reads a listed resource', async () => {
    mockClient.listResources.mockResolvedValue({
      resources: [{ uri: 'ui://apps/dashboard.html', name: 'Dashboard' }],
    });
    await initUpstreamServers();
    await flushPromises();

    const result = await handleReadResourceRequest(
      { params: { uri: 'ui://apps/dashboard.html' } },
      { sessionId: 'ordinary-session' },
    );

    expect(result.contents[0]._meta).toEqual({ trace: 'keep-me' });
  });

  it('returns a readable error when an upstream resource response is malformed', async () => {
    mockClient.listResources.mockResolvedValue({
      resources: [{ uri: 'resource://apps/broken', name: 'Broken' }],
    });
    mockClient.readResource.mockResolvedValueOnce(undefined);
    await initUpstreamServers();
    await flushPromises();

    const result = await handleReadResourceRequest(
      { params: { uri: 'resource://apps/broken' } },
      { sessionId: 'ordinary-session' },
    );

    expect(result.contents[0].text).toContain('Failed to read resource');
  });

  it('blocks unlisted ui resources on aggregate routes', async () => {
    mockFindAll.mockResolvedValue([
      makeServerConfig('apps-server'),
      makeServerConfig('other-server'),
    ]);
    mockGetServerConfigsInGroup.mockImplementation(async (group: string) =>
      group === 'pair' ? [{ name: 'apps-server' }, { name: 'other-server' }] : [],
    );
    await initUpstreamServers();
    await flushPromises();
    await markSessionAsAppsCapable('aggregate-session', 'pair');

    const result = await handleReadResourceRequest(
      { params: { uri: 'ui://apps/dashboard.html' } },
      { sessionId: 'aggregate-session' },
    );

    expect(result.contents[0].text).toContain('Resource not found');
    expect(mockClient.readResource).not.toHaveBeenCalled();
  });

  it('does not read a listed resource through a different single-server route', async () => {
    mockFindAll.mockResolvedValue([
      makeServerConfig('apps-server'),
      makeServerConfig('other-server'),
    ]);
    await initUpstreamServers();
    await flushPromises();
    getServerByName('apps-server')!.resources = [
      { uri: 'resource://apps/private', name: 'Private' },
    ];
    getServerByName('other-server')!.resources = [];

    const result = await handleReadResourceRequest(
      { params: { uri: 'resource://apps/private' } },
      { sessionId: 'other-session' },
    );

    expect(result.contents[0].text).toContain('Resource not found');
    expect(mockClient.readResource).not.toHaveBeenCalled();
  });

  it('updates the cache when an upstream tools list changed callback fires', async () => {
    await initUpstreamServers();
    await flushPromises();
    const [, clientOptions] = (Client as jest.Mock).mock.calls[0];

    clientOptions.listChanged.tools.onChanged(null, [
      {
        name: 'new-tool',
        description: 'New tool',
        inputSchema: { type: 'object' },
      },
    ]);
    await flushPromises();

    expect(getServerByName('apps-server')?.tools).toEqual([
      expect.objectContaining({ name: 'apps-server::new-tool' }),
    ]);
  });

  it('does not report a successful list-change notification after delivery fails', async () => {
    const downstreamServer = await getMcpServer('ordinary-session', 'apps-server');
    jest
      .spyOn(downstreamServer, 'sendToolListChanged')
      .mockRejectedValueOnce(new Error('delivery failed'));
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    broadcastToolListChanged();
    await flushPromises();

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to send tool list changed notification:',
      'delivery failed',
    );
    expect(logSpy).not.toHaveBeenCalledWith('tool list changed notification sent successfully');
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
