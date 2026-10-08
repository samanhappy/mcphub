import { jest } from '@jest/globals';
import type { IGroup, ServerInfo } from '../../src/types/index.js';

const groups: Record<string, IGroup> = {
  pinned: {
    id: 'group-pinned',
    name: 'pinned',
    servers: [
      {
        name: 'time',
        alias: 'clock',
        tools: 'all',
        // 'convert_time' is disabled server-wide and 'missing' does not exist
        pinnedTools: ['get_current_time', 'convert_time', 'missing'],
      },
      {
        name: 'notes',
        tools: ['search_notes'],
        // 'delete_note' is outside the group's tools selection
        pinnedTools: ['search_notes', 'delete_note'],
      },
    ],
  },
  extras: {
    id: 'group-extras',
    name: 'extras',
    // 'widget' is an MCP Apps (app-only) tool
    servers: [{ name: 'notes', tools: 'all', pinnedTools: ['search_notes', 'widget'] }],
  },
  // Stored without going through the controllers' validation
  broken: {
    id: 'group-broken',
    name: 'broken',
    servers: [{ name: 'notes', tools: 'all', pinnedTools: 'search_notes' as any }],
  },
  failing: {
    id: 'group-failing',
    name: 'failing',
    servers: [{ name: 'notes', tools: 'all', pinnedTools: ['search_notes'] }],
  },
  // With a '_' separator these pins project onto meta-tool names:
  // describe + _ + tool = describe_tool, search + _ + tools = search_tools
  reserved: {
    id: 'group-reserved',
    name: 'reserved',
    servers: [
      { name: 'widgets', alias: 'describe', tools: 'all', pinnedTools: ['tool', 'ping'] },
      { name: 'gadgets', alias: 'search', tools: 'all', pinnedTools: ['tools'] },
    ],
  },
  apps: {
    id: 'group-apps',
    name: 'apps',
    servers: [
      { name: 'viewer', tools: 'all', pinnedTools: ['show'] },
      { name: 'time', tools: 'all' },
    ],
  },
  unpinned: {
    id: 'group-unpinned',
    name: 'unpinned',
    servers: [{ name: 'time', tools: 'all' }, 'notes'],
  },
};

const mockTimeCallTool = jest.fn();

const mockGroupDao = {
  findByName: jest.fn(async (name: string) => {
    if (name === 'failing') throw new Error('database unavailable');
    return groups[name] ?? null;
  }),
  findById: jest.fn(async () => null),
};

const mockServerDao = {
  findAll: jest.fn(async () => []),
  findById: jest.fn(async (name: string) =>
    name === 'time'
      ? {
          name: 'time',
          tools: {
            'time::get_current_time': { enabled: true, description: 'Current time (override)' },
            'time::convert_time': { enabled: false },
          },
        }
      : null,
  ),
};

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => mockGroupDao),
  getServerDao: jest.fn(() => mockServerDao),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(async () => ({})),
  })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
    findByName: jest.fn(async () => null),
  })),
  getBuiltinResourceDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
    findByUri: jest.fn(async () => null),
  })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any[]) => data,
  })),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn((sessionId: string) => {
    if (sessionId === 'smart-pinned') return '$smart/pinned';
    if (sessionId === 'smart-unpinned') return '$smart/unpinned';
    if (sessionId === 'smart-global') return '$smart';
    if (sessionId === 'smart-apps') return '$smart/apps';
    if (sessionId === 'smart-apps-global') return '$smart';
    if (sessionId === 'smart-extras') return '$smart/extras';
    if (sessionId === 'smart-reserved') return '$smart/reserved';
    if (sessionId === 'smart-broken') return '$smart/broken';
    if (sessionId === 'smart-failing') return '$smart/failing';
    return undefined;
  }),
}));

const metaTools = { tools: [{ name: 'search_tools' }, { name: 'call_tool' }] };
jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(async () => metaTools),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn((group?: string) => Boolean(group?.startsWith('$smart'))),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn(async () => undefined),
  })),
}));

