jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn(),
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

const mockGetBuiltinPromptDao = {
  findEnabled: jest.fn(),
  findByName: jest.fn(),
};

const mockGetBuiltinResourceDao = {
  findEnabled: jest.fn(),
};

const mockGetServerDao = {
  findById: jest.fn(),
};

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockGetServerDao),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn() })),
  getBuiltinPromptDao: jest.fn(() => mockGetBuiltinPromptDao),
  getBuiltinResourceDao: jest.fn(() => mockGetBuiltinResourceDao),
}));

jest.mock('../../src/config/index.js', () => ({
  expandEnvVars: jest.fn((val: string) => val),
  replaceEnvVars: jest.fn((val: any) => val),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import {
  createMcpServer,
  filterPromptsByGroup,
  filterResourceTemplatesByGroup,
  filterResourcesByGroup,
  handleGetPromptRequest,
  handleListPromptsRequest,
  handleListResourcesRequest,
} from '../../src/services/mcpService.js';

describe('mcpService handleListPromptsRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerDao.findById.mockResolvedValue(null);
    mockGetBuiltinResourceDao.findEnabled.mockResolvedValue([]);
  });

  it('should return schema-safe prompt fields for built-in prompts', async () => {
    mockGetBuiltinPromptDao.findEnabled.mockResolvedValue([
      {
        id: 'p1',
        name: 'builtin-no-optional-fields',
        template: 'hello {{x}}',
        enabled: true,
        title: undefined,
        description: undefined,
        arguments: undefined,
      },
    ]);

    const result = await handleListPromptsRequest({}, { sessionId: 's1' });

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toEqual({
      name: 'builtin-no-optional-fields',
      title: 'builtin-no-optional-fields',
      description: '',
      arguments: [],
    });
    expect(typeof result.prompts[0].title).toBe('string');
    expect(typeof result.prompts[0].description).toBe('string');
    expect(Array.isArray(result.prompts[0].arguments)).toBe(true);
  });

  it('should return schema-safe resource fields for built-in resources', async () => {
    mockGetBuiltinPromptDao.findEnabled.mockResolvedValue([]);
    mockGetBuiltinResourceDao.findEnabled.mockResolvedValue([
      {
        id: 'r1',
        uri: 'resource://docs/readme',
        content: 'hello',
        enabled: true,
        name: null,
        description: undefined,
        mimeType: null,
      },
    ]);

    const result = await handleListResourcesRequest({}, { sessionId: 's1' });

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]).toEqual({
      uri: 'resource://docs/readme',
      name: '',
      description: '',
      mimeType: '',
    });
    expect(typeof result.resources[0].name).toBe('string');
    expect(typeof result.resources[0].description).toBe('string');
    expect(typeof result.resources[0].mimeType).toBe('string');
  });

  it('should register the listResourceTemplates MCP handler', () => {
    const server = createMcpServer('test-hub', '1.0.0');

    expect((server as any)._requestHandlers.has('resources/templates/list')).toBe(true);
  });

  it('should filter prompts by group capability selection', async () => {
    const mockGetServerConfigInGroup = jest.requireMock('../../src/services/groupService.js')
      .getServerConfigInGroup as jest.Mock;
    mockGetServerConfigInGroup.mockResolvedValue({
      name: 'server-a',
      prompts: ['draft_prompt'],
    });

    const result = await filterPromptsByGroup('team-a', 'server-a', [
      { name: 'server-a::draft_prompt', description: 'allowed' },
      { name: 'server-a::review_prompt', description: 'blocked' },
    ] as any);

    expect(result).toEqual([{ name: 'server-a::draft_prompt', description: 'allowed' }]);
  });

  it('should filter resources by group capability selection', async () => {
    const mockGetServerConfigInGroup = jest.requireMock('../../src/services/groupService.js')
      .getServerConfigInGroup as jest.Mock;
    mockGetServerConfigInGroup.mockResolvedValue({
      name: 'server-a',
      resources: ['resource://docs/guide'],
    });

    const result = await filterResourcesByGroup('team-a', 'server-a', [
      { uri: 'resource://docs/guide', name: 'Guide' },
      { uri: 'resource://docs/private', name: 'Private' },
    ] as any);

    expect(result).toEqual([{ uri: 'resource://docs/guide', name: 'Guide' }]);
  });

  it('should hide resource templates when group resources are explicitly empty', async () => {
    const mockGetServerConfigInGroup = jest.requireMock('../../src/services/groupService.js')
      .getServerConfigInGroup as jest.Mock;
    mockGetServerConfigInGroup.mockResolvedValue({
      name: 'server-a',
      resources: [],
    });

    const result = await filterResourceTemplatesByGroup('team-a', 'server-a', [
      { uriTemplate: 'resource://docs/{slug}', name: 'Docs by slug' },
    ] as any);

    expect(result).toEqual([]);
  });
});

