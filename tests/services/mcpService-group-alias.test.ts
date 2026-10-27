import { MCP_APPS_CAPABILITIES } from '../../src/utils/mcpApps.js';
import { RequestContextService } from '../../src/services/requestContextService.js';
import { jest } from '@jest/globals';
import type { IGroup, ServerInfo } from '../../src/types/index.js';

const teamGroup: IGroup = {
  id: 'group-1',
  name: 'team-a',
  owner: 'alice',
  servers: [
    {
      name: 'u17__fetch',
      alias: 'fetch',
      tools: 'all',
      prompts: 'all',
      resources: 'all',
    },
  ],
};

const mockCallTool = jest.fn();
const mockGetPrompt = jest.fn();

const mockGroupDao = {
  findAll: jest.fn(async () => [teamGroup]),
  findByName: jest.fn(async (name: string) => (name === teamGroup.name ? teamGroup : null)),
  findById: jest.fn(async (id: string) => (id === teamGroup.id ? teamGroup : null)),
};

const mockServerDao = {
  findAll: jest.fn(async () => [{ name: 'u17__fetch', enabled: true }]),
  findById: jest.fn(async (name: string) =>
    name === 'u17__fetch'
      ? {
          name: 'u17__fetch',
          enabled: true,
          tools: {},
          prompts: {},
          resources: {},
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
    if (sessionId === 'team-session') return 'team-a';
    if (sessionId === 'smart-team-session') return '$smart/team-a';
    return undefined;
  }),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
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

import {
  cleanupAllServers,
  handleCallToolRequest,
  handleGetPromptRequest,
  handleListPromptsRequest,
  handleListToolsRequest,
  handleListResourcesRequest,
  handleListResourceTemplatesRequest,
  handleReadResourceRequest,
  setServerInfosForTest,
} from '../../src/services/mcpService.js';

const aliasedServerInfo = (): ServerInfo =>
  ({
    name: 'u17__fetch',
    status: 'connected',
    enabled: true,
    tools: [
      {
        name: 'u17__fetch::fetch_url',
        description: 'Fetch a URL',
        inputSchema: { type: 'object' },
      },
    ],
    prompts: [
      {
        name: 'u17__fetch::summarize',
        description: 'Summarize content',
        arguments: [],
      },
    ],
    resources: [{ name: 'guide', uri: 'test://guide' }],
    client: {
      callTool: mockCallTool,
      getPrompt: mockGetPrompt,
      listResourceTemplates: jest.fn(async () => ({
        resourceTemplates: [{ name: 'guide', uriTemplate: 'test://{id}' }],
      })),
      readResource: jest.fn(async () => ({ contents: [{ uri: 'test://guide', text: 'guide' }] })),
    },
    options: {},
  }) as unknown as ServerInfo;

describe('mcpService group server alias', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.findById
      .mockReset()
      .mockImplementation(async (name: string) =>
        name === 'u17__fetch'
          ? { name, enabled: true, tools: {}, prompts: {}, resources: {} }
          : null,
      );
    cleanupAllServers();
    setServerInfosForTest([aliasedServerInfo()]);
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });
    mockGetPrompt.mockResolvedValue({
      messages: [{ role: 'user', content: { type: 'text', text: 'summary' } }],
    });
  });

  afterEach(() => {
    cleanupAllServers();
  });

  describe('original tool names', () => {
    beforeEach(() => {
      (teamGroup.servers[0] as any).preserveToolNames = true;
    });
    afterEach(() => {
      delete (teamGroup.servers[0] as any).preserveToolNames;
      teamGroup.servers.splice(1);
    });

    it('lists and calls upstream names while preserving prompt aliases', async () => {
      const tools = await handleListToolsRequest({}, { sessionId: 'team-session' });
      expect(tools.tools.map((tool) => tool.name)).toEqual(['fetch_url']);
      const prompts = await handleListPromptsRequest({}, { sessionId: 'team-session' });
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(['fetch::summarize']);
      for (const sessionId of ['team-session', 'smart-team-session']) {
        const result = await handleCallToolRequest(
          { params: { name: 'fetch_url', arguments: {} } },
          { sessionId },
        );
        expect(result.isError).toBe(false);
        expect(mockCallTool).toHaveBeenLastCalledWith(
          { name: 'fetch_url', arguments: {} },
          expect.anything(),
        );
      }
      const wrapped = await handleCallToolRequest(
        { params: { name: 'call_tool', arguments: { toolName: 'fetch_url', arguments: {} } } },
        { sessionId: 'smart-team-session' },
      );
      expect(wrapped.isError).toBe(false);
    });

    it.each([
      ['fetch_url', true],
      ['fetch_url', false],
      ['call_tool', true],
    ] as const)(
      'ignores hidden App-only %s tools (hidden server first: %s)',
      async (hiddenName, hiddenFirst) => {
        (teamGroup.servers as any[]).push({ name: 'peer', preserveToolNames: true, tools: 'all' });
        const hiddenCall = jest.fn();
        const peer = {
          ...aliasedServerInfo(),
          name: 'peer',
          tools: [
            {
              name: `peer::${hiddenName}`,
              inputSchema: { type: 'object' },
              _meta: { ui: { visibility: ['app'] } },
            },
          ],
          client: { callTool: hiddenCall },
        } as unknown as ServerInfo;
        const visible = aliasedServerInfo();
        setServerInfosForTest(hiddenFirst ? [peer, visible] : [visible, peer]);
        const tools = await handleListToolsRequest({}, { sessionId: 'team-session' });
        expect(tools.tools.map((tool) => tool.name)).toEqual(['fetch_url']);
        for (const sessionId of ['team-session', 'smart-team-session']) {
          for (const params of [
            { name: 'fetch_url', arguments: {} },
            { name: 'call_tool', arguments: { toolName: 'fetch_url', arguments: {} } },
          ]) {
            const result = await handleCallToolRequest({ params }, { sessionId });
            expect(result.isError).toBe(false);
          }
        }
        expect(mockCallTool).toHaveBeenCalledTimes(4);
        expect(hiddenCall).not.toHaveBeenCalled();
      },
    );

    it('still rejects the collision when the caller can see App-only tools', async () => {
      (teamGroup.servers as any[]).push({ name: 'peer', preserveToolNames: true, tools: 'all' });
      const peer = {
        ...aliasedServerInfo(),
        name: 'peer',
        tools: [
          {
            name: 'peer::fetch_url',
            inputSchema: { type: 'object' },
            _meta: { ui: { visibility: ['app'] } },
          },
        ],
      } as ServerInfo;
      setServerInfosForTest([peer, aliasedServerInfo()]);
      await RequestContextService.getInstance().runWithCustomRequestContext(
        {
          headers: {},
          stateless: true,
          group: 'team-a',
          clientCapabilities: MCP_APPS_CAPABILITIES,
        },
        async () => {
          await expect(handleListToolsRequest({}, { group: 'team-a' })).rejects.toThrow(
            'Ambiguous group tool name',
          );
          const result = await handleCallToolRequest(
            { params: { name: 'fetch_url', arguments: {} } },
            { group: 'team-a' },
          );
          expect(result.isError).toBe(true);
          expect(mockCallTool).not.toHaveBeenCalled();
        },
      );
    });

    it('rejects duplicate exposed names before listing or dispatching', async () => {
      (teamGroup.servers as any[]).push({ name: 'peer', preserveToolNames: true, tools: 'all' });
      const peer = {
        ...aliasedServerInfo(),
        name: 'peer',
        tools: [{ name: 'peer::fetch_url', inputSchema: { type: 'object' } }],
      } as ServerInfo;
      setServerInfosForTest([aliasedServerInfo(), peer]);
      await expect(handleListToolsRequest({}, { sessionId: 'team-session' })).rejects.toThrow(
        'Ambiguous group tool name',
      );
      const result = await handleCallToolRequest(
        { params: { name: 'fetch_url', arguments: {} } },
        { sessionId: 'team-session' },
      );
      expect(result.isError).toBe(true);
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it('rejects a raw name that collides with another server’s qualified name', async () => {
      const primary = aliasedServerInfo();
      primary.tools[0].name = 'u17__fetch::other::fetch_url';
      (teamGroup.servers as any[]).push({ name: 'peer', alias: 'other', tools: 'all' });
      const peer = {
        ...aliasedServerInfo(),
        name: 'peer',
        tools: [{ name: 'peer::fetch_url', inputSchema: { type: 'object' } }],
      } as ServerInfo;
      setServerInfosForTest([primary, peer]);
      await expect(handleListToolsRequest({}, { sessionId: 'team-session' })).rejects.toThrow(
        'Ambiguous group tool name',
      );
      const result = await handleCallToolRequest(
        { params: { name: 'other::fetch_url', arguments: {} } },
        { sessionId: 'team-session' },
      );
      expect(result.isError).toBe(true);
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it.each(['search_tools', 'describe_tool', 'call_tool'])(
      'rejects the reserved name %s',
      async (name) => {
        const info = aliasedServerInfo();
        info.tools[0].name = `u17__fetch::${name}`;
        setServerInfosForTest([info]);
        await expect(handleListToolsRequest({}, { sessionId: 'team-session' })).rejects.toThrow(
          'Smart Routing meta-tools',
        );
      },
    );

    it('allows a mixed group with unique prefixed and original names', async () => {
      (teamGroup.servers as any[]).push({ name: 'peer', alias: 'other', tools: 'all' });
      const peer = {
        ...aliasedServerInfo(),
        name: 'peer',
        tools: [{ name: 'peer::fetch_url', inputSchema: { type: 'object' } }],
      } as ServerInfo;
      setServerInfosForTest([aliasedServerInfo(), peer]);
      const tools = await handleListToolsRequest({}, { sessionId: 'team-session' });
      expect(tools.tools.map((tool) => tool.name)).toEqual(['fetch_url', 'other::fetch_url']);
      const result = await handleCallToolRequest(
        { params: { name: 'other::fetch_url', arguments: {} } },
        { sessionId: 'team-session' },
      );
      expect(result.isError).toBe(false);
    });
  });

  it('exposes group tools and prompts with the group server alias', async () => {
    const tools = await handleListToolsRequest({}, { sessionId: 'team-session' });
    const prompts = await handleListPromptsRequest({}, { sessionId: 'team-session' });

    expect(tools.tools.map((tool) => tool.name)).toEqual(['fetch::fetch_url']);
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(['fetch::summarize']);
  });

  it('resolves aliased group tool calls back to the internal server name', async () => {
    const result = await handleCallToolRequest(
      { params: { name: 'fetch::fetch_url', arguments: { url: 'https://example.com' } } },
      { sessionId: 'team-session' },
    );

    expect(result.isError).toBe(false);
    expect(mockCallTool).toHaveBeenCalledWith(
      { name: 'fetch_url', arguments: { url: 'https://example.com' } },
      expect.anything(),
    );
  });

  it('resolves aliased group prompt requests back to the internal server name', async () => {
    const result = await handleGetPromptRequest(
      { params: { name: 'fetch::summarize', arguments: { topic: 'docs' } } },
      { sessionId: 'team-session' },
    );

    expect(result.messages[0].content.text).toBe('summary');
    expect(mockGetPrompt).toHaveBeenCalledWith({
      name: 'summarize',
      arguments: { topic: 'docs' },
    });
  });

  it.each([
    ['global', {}, 'u17__fetch::summarize'],
    ['direct', { server: 'u17__fetch' }, 'summarize'],
    ['group', { group: 'team-a' }, 'fetch::summarize'],
  ])('rejects disabled prompts on the %s path', async (_label, extra, name) => {
    mockServerDao.findById.mockResolvedValueOnce({
      name: 'u17__fetch',
      enabled: true,
      tools: {},
      resources: {},
      prompts: { 'u17__fetch::summarize': { enabled: false } },
    });
    const result = await handleGetPromptRequest({ params: { name } }, extra);
    expect(result.isError).toBe(true);
    expect(mockGetPrompt).not.toHaveBeenCalled();
  });

  it.each(['summarize', 'u17__fetch::summarize'])(
    'honors persisted prompt disablement under %s',
    async (key) => {
      mockServerDao.findById.mockResolvedValueOnce({
        name: 'u17__fetch',
        enabled: true,
        tools: {},
        resources: {},
        prompts: { [key]: { enabled: false } },
      });
      const result = await handleGetPromptRequest(
        { params: { name: 'u17__fetch::summarize' } },
        {},
      );
      expect(result.isError).toBe(true);
      expect(mockGetPrompt).not.toHaveBeenCalled();
    },
  );

  it.each(['disabled', 'disconnected', 'unlisted'])(
    'rejects a direct prompt when the target is %s',
    async (kind) => {
      const info = aliasedServerInfo();
      if (kind === 'disabled') info.enabled = false;
      if (kind === 'disconnected') info.status = 'disconnected';
      if (kind === 'unlisted') info.prompts = [];
      setServerInfosForTest([info]);
      const result = await handleGetPromptRequest(
        { params: { name: 'summarize' } },
        { server: info.name },
      );
      expect(result.isError).toBe(true);
      expect(mockGetPrompt).not.toHaveBeenCalled();
    },
  );

  it('retrieves an enabled raw prompt on an explicit server', async () => {
    const result = await handleGetPromptRequest(
      { params: { name: 'summarize' } },
      { server: 'u17__fetch' },
    );
    expect(result.messages[0].content.text).toBe('summary');
    expect(mockGetPrompt).toHaveBeenCalledWith({ name: 'summarize', arguments: undefined });
  });
  it.each([
    ['request context', 'team-a', { group: 'missing', sessionId: 'unknown' }],
    ['explicit group', undefined, { group: 'team-a' }],
    ['legacy session', undefined, { sessionId: 'team-session' }],
    ['smart request context', '$smart/team-a', { group: 'missing' }],
  ])('routes prompts and resources through %s', async (_label, group, extra) => {
    await RequestContextService.getInstance().runWithCustomRequestContext(
      { headers: {}, group },
      async () => {
        const prompts = await handleListPromptsRequest({}, extra);
        expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(['fetch::summarize']);
        expect(
          (await handleGetPromptRequest({ params: { name: 'fetch::summarize' } }, extra))
            .messages[0].content.text,
        ).toBe('summary');
        expect(
          (await handleListResourcesRequest({}, extra)).resources.map((resource) => resource.uri),
        ).toEqual(['test://guide']);
        expect(
          (await handleListResourceTemplatesRequest({}, extra)).resourceTemplates.map(
            (template) => template.uriTemplate,
          ),
        ).toEqual(['test://{id}']);
        expect(
          (await handleReadResourceRequest({ params: { uri: 'test://guide' } }, extra)).contents[0]
            .text,
        ).toBe('guide');
      },
    );
  });

  it('isolates concurrent sessionless tool lists by request group', async () => {
    const context = RequestContextService.getInstance();
    const lists = await Promise.all(
      ['team-a', 'missing'].map((group) =>
        context.runWithCustomRequestContext({ headers: {}, group }, async () => {
          await Promise.resolve();
          return handleListToolsRequest({}, { sessionId: 'team-session' });
        }),
      ),
    );
    expect(lists[0].tools.map((tool) => tool.name)).toEqual(['fetch::fetch_url']);
    expect(lists[1].tools).toEqual([]);
  });

  it('keeps an explicit global context instead of falling back to a session group', async () => {
    const result = await RequestContextService.getInstance().runWithCustomRequestContext(
      { headers: {}, group: '' },
      () => handleListToolsRequest({}, { group: 'team-a', sessionId: 'team-session' }),
    );
    expect(result.tools.map((tool) => tool.name)).toEqual(['u17__fetch::fetch_url']);
  });
  it('routes sessionless calls and direct server lists using request context', async () => {
    const context = RequestContextService.getInstance();
    const call = (group: string) =>
      context.runWithCustomRequestContext({ headers: {}, group }, () =>
        handleCallToolRequest(
          { params: { name: 'fetch::fetch_url', arguments: {} } },
          { group: 'missing' },
        ),
      );
    expect((await call('team-a')).isError).toBe(false);
    mockCallTool.mockClear();
    expect((await call('missing')).isError).toBe(true);
    expect(mockCallTool).not.toHaveBeenCalled();
    const tools = await context.runWithCustomRequestContext(
      { headers: {}, group: 'u17__fetch' },
      () => handleListToolsRequest({}, {}),
    );
    expect(tools.tools.map((tool) => tool.name)).toEqual(['fetch_url']);
  });
});
