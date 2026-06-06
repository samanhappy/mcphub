const mockGetSmartRoutingConfig = jest.fn(() => Promise.resolve({ progressiveDisclosure: false }));

// Mock all transitive dependencies before importing smartRoutingService
jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/utils/smartRouting.js', () => ({
  getSmartRoutingConfig: mockGetSmartRoutingConfig,
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findById: jest.fn(),
    findAll: jest.fn(() => Promise.resolve([])),
  })),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(),
}));

import {
  buildSmartRoutingMetaTools,
  getSmartRoutingMetaToolDefinitions,
  getSmartRoutingTools,
  initSmartRoutingService,
} from '../../src/services/smartRoutingService.js';

describe('buildSmartRoutingMetaTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSmartRoutingConfig.mockResolvedValue({ progressiveDisclosure: false });
    initSmartRoutingService(
      () =>
        [
          {
            name: 'weather',
            status: 'connected',
            enabled: true,
            error: null,
            instructions: 'Weather forecasts and air quality',
            config: { description: 'Custom weather inventory description' },
            tools: [],
            prompts: [],
            resources: [],
            createTime: 0,
          },
          {
            name: 'stocks',
            status: 'connected',
            enabled: true,
            error: null,
            instructions: 'Stock market data and quotes',
            tools: [],
            prompts: [],
            resources: [],
            createTime: 0,
          },
          {
            name: 'offline',
            status: 'disconnected',
            enabled: true,
            error: null,
            instructions: 'Should not appear',
            tools: [],
            prompts: [],
            resources: [],
            createTime: 0,
          },
          {
            name: 'plain',
            status: 'connected',
            enabled: true,
            error: null,
            instructions: '',
            tools: [],
            prompts: [],
            resources: [],
            createTime: 0,
          },
        ] as any,
      jest.fn(async (_serverName, tools) => tools),
      jest.fn(async (_group, _serverName, tools) => tools),
    );
  });

  it('returns 2 tools (search_tools, call_tool) in standard mode', () => {
    const tools = buildSmartRoutingMetaTools('all available servers', 'srv-a, srv-b', false);
    expect(tools.map((t) => t.name)).toEqual(['search_tools', 'call_tool']);
  });

  it('returns 3 tools (adds describe_tool) under progressive disclosure', () => {
    const tools = buildSmartRoutingMetaTools('all available servers', 'srv-a, srv-b', true);
    expect(tools.map((t) => t.name)).toEqual(['search_tools', 'describe_tool', 'call_tool']);
  });

  it('embeds the scope description and server list into search_tools', () => {
    const tools = buildSmartRoutingMetaTools('servers in the "x" group', 'srv-a', false);
    const search = tools.find((t) => t.name === 'search_tools')!;
    expect(search.description).toContain('servers in the "x" group');
    expect(search.description).toContain('srv-a');
  });

  it('uses server names only by default in computed smart routing scope', async () => {
    const tools = await getSmartRoutingMetaToolDefinitions(undefined, false);
    const search = tools.find((t) => t.name === 'search_tools')!;

    expect(search.description).toContain('Available servers: weather, stocks, plain');
    expect(search.description).not.toContain('Custom weather inventory description');
    expect(search.description).not.toContain('Stock market data and quotes');
    expect(search.description).not.toContain('offline');
  });

  it('can include server descriptions in computed smart routing scope', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({
      progressiveDisclosure: false,
      serverDescriptionMode: 'full',
    });

    const tools = await getSmartRoutingMetaToolDefinitions(undefined, false);
    const search = tools.find((t) => t.name === 'search_tools')!;

    expect(search.description).toContain('Available servers:');
    expect(search.description).toContain('\n- weather: Custom weather inventory description');
    expect(search.description).toContain('\n- stocks: Stock market data and quotes');
    expect(search.description).toContain('\n- plain');
    expect(search.description).not.toContain('Available servers: - weather');
    expect(search.description).not.toContain('offline');
  });

  it('reads smart routing config once when building smart routing tools', async () => {
    await getSmartRoutingTools(undefined);

    expect(mockGetSmartRoutingConfig).toHaveBeenCalledTimes(1);
  });
});