describe('mcpService handleGetPromptRequest built-in template substitution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerDao.findById.mockResolvedValue(null);
  });

  it('substitutes repeated placeholders and preserves unmatched placeholders', async () => {
    mockGetBuiltinPromptDao.findByName.mockResolvedValue({
      id: 'p1',
      name: 'greeting',
      template: 'Hello {{name}}, welcome to {{place}}. Regards, {{name}} ({{missing}}).',
      enabled: true,
    });

    const result = await handleGetPromptRequest(
      {
        params: {
          name: 'greeting',
          arguments: { name: 'Alice', place: 'MCPHub' },
        },
      },
      { sessionId: 's1' },
    );

    expect(result).toEqual({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Hello Alice, welcome to MCPHub. Regards, Alice ({{missing}}).',
          },
        },
      ],
    });
  });

  it('handles pattern-like argument names in linear time', async () => {
    const longTemplate = `${'A'.repeat(300)} {{topic}}`;
    mockGetBuiltinPromptDao.findByName.mockResolvedValue({
      id: 'p-pattern',
      name: 'pattern-key-prompt',
      template: longTemplate,
      enabled: true,
    });

    const startedAt = Date.now();
    const result = await handleGetPromptRequest(
      {
        params: {
          name: 'pattern-key-prompt',
          arguments: { '(.+)+$': 'x', topic: 'notes' },
        },
      },
      { sessionId: 's1' },
    );
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(100);
    expect(result.messages[0].content.text).toBe(`${'A'.repeat(300)} notes`);
  });

  it('does not throw SyntaxError on regex metacharacter argument names', async () => {
    mockGetBuiltinPromptDao.findByName.mockResolvedValue({
      id: 'p-meta',
      name: 'meta-prompt',
      template: 'Value: {{[}} and {{(}} and {{ok}}',
      enabled: true,
    });

    const result = await handleGetPromptRequest(
      {
        params: {
          name: 'meta-prompt',
          arguments: { '[': 'bracket', '(': 'paren', ok: 'done' },
        },
      },
      { sessionId: 's1' },
    );

    expect(result.isError).toBeUndefined();
    expect(result.messages[0].content.text).toBe('Value: bracket and paren and done');
  });

  it('substitutes replacement pattern characters literally without second-order expansion or prototype lookup', async () => {
    mockGetBuiltinPromptDao.findByName.mockResolvedValue({
      id: 'p-safe',
      name: 'safe-prompt',
      template: 'val={{a}} next={{b}} proto={{toString}} ctor={{constructor}}',
      enabled: true,
    });

    const result = await handleGetPromptRequest(
      {
        params: {
          name: 'safe-prompt',
          arguments: { a: '$& $$ $1 {{b}}', b: 'secret' },
        },
      },
      { sessionId: 's1' },
    );

    expect(result.messages[0].content.text).toBe(
      'val=$& $$ $1 {{b}} next=secret proto={{toString}} ctor={{constructor}}',
    );
  });
});
