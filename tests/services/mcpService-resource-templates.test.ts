const createMockClient = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  getServerCapabilities: jest.fn(() => ({ tools: {}, resources: {}, prompts: {} })),
  getServerVersion: jest.fn(() => ({ name: 'templates-upstream', version: '1.0.0' })),
  getInstructions: jest.fn(),
  listTools: jest.fn().mockResolvedValue({ tools: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
  listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [] }),
  readResource: jest.fn(),
  callTool: jest.fn(),
});

type MockClient = ReturnType<typeof createMockClient>;
const mockClientsByServer = new Map<string, MockClient>();
const mockFallbackClient = createMockClient();

jest.mock('@modelcontextprotocol/client', () => ({
  ...jest.requireActual('@modelcontextprotocol/client'),
  Client: jest.fn().mockImplementation((clientInfo: { name: string }) => {
    const serverName = clientInfo.name.replace(/^mcp-client-/, '');
    return mockClientsByServer.get(serverName) ?? mockFallbackClient;
  }),
  SSEClientTransport: jest.fn(),
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
  getServerConfigsInGroup: jest.fn().mockResolvedValue([]),
  normalizeGroupServers: (servers: Array<string | { name: string }>) =>
    servers.map((server) =>
      typeof server === 'string'
        ? { name: server, tools: 'all', prompts: 'all', resources: 'all' }
        : { tools: 'all', prompts: 'all', resources: 'all', ...server },
    ),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn((sessionId: string) => {
    if (sessionId === 'alpha-session') return 'alpha';
    if (sessionId === 'pair-session') return 'pair';
    if (sessionId === 'restricted-session') return 'restricted';
    if (sessionId === 'apps-session') return 'alpha';
    return '';
  }),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn().mockResolvedValue(undefined),
  saveToolsAsVectorEmbeddings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({ filterData: (data: any) => data })),
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
const mockGroupFindByName = jest.fn(async (_name: string) => null as any);

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: jest.fn(() => ({ findByUsername: jest.fn(async () => null) })),
  getBearerKeyDao: jest.fn(() => ({ findById: jest.fn(async () => null) })),
  getServerDao: jest.fn(() => ({ findAll: mockFindAll, findById: mockFindById })),
  getGroupDao: jest.fn(() => ({
    findByName: mockGroupFindByName,
    findById: jest.fn(async () => null),
  })),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(async () => ({})) })),
  getBuiltinPromptDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
  getBuiltinResourceDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
    findByUri: mockFindBuiltinResourceByUri,
  })),
}));

jest.mock('../../src/config/index.js', () => ({
  expandEnvVars: jest.fn((value: string) => value),
  replaceEnvVars: jest.fn((value: any) => value),
  getNameSeparator: jest.fn(() => '::'),
  default: { mcpHubName: 'test-hub', mcpHubVersion: '1.0.0', initTimeout: 60000 },
}));

import { Client } from '@modelcontextprotocol/client';
import {
  cleanupAllServers,
  getMcpServer,
  getServerByName,
  handleListResourceTemplatesRequest,
  handleReadResourceRequest,
  initUpstreamServers,
} from '../../src/services/mcpService.js';
import { MCP_APPS_CAPABILITIES } from '../../src/utils/mcpApps.js';

const flushPromises = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
};

const makeServerConfig = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: 'stdio' as const,
  command: 'node',
  args: [`${name}.js`],
  enabled: true,
  ...extra,
});

const addUpstream = (name: string, uriTemplates: string[]): MockClient => {
  const client = createMockClient();
  client.listResourceTemplates.mockResolvedValue({
    resourceTemplates: uriTemplates.map((uriTemplate) => ({ uriTemplate, name: uriTemplate })),
  });
  client.readResource.mockImplementation(async ({ uri }: { uri: string }) => ({
    contents: [{ uri, mimeType: 'text/plain', text: `${name}:${uri}` }],
  }));
  mockClientsByServer.set(name, client);
  return client;
};

const read = (uri: string, sessionId: string) =>
  handleReadResourceRequest({ params: { uri } }, { sessionId });

