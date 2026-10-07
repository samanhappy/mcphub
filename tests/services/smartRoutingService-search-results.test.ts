import { jest } from '@jest/globals';

const mockGetGroup = jest.fn();
const mockGetServerConfigsInGroup = jest.fn();
const mockGetServersInGroup = jest.fn();
const mockSearchToolsByVector = jest.fn();
const mockFindById = jest.fn();
const mockGetSmartRoutingConfig = jest.fn();

jest.mock('../../src/services/groupService.js', () => ({
  getGroupServerExposedName: jest.fn(
    (serverConfig: any) => serverConfig.alias || serverConfig.name,
  ),
  getServerConfigsInGroup: mockGetServerConfigsInGroup,
  getServersInGroup: mockGetServersInGroup,
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: mockGetGroup,
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: mockSearchToolsByVector,
}));

jest.mock('../../src/utils/smartRouting.js', () => ({
  getSmartRoutingConfig: mockGetSmartRoutingConfig,
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findById: mockFindById,
  })),
}));

jest.mock('../../src/config/index.js', () => ({
  getNameSeparator: jest.fn(() => '::'),
}));

import {
  buildSmartRoutingMetaTools,
  getHeuristicSimilarityThreshold,
  getSmartRoutingTools,
  handleDescribeToolRequest,
  handleSearchToolsRequest,
  initSmartRoutingService,
} from '../../src/services/smartRoutingService.js';

const schema = (name: string) => ({
  type: 'object',
  properties: { [name]: { type: 'string' } },
});

const chatTools = [
  { name: 'chat::list_messages', description: 'List messages', inputSchema: schema('chatId') },
  { name: 'chat::search_chats', description: 'Search chats', inputSchema: schema('query') },
  { name: 'chat::send_message', description: 'Send a message', inputSchema: schema('text') },
];

const hit = (toolName: string, similarity: number, toolSimilarity: number) => ({
  serverName: 'chat',
  toolName,
  description: '',
  inputSchema: {},
  similarity,
  toolSimilarity,
  searchableText: toolName,
});

const search = async (query = 'read recent messages from a chat group') => {
  const result = await handleSearchToolsRequest(query, 10, 'smart-session');
  return JSON.parse(result.content[0].text);
};