jest.mock('../../src/services/hostedAuthService.js', () => ({
  assertHostedToolAllowed: jest.fn(),
  filterHostedTools: jest.fn((_auth, _serverName, tools) => tools),
  reserveHostedToolCall: jest.fn(async () => null),
  settleHostedToolCall: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

jest.mock('../../src/config/index.js', () => ({
  expandEnvVars: jest.fn((value: string) => value),
  replaceEnvVars: jest.fn((value: unknown) => value),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import { getNameSeparator } from '../../src/config/index.js';
import {
  getSmartRoutingTools,
  handleDescribeToolRequest,
} from '../../src/services/smartRoutingService.js';
import {
  cleanupAllServers,
  handleCallToolRequest,
  handleListToolsRequest,
  handleReadResourceRequest,
  setServerInfosForTest,
} from '../../src/services/mcpService.js';
import { RequestContextService } from '../../src/services/requestContextService.js';

const tool = (server: string, name: string) => ({
  name: `${server}::${name}`,
  description: `${name} description`,
  inputSchema: { type: 'object' },
});

const serverInfo = (
  name: string,
  toolNames: string[],
  callTool = jest.fn(),
  config: Record<string, unknown> = {},
): ServerInfo =>
  ({
    name,
    status: 'connected',
    enabled: true,
    // The runtime copy of the server config: the call path reads tool toggles from it
    config,
    tools: toolNames.map((toolName) => tool(name, toolName)),
    prompts: [],
    resources: [],
    client: { callTool },
    options: {},
  }) as unknown as ServerInfo;

// 'widget' is shown only inside an MCP Apps host, never to the model
const notesServer = (): ServerInfo => {
  const info = serverInfo('notes', ['search_notes', 'delete_note']);
  info.tools.push({
    ...tool('notes', 'widget'),
    _meta: { ui: { resourceUri: 'ui://notes/widget', visibility: ['app'] } },
  } as any);
  return info;
};

describe('mcpService $smart/<group> pinned tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupAllServers();
    setServerInfosForTest([
      serverInfo('time', ['get_current_time', 'convert_time'], mockTimeCallTool, {
        tools: { 'time::convert_time': { enabled: false } },
      }),
      notesServer(),
    ]);
    mockTimeCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });
  });

  afterEach(() => {
    cleanupAllServers();
  });

  it('lists the pinned tools after the meta-tools, filtered and projected like a direct group', async () => {
    const result = await handleListToolsRequest({}, { sessionId: 'smart-pinned' });

    expect(result.tools.map((listed: { name: string }) => listed.name)).toEqual([
      'search_tools',
      'call_tool',
      'clock::get_current_time',
      'notes::search_notes',
    ]);
    expect(result.tools[2]).toEqual({
      name: 'clock::get_current_time',
      description: 'Current time (override)',
      inputSchema: { type: 'object' },
    });
  });

  it('returns the meta-tool result untouched when a group pins nothing', async () => {
    const result = await handleListToolsRequest({}, { sessionId: 'smart-unpinned' });

    expect(result).toBe(metaTools);
  });

  it('pins nothing on the global $smart route', async () => {
    const result = await handleListToolsRequest({}, { sessionId: 'smart-global' });

    expect(result).toBe(metaTools);
  });

  it('calls a pinned tool directly by its listed name', async () => {
    const result = await handleCallToolRequest(
      { params: { name: 'clock::get_current_time', arguments: { timezone: 'UTC' } } },
      { sessionId: 'smart-pinned' },
    );

    expect(result.isError).toBe(false);
    expect(mockTimeCallTool.mock.calls[0][0]).toEqual({
      name: 'get_current_time',
      arguments: { timezone: 'UTC' },
    });
  });

  // A pin makes a tool name visible, never callable beyond what the group allows
  it.each([
    ['notes::delete_note', 'outside the tools selection'],
    ['clock::convert_time', 'disabled server-wide'],
  ])('refuses a direct call to %s, pinned but %s', async (name) => {
    const result = await handleCallToolRequest(
      { params: { name, arguments: {} } },
      { sessionId: 'smart-pinned' },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(`Tool not available: ${name}`);
    expect(mockTimeCallTool).not.toHaveBeenCalled();
  });

  it('never lists an app-only tool as a pin', async () => {
    const result = await handleListToolsRequest({}, { sessionId: 'smart-extras' });

    expect(result.tools.map((listed: { name: string }) => listed.name)).toEqual([
      'search_tools',
      'call_tool',
      'notes::search_notes',
    ]);
  });

  it('appends pins after the meta-tools under progressive disclosure too', async () => {
    const withDescribe = {
      tools: [{ name: 'search_tools' }, { name: 'describe_tool' }, { name: 'call_tool' }],
    };
    jest.mocked(getSmartRoutingTools).mockResolvedValueOnce(withDescribe as any);

    const result = await handleListToolsRequest({}, { sessionId: 'smart-extras' });

    expect(result.tools.map((listed: { name: string }) => listed.name)).toEqual([
      'search_tools',
      'describe_tool',
      'call_tool',
      'notes::search_notes',
    ]);
  });

  describe('pins projected onto a meta-tool name', () => {
    const underscoreServer = (name: string, toolNames: string[], callTool = jest.fn()) =>
      ({
        name,
        status: 'connected',
        enabled: true,
        config: {},
        tools: toolNames.map((toolName) => ({
          name: `${name}_${toolName}`,
          description: `${toolName} description`,
          inputSchema: { type: 'object' },
        })),
        prompts: [],
        resources: [],
        client: { callTool },
        options: {},
      }) as unknown as ServerInfo;
    const widgetsCallTool = jest.fn();

    beforeEach(() => {
      jest.mocked(getNameSeparator).mockReturnValue('_');
      setServerInfosForTest([
        underscoreServer('widgets', ['tool', 'ping'], widgetsCallTool),
        underscoreServer('gadgets', ['tools']),
      ]);
    });

    afterEach(() => {
      jest.mocked(getNameSeparator).mockReturnValue('::');
    });

    it('lists none of them, including describe_tool while progressive disclosure is off', async () => {
      // The meta-tools of this mode are search_tools and call_tool only
      const result = await handleListToolsRequest({}, { sessionId: 'smart-reserved' });

      expect(result.tools.map((listed: { name: string }) => listed.name)).toEqual([
        'search_tools',
        'call_tool',
        'describe_ping',
      ]);
    });

    it('would not reach the pinned tool anyway: the call handler takes describe_tool', async () => {
      await handleCallToolRequest(
        { params: { name: 'describe_tool', arguments: { toolName: 'x' } } },
        { sessionId: 'smart-reserved' },
      );

      expect(handleDescribeToolRequest).toHaveBeenCalled();
      expect(widgetsCallTool).not.toHaveBeenCalled();
    });
  });

  it('ignores pins stored in a malformed shape instead of failing the listing', async () => {
    const result = await handleListToolsRequest({}, { sessionId: 'smart-broken' });

    expect(result).toBe(metaTools);
  });

  it('still returns the meta-tools when resolving pins fails', async () => {
    const result = await handleListToolsRequest({}, { sessionId: 'smart-failing' });

    expect(result).toBe(metaTools);
  });

  describe('MCP Apps widgets on a pinned tool', () => {
    const appsCapabilities = {
      extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
    };
    const viewerCallTool = jest.fn();
    const viewerReadResource = jest.fn();

    // A stateless request declares its capabilities per request
    const asClient = <T>(clientCapabilities: unknown, callback: () => Promise<T>) =>
      RequestContextService.getInstance().runWithCustomRequestContext(
        { headers: {}, stateless: true, clientCapabilities } as any,
        callback,
      );

    beforeEach(() => {
      const viewer = serverInfo('viewer', ['show', 'other'], viewerCallTool);
      viewer.tools[0]._meta = { ui: { resourceUri: 'ui://viewer/show' } };
      viewer.tools.push({
        ...tool('viewer', 'refresh'),
        _meta: { ui: { resourceUri: 'ui://viewer/show', visibility: ['app'] } },
      } as any);
      (viewer.client as any).readResource = viewerReadResource;
      setServerInfosForTest([viewer]);
      viewerCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });
      viewerReadResource.mockResolvedValue({
        contents: [
          { uri: 'ui://viewer/show', mimeType: 'text/html;profile=mcp-app', text: '<html/>' },
        ],
      });
    });

    it('keeps the widget link on the pinned tool for an Apps-capable client', async () => {
      const result = await asClient(appsCapabilities, () =>
        handleListToolsRequest({}, { sessionId: 'smart-apps' }),
      );

      const listed = result.tools.filter((t: { name: string }) => t.name.startsWith('viewer'));
      expect(listed).toEqual([
        expect.objectContaining({
          name: 'viewer::show',
          _meta: { ui: { resourceUri: 'ui://viewer/show' } },
        }),
      ]);
    });

    it('still strips the widget link for a client without Apps support', async () => {
      const result = await asClient({}, () =>
        handleListToolsRequest({}, { sessionId: 'smart-apps' }),
      );

      const listed = result.tools.find((t: { name: string }) => t.name === 'viewer::show');
      expect(listed).toBeDefined();
      expect(listed._meta).toBeUndefined();
    });

    it('does not enable Apps on the global $smart route', async () => {
      const result = await asClient(appsCapabilities, () =>
        handleListToolsRequest({}, { sessionId: 'smart-apps-global' }),
      );

      expect(result.tools).toEqual(metaTools.tools);
    });

    it('lets the widget call an app-only tool of its server, but not without Apps support', async () => {
      const call = (caps: unknown) =>
        asClient(caps, () =>
          handleCallToolRequest(
            { params: { name: 'viewer::refresh', arguments: {} } },
            { sessionId: 'smart-apps' },
          ),
        );

      expect((await call(appsCapabilities)).isError).toBe(false);
      expect(viewerCallTool.mock.calls[0][0]).toEqual({ name: 'refresh', arguments: {} });
      expect((await call({})).isError).toBe(true);
      expect(viewerCallTool).toHaveBeenCalledTimes(1);
    });

    it('serves the ui:// resource of the pinned tool to an Apps-capable client only', async () => {
      const read = (caps: unknown) =>
        asClient(caps, () =>
          handleReadResourceRequest(
            { params: { uri: 'ui://viewer/show' } },
            { sessionId: 'smart-apps' },
          ),
        );

      const served = await read(appsCapabilities);
      expect(served.contents[0].text).toBe('<html/>');
      const refused = await read({});
      expect(refused.contents?.[0]?.text ?? '').not.toBe('<html/>');
    });
  });
});