const start = async (...names: string[]) => {
  mockFindAll.mockResolvedValue(names.map((name) => makeServerConfig(name)));
  await initUpstreamServers();
  await flushPromises();
};

describe('resources/read through upstream resource templates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupAllServers();
    mockClientsByServer.clear();
    mockFindById.mockImplementation(async (name: string) => makeServerConfig(name));
    mockFindBuiltinResourceByUri.mockResolvedValue(undefined);
    mockGroupFindByName.mockImplementation(async (name: string) =>
      name === 'pair' ? { name, servers: ['alpha', 'beta'] } : null,
    );
  });

  afterEach(() => {
    cleanupAllServers();
  });

  it('routes a URI matching a simple template to its upstream', async () => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    await start('alpha');

    const result = await read('x://items/42', 'alpha-session');

    expect(alpha.readResource).toHaveBeenCalledWith({ uri: 'x://items/42' });
    expect(result).toEqual({
      contents: [{ uri: 'x://items/42', mimeType: 'text/plain', text: 'alpha:x://items/42' }],
    });
  });

  it.each(['x://docs/69/download', 'x://docs/69/download?original=true'])(
    'routes %s through a query-expansion template',
    async (uri) => {
      const alpha = addUpstream('alpha', ['x://docs/{id}/download{?original}']);
      await start('alpha');

      const result = await read(uri, 'alpha-session');

      expect(alpha.readResource).toHaveBeenCalledWith({ uri });
      expect(result.contents[0].text).toBe(`alpha:${uri}`);
    },
  );

  it.each(['x://search?fixed=1', 'x://search?fixed=1&limit=5'])(
    'routes %s through a template whose literal part has a query',
    async (uri) => {
      const alpha = addUpstream('alpha', ['x://search?fixed=1{&limit}']);
      await start('alpha');

      const result = await read(uri, 'alpha-session');

      expect(alpha.readResource).toHaveBeenCalledWith({ uri });
      expect(result.contents[0].text).toBe(`alpha:${uri}`);
    },
  );

  it('keeps Resource not found when no template matches', async () => {
    const alpha = addUpstream('alpha', ['x://docs/{id}/download{?original}']);
    await start('alpha');

    for (const uri of ['x://docs/69/thumb', 'x://docs/69/download?unknown=1', 'y://other']) {
      const result = await read(uri, 'alpha-session');
      expect(result.contents[0].text).toBe(`Error: Error | Resource not found: ${uri}`);
    }
    expect(alpha.readResource).not.toHaveBeenCalled();
  });

  it('sends the read only to the upstream whose template matches', async () => {
    const alpha = addUpstream('alpha', ['x://alpha/{id}']);
    const beta = addUpstream('beta', ['x://beta/{id}']);
    await start('alpha', 'beta');

    const result = await read('x://beta/7', 'pair-session');

    expect(result.contents[0].text).toBe('beta:x://beta/7');
    expect(beta.readResource).toHaveBeenCalledWith({ uri: 'x://beta/7' });
    expect(alpha.readResource).not.toHaveBeenCalled();
  });

  it.each([
    ['server outside the group', { name: 'restricted', servers: ['beta'] }],
    [
      'server whose resources the group excludes',
      { name: 'restricted', servers: [{ name: 'alpha', resources: [] }, 'beta'] },
    ],
    [
      'server whose selected resources do not cover the template',
      { name: 'restricted', servers: [{ name: 'alpha', resources: ['x://other/{id}'] }] },
    ],
    [
      'server where the group selects only a sibling resource',
      { name: 'restricted', servers: [{ name: 'alpha', resources: ['x://items/2'] }] },
    ],
  ])('never reads through a template of a %s', async (_label, group) => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    const beta = addUpstream('beta', []);
    mockGroupFindByName.mockImplementation(async (name: string) =>
      name === 'restricted' ? group : null,
    );
    await start('alpha', 'beta');

    const result = await read('x://items/1', 'restricted-session');

    expect(result.contents[0].text).toBe('Error: Error | Resource not found: x://items/1');
    expect(alpha.readResource).not.toHaveBeenCalled();
    expect(beta.readResource).not.toHaveBeenCalled();
  });

  it('reads through a template the group explicitly selects', async () => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    mockGroupFindByName.mockImplementation(async (name: string) =>
      name === 'restricted'
        ? { name, servers: [{ name: 'alpha', resources: ['x://items/{id}'] }] }
        : null,
    );
    await start('alpha');

    const result = await read('x://items/1', 'restricted-session');

    expect(result.contents[0].text).toBe('alpha:x://items/1');
    expect(alpha.readResource).toHaveBeenCalledWith({ uri: 'x://items/1' });
  });

  it.each(['x://items/{id}', 'x://items/1'])(
    'does not read through a template disabled by server resource config (%s)',
    async (disabledKey) => {
      const alpha = addUpstream('alpha', ['x://items/{id}']);
      mockFindById.mockImplementation(async (name: string) =>
        makeServerConfig(name, { resources: { [disabledKey]: { enabled: false } } }),
      );
      await start('alpha');

      const result = await read('x://items/1', 'alpha-session');

      expect(result.contents[0].text).toBe('Error: Error | Resource not found: x://items/1');
      expect(alpha.readResource).not.toHaveBeenCalled();
    },
  );

  it('reads a concrete URI the group selects through a matching template', async () => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    mockGroupFindByName.mockImplementation(async (name: string) =>
      name === 'restricted'
        ? { name, servers: [{ name: 'alpha', resources: ['x://items/2'] }] }
        : null,
    );
    await start('alpha');

    expect((await read('x://items/2', 'restricted-session')).contents[0].text).toBe(
      'alpha:x://items/2',
    );
  });

  it('passes a binary blob response through unchanged', async () => {
    const alpha = addUpstream('alpha', ['x://docs/{id}/download{?original}']);
    const upstream = {
      contents: [
        {
          uri: 'x://docs/69/download',
          mimeType: 'application/pdf',
          blob: Buffer.from('%PDF-1.7 binary\u0000\u00ff').toString('base64'),
        },
      ],
    };
    alpha.readResource.mockResolvedValue(upstream);
    await start('alpha');

    expect(await read('x://docs/69/download', 'alpha-session')).toEqual(upstream);
  });

  it('caches templates at connect time instead of listing them on every read', async () => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    await start('alpha');
    expect(alpha.listResourceTemplates).toHaveBeenCalledTimes(1);
    expect(getServerByName('alpha')?.resourceTemplates).toEqual([
      { uriTemplate: 'x://items/{id}', name: 'x://items/{id}' },
    ]);

    await read('x://items/1', 'alpha-session');
    await read('x://items/2', 'alpha-session');
    await read('x://unknown/3', 'alpha-session');

    expect(alpha.listResourceTemplates).toHaveBeenCalledTimes(1);
    expect(alpha.readResource).toHaveBeenCalledTimes(2);
  });

  it('fetches templates live once when the connect-time listing failed', async () => {
    const alpha = addUpstream('alpha', []);
    alpha.listResourceTemplates.mockRejectedValueOnce(new Error('temporarily unavailable'));
    alpha.listResourceTemplates.mockResolvedValue({
      resourceTemplates: [{ uriTemplate: 'x://items/{id}', name: 'item' }],
    });
    await start('alpha');
    expect(getServerByName('alpha')?.resourceTemplates).toBeUndefined();

    expect((await read('x://items/1', 'alpha-session')).contents[0].text).toBe('alpha:x://items/1');
    expect((await read('x://items/2', 'alpha-session')).contents[0].text).toBe('alpha:x://items/2');
    expect(alpha.listResourceTemplates).toHaveBeenCalledTimes(2);
  });

  it('retries a failed live template listing only after a backoff', async () => {
    const alpha = addUpstream('alpha', []);
    alpha.listResourceTemplates.mockRejectedValue(new Error('Method not found'));
    await start('alpha');
    const now = jest.spyOn(Date, 'now');
    try {
      await read('x://items/1', 'alpha-session');
      await read('x://items/2', 'alpha-session');
      expect(alpha.listResourceTemplates).toHaveBeenCalledTimes(2);

      alpha.listResourceTemplates.mockResolvedValue({
        resourceTemplates: [{ uriTemplate: 'x://items/{id}', name: 'item' }],
      });
      now.mockReturnValue(Date.now() + 61_000);
      expect((await read('x://items/3', 'alpha-session')).contents[0].text).toBe(
        'alpha:x://items/3',
      );
      expect(alpha.listResourceTemplates).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });

  it('skips the live listing for a group that excludes all resources', async () => {
    const alpha = addUpstream('alpha', []);
    alpha.listResourceTemplates.mockRejectedValueOnce(new Error('temporarily unavailable'));
    mockGroupFindByName.mockImplementation(async (name: string) =>
      name === 'restricted' ? { name, servers: [{ name: 'alpha', resources: [] }] } : null,
    );
    await start('alpha');

    await read('x://items/1', 'restricted-session');

    expect(alpha.listResourceTemplates).toHaveBeenCalledTimes(1);
  });

  it('does not list templates for a server without the resources capability', async () => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    alpha.getServerCapabilities.mockReturnValue({ tools: {} } as any);
    await start('alpha');

    const result = await read('x://items/1', 'alpha-session');

    expect(result.contents[0].text).toBe('Error: Error | Resource not found: x://items/1');
    expect(alpha.listResourceTemplates).not.toHaveBeenCalled();
  });

  it('refreshes cached templates when the upstream resource list changes', async () => {
    const alpha = addUpstream('alpha', ['x://old/{id}']);
    await start('alpha');
    alpha.listResourceTemplates.mockResolvedValue({
      resourceTemplates: [{ uriTemplate: 'x://new/{id}', name: 'new' }],
    });
    const [, clientOptions] = (Client as unknown as jest.Mock).mock.calls.find(
      ([info]) => info.name === 'mcp-client-alpha',
    );

    clientOptions.listChanged.resources.onChanged(null, []);
    await flushPromises();

    expect((await read('x://new/1', 'alpha-session')).contents[0].text).toBe('alpha:x://new/1');
    expect((await read('x://old/1', 'alpha-session')).contents[0].text).toBe(
      'Error: Error | Resource not found: x://old/1',
    );
  });

  it('updates cached templates when resources/templates/list is served', async () => {
    const alpha = addUpstream('alpha', ['x://old/{id}']);
    await start('alpha');
    alpha.listResourceTemplates.mockResolvedValue({
      resourceTemplates: [{ uriTemplate: 'x://new/{id}', name: 'new' }],
    });

    await handleListResourceTemplatesRequest({}, { sessionId: 'alpha-session' });

    expect(getServerByName('alpha')?.resourceTemplates).toEqual([
      { uriTemplate: 'x://new/{id}', name: 'new' },
    ]);
  });

  it('propagates an upstream read error for a matched template', async () => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    alpha.readResource.mockRejectedValue(new Error('Document 404 not found'));
    await start('alpha');

    const result = await read('x://items/404', 'alpha-session');

    expect(result.contents[0].text).toContain('Document 404 not found');
  });

  it('wakes an idle on-demand server whose cached template matches', async () => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    await start('alpha');
    // Simulate idle shutdown: runtime closed, caches kept.
    const onDemandConfig = makeServerConfig('alpha', { startOnDemand: true });
    mockFindById.mockImplementation(async () => onDemandConfig);
    const info = getServerByName('alpha')!;
    info.config = onDemandConfig as any;
    info.status = 'disconnected';
    info.client = undefined;
    info.transport = undefined;
    alpha.connect.mockClear();

    const result = await read('x://items/9', 'alpha-session');

    expect(alpha.connect).toHaveBeenCalledTimes(1);
    expect(result.contents[0].text).toBe('alpha:x://items/9');
    expect(info.status).toBe('connected');
    expect(info.activeToolCalls).toBe(0);
  });

  it('releases the on-demand guard when waking for a template read fails', async () => {
    const alpha = addUpstream('alpha', ['x://items/{id}']);
    await start('alpha');
    const onDemandConfig = makeServerConfig('alpha', { startOnDemand: true });
    mockFindById.mockImplementation(async () => onDemandConfig);
    const info = getServerByName('alpha')!;
    info.config = onDemandConfig as any;
    info.status = 'disconnected';
    info.client = undefined;
    info.transport = undefined;
    alpha.connect.mockRejectedValueOnce(new Error('spawn failed'));

    const result = await read('x://items/9', 'alpha-session');

    expect(result.contents[0].text).toContain('spawn failed');
    expect(alpha.readResource).not.toHaveBeenCalled();
    expect(info.activeToolCalls).toBe(0);
  });

  describe('modern upstreams', () => {
    const addModernUpstream = (name: string, uriTemplates: string[]) => {
      const client = addUpstream(name, uriTemplates);
      (client as any).getProtocolEra = jest.fn(() => 'modern');
      return client;
    };

    it('revalidates templates on a template read instead of trusting the cache', async () => {
      const alpha = addModernUpstream('alpha', ['x://old/{id}']);
      await start('alpha');
      alpha.listResourceTemplates.mockResolvedValue({
        resourceTemplates: [{ uriTemplate: 'x://new/{id}', name: 'new' }],
      });

      expect((await read('x://new/1', 'alpha-session')).contents[0].text).toBe('alpha:x://new/1');
    });

    it('does not list templates for static reads or retry a failed listing on every read', async () => {
      const alpha = addModernUpstream('alpha', []);
      alpha.listResources.mockResolvedValue({
        resources: [{ uri: 'x://static', name: 'Static' }],
      });
      alpha.listResourceTemplates.mockRejectedValue(new Error('Method not found'));
      await start('alpha');
      alpha.listResourceTemplates.mockClear();

      expect((await read('x://static', 'alpha-session')).contents[0].text).toBe('alpha:x://static');
      await read('x://items/1', 'alpha-session');
      await read('x://items/2', 'alpha-session');
      await read('x://items/3', 'alpha-session');

      expect(alpha.listResourceTemplates).toHaveBeenCalledTimes(1);
    });
  });

  describe('regressions', () => {
    it('reads a static resource from the server that lists it, before templates', async () => {
      const alpha = addUpstream('alpha', ['x://items/{id}']);
      const beta = addUpstream('beta', []);
      beta.listResources.mockResolvedValue({
        resources: [{ uri: 'x://items/static', name: 'Static' }],
      });
      await start('alpha', 'beta');

      const result = await read('x://items/static', 'pair-session');

      expect(result.contents[0].text).toBe('beta:x://items/static');
      expect(alpha.readResource).not.toHaveBeenCalled();
    });

    it('still probes ui:// resources on an Apps route and does not fall back to templates', async () => {
      const alpha = addUpstream('alpha', ['ui://{name}']);
      alpha.readResource.mockRejectedValue(new Error('unknown widget'));
      await start('alpha');
      const server = await getMcpServer('apps-session', 'alpha');
      (server as any)._clientCapabilities = MCP_APPS_CAPABILITIES;

      const result = await read('ui://missing.html', 'apps-session');

      expect(alpha.readResource).toHaveBeenCalledTimes(1);
      expect(result.contents[0].text).toBe('Error: Error | Resource not found: ui://missing.html');
    });

    it('serves a dynamic ui:// resource on an Apps route as before', async () => {
      const alpha = addUpstream('alpha', []);
      await start('alpha');
      const server = await getMcpServer('apps-session', 'alpha');
      (server as any)._clientCapabilities = MCP_APPS_CAPABILITIES;

      const result = await read('ui://widget.html', 'apps-session');

      expect(result.contents[0].text).toBe('alpha:ui://widget.html');
      expect(alpha.readResource).toHaveBeenCalledWith({ uri: 'ui://widget.html' });
    });
  });
});