describe('smartRoutingService search_tools results', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGroup.mockReturnValue('$smart/team');
    mockGetSmartRoutingConfig.mockResolvedValue({ progressiveDisclosure: false });
    mockGetServersInGroup.mockResolvedValue(['chat', 'code', 'offline']);
    mockGetServerConfigsInGroup.mockResolvedValue([
      { name: 'chat', tools: 'all' },
      { name: 'code', alias: 'git', tools: 'all' },
      { name: 'offline', tools: 'all' },
    ]);
    mockFindById.mockResolvedValue({ tools: {} });
    mockSearchToolsByVector.mockResolvedValue([
      hit('chat::list_messages', 0.62, 0.64321),
      hit('chat::search_chats', 0.5, 0.49),
      hit('chat::send_message', 0.45, 0.4449),
    ]);
    initSmartRoutingService(
      () =>
        [
          { name: 'chat', status: 'connected', enabled: true, tools: chatTools },
          { name: 'code', status: 'connected', enabled: true, tools: [] },
          { name: 'offline', status: 'disconnected', enabled: true, tools: [] },
        ] as any,
      jest.fn(async (_serverName, tools) => tools),
      jest.fn(async (_group, _serverName, tools) => tools),
    );
  });

  describe('scores', () => {
    it('reports the raw tool similarity, rounded to two decimals, in ranking order', async () => {
      const payload = await search();

      expect(payload.tools.map((tool: any) => [tool.name, tool.score])).toEqual([
        ['chat::list_messages', 0.64],
        ['chat::search_chats', 0.49],
        ['chat::send_message', 0.44],
      ]);
      expect(payload.metadata.guideline).toContain('score is the query-to-tool similarity');
    });

    it('falls back to the ranking similarity when the raw one is missing', async () => {
      const { toolSimilarity: _unused, ...legacyHit } = hit('chat::list_messages', 0.777, 0);
      mockSearchToolsByVector.mockResolvedValue([legacyHit]);

      const payload = await search();

      expect(payload.tools[0].score).toBe(0.78);
    });
  });

  describe('similarity threshold', () => {
    it('keeps the query heuristic when no threshold is configured', async () => {
      await search('fetch');
      await search('read recent messages from a chat group');

      expect(mockSearchToolsByVector.mock.calls.map((call) => call[2])).toEqual([0.2, 0.4]);
    });

    it('uses the configured threshold for every query', async () => {
      mockGetSmartRoutingConfig.mockResolvedValue({
        progressiveDisclosure: false,
        similarityThreshold: 0.55,
      });

      const payload = await search('fetch');

      expect(mockSearchToolsByVector).toHaveBeenCalledWith('fetch', 10, 0.55, ['chat', 'code']);
      expect(payload.metadata.threshold).toBe(0.55);
    });

    it('honours a configured threshold of 0', async () => {
      mockGetSmartRoutingConfig.mockResolvedValue({
        progressiveDisclosure: false,
        similarityThreshold: 0,
      });

      await search('fetch');

      expect(mockSearchToolsByVector.mock.calls[0][2]).toBe(0);
    });

    it.each([
      ['fetch', 0.2],
      ['send a message', 0.3],
      ['read recent messages from a chat group', 0.4],
      ['exact file', 0.4],
    ])('heuristic threshold for %j is %d', (query, expected) => {
      expect(getHeuristicSimilarityThreshold(query)).toBe(expected);
    });
  });

  describe('no match', () => {
    it('names the threshold and the connected servers that were searched', async () => {
      mockSearchToolsByVector.mockResolvedValue([]);

      const payload = await search();

      expect(payload.tools).toEqual([]);
      expect(payload.metadata.guideline).toContain('similarity of at least 0.4');
      expect(payload.metadata.guideline).toContain('Searched servers: chat, git.');
      expect(payload.metadata.guideline).not.toContain('offline');
      expect(payload.metadata.guideline).not.toContain('code');
      expect(payload.metadata.nextSteps).toContain('no available tool covers it');
    });

    it('says so when there is no connected server to search', async () => {
      mockGetServersInGroup.mockResolvedValue(['offline']);
      mockSearchToolsByVector.mockResolvedValue([]);

      const payload = await search();

      expect(payload.metadata.guideline).toBe(
        'No tools found: no connected server is available to search.',
      );
    });
  });

  describe('tool definition fields', () => {
    // A tool as an upstream server reports it, with every optional field set
    const richTool = {
      name: 'chat::list_messages',
      title: 'List messages',
      description: 'List messages',
      inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', ...schema('chatId') },
      outputSchema: { type: 'object', properties: { messages: { type: 'array' } } },
      annotations: { readOnlyHint: true },
      execution: { taskSupport: 'optional' },
      icons: [{ src: 'data:image/png;base64,AAAA', mimeType: 'image/png' }],
      _meta: { 'example/ui': { resourceUri: 'ui://chat/list' } },
    };

    beforeEach(() => {
      mockSearchToolsByVector.mockResolvedValue([hit('chat::list_messages', 0.62, 0.64)]);
      initSmartRoutingService(
        () => [{ name: 'chat', status: 'connected', enabled: true, tools: [richTool] }] as any,
        jest.fn(async (_serverName, tools) => tools),
        jest.fn(async (_group, _serverName, tools) => tools),
      );
    });

    const describeTool = async () => {
      const result = await handleDescribeToolRequest('chat::list_messages', 'smart-session');
      return JSON.parse(result.content[0].text).tool;
    };

    it('sends title and annotations by default, never the client-only fields', async () => {
      const expected = {
        name: 'chat::list_messages',
        title: 'List messages',
        description: 'List messages',
        inputSchema: schema('chatId'),
        annotations: { readOnlyHint: true },
        serverName: 'chat',
      };

      const payload = await search();

      expect(payload.tools).toEqual([{ ...expected, score: 0.64 }]);
      expect(await describeTool()).toEqual(expected);
    });

    it('adds the configured fields, in result order', async () => {
      mockGetSmartRoutingConfig.mockResolvedValue({
        progressiveDisclosure: false,
        toolDefinitionFields: ['outputSchema', 'icons', '_meta'],
      });

      const [tool] = (await search()).tools;

      expect(Object.keys(tool)).toEqual([
        'name',
        'description',
        'inputSchema',
        'outputSchema',
        'icons',
        '_meta',
        'serverName',
        'score',
      ]);
      expect(tool.icons).toEqual(richTool.icons);
      expect(Object.keys(await describeTool())).toEqual(Object.keys(tool).slice(0, -1));
    });

    it('sends only name, description, inputSchema and serverName for an empty list', async () => {
      mockGetSmartRoutingConfig.mockResolvedValue({
        progressiveDisclosure: false,
        toolDefinitionFields: [],
      });

      expect((await search()).tools).toEqual([
        {
          name: 'chat::list_messages',
          description: 'List messages',
          inputSchema: schema('chatId'),
          serverName: 'chat',
          score: 0.64,
        },
      ]);
    });

    it('leaves out a configured field the tool does not have', async () => {
      initSmartRoutingService(
        () => [{ name: 'chat', status: 'connected', enabled: true, tools: chatTools }] as any,
        jest.fn(async (_serverName, tools) => tools),
        jest.fn(async (_group, _serverName, tools) => tools),
      );

      const [tool] = (await search()).tools;

      expect(tool).not.toHaveProperty('title');
      expect(tool).not.toHaveProperty('annotations');
    });
  });

  describe('idle on-demand servers', () => {
    const notesTool = {
      name: 'notes::find_note',
      description: 'Find a note by title',
      inputSchema: schema('title'),
    };

    beforeEach(() => {
      mockGetServersInGroup.mockResolvedValue(['chat', 'notes', 'offline']);
      initSmartRoutingService(
        () =>
          [
            { name: 'chat', status: 'connected', enabled: true, tools: chatTools },
            // Shut down after idle: disconnected, tool list kept for the next wake-up
            {
              name: 'notes',
              status: 'disconnected',
              enabled: true,
              config: { startOnDemand: true },
              tools: [notesTool],
            },
            { name: 'offline', status: 'disconnected', enabled: true, config: {}, tools: [] },
          ] as any,
        jest.fn(async (_serverName, tools) => tools),
        jest.fn(async (_group, _serverName, tools) => tools),
      );
    });

    it('searches them, but not a disconnected server that cannot be woken', async () => {
      await search();

      expect(mockSearchToolsByVector).toHaveBeenCalledWith(
        expect.any(String),
        10,
        expect.any(Number),
        ['chat', 'notes'],
      );
    });

    it('returns a hit from the cached definition, not the stored embedding', async () => {
      mockSearchToolsByVector.mockResolvedValue([
        { ...hit('notes::find_note', 0.6, 0.6), serverName: 'notes' },
      ]);

      const payload = await search('find my note');

      expect(payload.tools).toEqual([{ ...notesTool, serverName: 'notes', score: 0.6 }]);
    });

    it('names them in the no-match message', async () => {
      mockSearchToolsByVector.mockResolvedValue([]);

      const payload = await search();

      expect(payload.metadata.guideline).toContain('Searched servers: chat, notes.');
    });

    it('describes their tools', async () => {
      const result = await handleDescribeToolRequest('notes::find_note', 'smart-session');

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text).tool).toEqual({
        ...notesTool,
        serverName: 'notes',
      });
    });
  });

  describe('fullSchemaTopN', () => {
    it('returns every definition in full when unset', async () => {
      const payload = await search();

      expect(payload.tools.every((tool: any) => tool.inputSchema)).toBe(true);
      expect(payload.metadata.guideline).not.toContain('describe_tool');
    });

    it('keeps the full definition for the first N hits only', async () => {
      mockGetSmartRoutingConfig.mockResolvedValue({
        progressiveDisclosure: false,
        fullSchemaTopN: 1,
      });

      const payload = await search();

      expect(payload.tools[0]).toEqual(
        expect.objectContaining({ name: 'chat::list_messages', inputSchema: schema('chatId') }),
      );
      expect(payload.tools.slice(1)).toEqual([
        {
          name: 'chat::search_chats',
          description: 'Search chats',
          serverName: 'chat',
          score: 0.49,
        },
        {
          name: 'chat::send_message',
          description: 'Send a message',
          serverName: 'chat',
          score: 0.44,
        },
      ]);
      expect(payload.metadata.guideline).toContain(
        'Only the first result includes the full inputSchema',
      );
      expect(payload.metadata.nextSteps).toContain('describe_tool');
    });

    it('does not mention describe_tool when every hit fits in N', async () => {
      mockGetSmartRoutingConfig.mockResolvedValue({
        progressiveDisclosure: false,
        fullSchemaTopN: 5,
      });

      const payload = await search();

      expect(payload.tools.every((tool: any) => tool.inputSchema)).toBe(true);
      expect(payload.metadata.guideline).not.toContain('describe_tool');
    });

    it('is ignored under progressive disclosure', async () => {
      mockGetSmartRoutingConfig.mockResolvedValue({
        progressiveDisclosure: true,
        fullSchemaTopN: 1,
      });

      const payload = await search();

      expect(payload.tools.some((tool: any) => tool.inputSchema)).toBe(false);
      expect(payload.metadata.guideline).not.toContain('Only the first');
    });
  });
});

