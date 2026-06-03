const mockGetServersInfo = jest.fn();
const mockGetAllGroups = jest.fn();
const mockNormalizeGroupServers = jest.fn();
const mockGetSmartRoutingConfig = jest.fn();
const mockGetSmartRoutingMetaToolDefinitions = jest.fn();

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: mockGetServersInfo,
}));

jest.mock('../../src/services/groupService.js', () => ({
  getAllGroups: mockGetAllGroups,
  normalizeGroupServers: mockNormalizeGroupServers,
}));

jest.mock('../../src/utils/smartRouting.js', () => ({
  getSmartRoutingConfig: mockGetSmartRoutingConfig,
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  getSmartRoutingMetaToolDefinitions: mockGetSmartRoutingMetaToolDefinitions,
}));

// getNameSeparator lives in config/index.js — mock the whole module
jest.mock('../../src/config/index.js', () => ({
  getNameSeparator: () => '-',
}));

import { serverCostFromInfo, getServerCosts, getGroupCosts } from '../../src/services/contextCostService.js';
import { countTokens, serializeToolDefinition } from '../../src/utils/tokenCost.js';
import type { ServerInfo, IGroupServerConfig } from '../../src/types/index.js';

// The real default separator (confirmed from src/config/index.ts)
const SEP = '-';

const baseInfo = (overrides: Partial<ServerInfo>): ServerInfo =>
  ({
    name: 'srv',
    status: 'connected',
    error: null,
    tools: [],
    prompts: [],
    resources: [],
    ...overrides,
  }) as ServerInfo;

describe('serverCostFromInfo', () => {
  it('reports connected=false and zero footprint for a disconnected server', async () => {
    const cost = await serverCostFromInfo(baseInfo({ status: 'disconnected' }));
    expect(cost.connected).toBe(false);
    expect(cost.exposed).toBe(0);
    expect(cost.gross).toBe(0);
    expect(cost.items).toEqual([]);
  });

  it('sums all tools into gross and only enabled tools into exposed', async () => {
    const enabledTool = { name: 'a', description: 'aa', inputSchema: { type: 'object' }, enabled: true };
    const disabledTool = { name: 'b', description: 'bb', inputSchema: { type: 'object' }, enabled: false };
    const cost = await serverCostFromInfo(baseInfo({ tools: [enabledTool, disabledTool] }));

    const costA = await countTokens(serializeToolDefinition(enabledTool));
    const costB = await countTokens(serializeToolDefinition(disabledTool));

    expect(cost.connected).toBe(true);
    expect(cost.gross).toBe(costA + costB);
    expect(cost.exposed).toBe(costA);
    expect(cost.items).toHaveLength(2);
  });

  it('includes prompts and resources in the footprint', async () => {
    const cost = await serverCostFromInfo(
      baseInfo({
        tools: [{ name: 't', description: '', inputSchema: {}, enabled: true }],
        prompts: [{ name: 'p', description: 'pp', enabled: true } as any],
        resources: [{ uri: 'file://r', name: 'r', enabled: true } as any],
      }),
    );
    expect(cost.items.map((i) => i.kind).sort()).toEqual(['prompt', 'resource', 'tool']);
    expect(cost.exposed).toBeGreaterThan(0);
  });
});

describe('getServerCosts', () => {
  afterEach(() => jest.clearAllMocks());

  it('maps each server from getServersInfo to a ServerCost', async () => {
    mockGetServersInfo.mockResolvedValue([
      { name: 's1', status: 'connected', error: null, tools: [{ name: 't', description: '', inputSchema: {}, enabled: true }], prompts: [], resources: [] },
      { name: 's2', status: 'disconnected', error: null, tools: [], prompts: [], resources: [] },
    ]);

    const costs = await getServerCosts();
    expect(costs.map((c) => c.name)).toEqual(['s1', 's2']);
    expect(costs[0].connected).toBe(true);
    expect(costs[1].connected).toBe(false);
  });
});