describe('smartRoutingService meta-tools with fullSchemaTopN', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initSmartRoutingService(
      () => [{ name: 'chat', status: 'connected', enabled: true, tools: [] }] as any,
      jest.fn(async (_serverName, tools) => tools),
      jest.fn(async (_group, _serverName, tools) => tools),
    );
  });

  it('is unchanged when unset', () => {
    const tools = buildSmartRoutingMetaTools('all available servers', 'chat', false, undefined);

    expect(tools.map((tool) => tool.name)).toEqual(['search_tools', 'call_tool']);
    expect(tools[0].description).not.toContain('describe_tool');
  });

  it('lists describe_tool and explains which results carry a schema', () => {
    const tools = buildSmartRoutingMetaTools('all available servers', 'chat', false, 3);

    expect(tools.map((tool) => tool.name)).toEqual(['search_tools', 'describe_tool', 'call_tool']);
    expect(tools[0].description).toContain('Only the first 3 results include the full inputSchema');
    expect(tools[1].inputSchema.required).toEqual(['toolName']);
  });

  it('words N = 0 as no schemas at all', () => {
    const tools = buildSmartRoutingMetaTools('all available servers', 'chat', false, 0);

    expect(tools[0].description).toContain('Results do not include the inputSchema');
  });

  it('does not change the progressive disclosure tools', () => {
    expect(buildSmartRoutingMetaTools('all available servers', 'chat', true, 3)).toEqual(
      buildSmartRoutingMetaTools('all available servers', 'chat', true),
    );
  });

  it('reads the setting when listing the smart routing tools', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({
      progressiveDisclosure: false,
      fullSchemaTopN: 2,
    });

    const { tools } = await getSmartRoutingTools('$smart');

    expect(tools.map((tool) => tool.name)).toEqual(['search_tools', 'describe_tool', 'call_tool']);
  });
});