describe('getGroupCosts', () => {
  afterEach(() => jest.clearAllMocks());

  it('(a) direct.exposed < direct.gross when group selects a tool subset; smartRouting null when disabled', async () => {
    // Two enabled tools on server s1, prefixed with separator
    const toolA = { name: `s1${SEP}a`, description: 'tool a description', inputSchema: { type: 'object', properties: {} }, enabled: true };
    const toolB = { name: `s1${SEP}b`, description: 'tool b description', inputSchema: { type: 'object', properties: {} }, enabled: true };

    mockGetServersInfo.mockResolvedValue([
      { name: 's1', status: 'connected', error: null, tools: [toolA, toolB], prompts: [], resources: [] },
    ]);

    // Group selects only tool 'a' (short name, not prefixed)
    const memberConfig: IGroupServerConfig = { name: 's1', tools: ['a'], prompts: 'all', resources: 'all' };
    mockGetAllGroups.mockResolvedValue([
      { id: 'g1', name: 'group1', servers: [memberConfig] },
    ]);
    mockNormalizeGroupServers.mockImplementation((servers: string[] | IGroupServerConfig[]) => {
      // Return the already-normalized config as-is
      return servers.map((s: string | IGroupServerConfig) =>
        typeof s === 'string'
          ? { name: s, tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const }
          : { tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const, ...s },
      );
    });

    mockGetSmartRoutingConfig.mockResolvedValue({ enabled: false });

    const costs = await getGroupCosts();

    expect(costs).toHaveLength(1);
    expect(costs[0].id).toBe('g1');
    expect(costs[0].name).toBe('group1');
    expect(costs[0].connectedCount).toBe(1);
    expect(costs[0].totalCount).toBe(1);
    // gross = cost(toolA) + cost(toolB); exposed = cost(toolA) only
    expect(costs[0].direct.gross).toBeGreaterThan(0);
    expect(costs[0].direct.exposed).toBeGreaterThan(0);
    expect(costs[0].direct.gross).toBeGreaterThan(costs[0].direct.exposed);
    // smart routing disabled → null
    expect(costs[0].smartRouting).toBeNull();
  });

  it('(c) resource selection by URI: only selected resource contributes to exposed; both contribute to gross', async () => {
    const resA = { uri: 'file://a', name: 'Resource A', description: 'resource a' };
    const resB = { uri: 'file://b', name: 'Resource B', description: 'resource b' };

    mockGetServersInfo.mockResolvedValue([
      { name: 's1', status: 'connected', error: null, tools: [], prompts: [], resources: [resA, resB] },
    ]);

    // Group selects only resource file://a by raw URI
    const memberConfig: IGroupServerConfig = { name: 's1', tools: 'all', prompts: 'all', resources: ['file://a'] };
    mockGetAllGroups.mockResolvedValue([
      { id: 'g3', name: 'group3', servers: [memberConfig] },
    ]);
    mockNormalizeGroupServers.mockImplementation((servers: string[] | IGroupServerConfig[]) =>
      servers.map((s: string | IGroupServerConfig) =>
        typeof s === 'string'
          ? { name: s, tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const }
          : { tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const, ...s },
      ),
    );

    mockGetSmartRoutingConfig.mockResolvedValue({ enabled: false });

    const costs = await getGroupCosts();

    expect(costs).toHaveLength(1);
    expect(costs[0].id).toBe('g3');
    // gross includes both resources; exposed includes only file://a
    expect(costs[0].direct.gross).toBeGreaterThan(0);
    expect(costs[0].direct.exposed).toBeGreaterThan(0);
    expect(costs[0].direct.gross).toBeGreaterThan(costs[0].direct.exposed);
  });

  it('(d) disconnected member inflates totalCount but not exposed/gross', async () => {
    const tool = { name: 's1-t', description: 'a tool', inputSchema: { type: 'object' }, enabled: true };

    mockGetServersInfo.mockResolvedValue([
      { name: 's1', status: 'connected', error: null, tools: [tool], prompts: [], resources: [] },
      { name: 's2', status: 'disconnected', error: null, tools: [tool], prompts: [], resources: [] },
    ]);

    mockGetAllGroups.mockResolvedValue([
      {
        id: 'g4',
        name: 'group4',
        servers: [
          { name: 's1', tools: 'all', prompts: 'all', resources: 'all' },
          { name: 's2', tools: 'all', prompts: 'all', resources: 'all' },
        ],
      },
    ]);
    mockNormalizeGroupServers.mockImplementation((servers: string[] | IGroupServerConfig[]) =>
      servers.map((s: string | IGroupServerConfig) =>
        typeof s === 'string'
          ? { name: s, tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const }
          : { tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const, ...s },
      ),
    );

    mockGetSmartRoutingConfig.mockResolvedValue({ enabled: false });

    const costs = await getGroupCosts();

    expect(costs).toHaveLength(1);
    expect(costs[0].connectedCount).toBe(1);
    expect(costs[0].totalCount).toBe(2);
    // Only s1 is connected — its tool contributes; s2 contributes nothing
    expect(costs[0].direct.gross).toBeGreaterThan(0);
    expect(costs[0].direct.exposed).toBeGreaterThan(0);
  });

  it('(b) smartRouting footprint is present and progressiveDisclosure > base when smart routing enabled', async () => {
    mockGetServersInfo.mockResolvedValue([
      { name: 's1', status: 'connected', error: null, tools: [], prompts: [], resources: [] },
    ]);

    mockGetAllGroups.mockResolvedValue([
      { id: 'g2', name: 'group2', servers: [{ name: 's1', tools: 'all', prompts: 'all', resources: 'all' }] },
    ]);
    mockNormalizeGroupServers.mockImplementation((servers: string[] | IGroupServerConfig[]) =>
      servers.map((s: string | IGroupServerConfig) =>
        typeof s === 'string'
          ? { name: s, tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const }
          : { tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const, ...s },
      ),
    );

    mockGetSmartRoutingConfig.mockResolvedValue({ enabled: true });

    // PD mode returns 3 tools (more tokens); base returns 2 tools (fewer tokens)
    const baseTool = (name: string) => ({
      name,
      description: 'short desc',
      inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'query' } } },
    });
    const pdTool = (name: string) => ({
      name,
      description: 'A much longer description with lots of detail about this tool that increases token count significantly beyond the base version',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query for finding relevant tools' },
          limit: { type: 'integer', description: 'Maximum number of results' },
          threshold: { type: 'number', description: 'Similarity threshold' },
        },
        required: ['query'],
      },
    });

    mockGetSmartRoutingMetaToolDefinitions.mockImplementation(
      (_group: string | undefined, progressiveDisclosure: boolean) => {
        if (progressiveDisclosure) {
          return Promise.resolve([pdTool('search_tools'), pdTool('describe_tool'), pdTool('call_tool')]);
        }
        return Promise.resolve([baseTool('search_tools'), baseTool('call_tool')]);
      },
    );

    const costs = await getGroupCosts();

    expect(costs).toHaveLength(1);
    expect(costs[0].smartRouting).not.toBeNull();
    expect(costs[0].smartRouting!.base).toBeGreaterThan(0);
    expect(costs[0].smartRouting!.progressiveDisclosure).toBeGreaterThan(0);
    expect(costs[0].smartRouting!.progressiveDisclosure).toBeGreaterThan(costs[0].smartRouting!.base);
  });
});
