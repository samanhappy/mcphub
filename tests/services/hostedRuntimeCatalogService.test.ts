const mockGetNameSeparator = jest.fn(() => '-');
const mockGetServersInfo = jest.fn();
const mockGetHostedNodeIdentity = jest.fn(() => ({
  clusterId: 'prod-us',
  nodeId: 'hub-1',
}));

jest.mock('../../src/config/index.js', () => ({
  getNameSeparator: mockGetNameSeparator,
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: mockGetServersInfo,
}));

jest.mock('../../src/services/hostedNodeIdentity.js', () => ({
  getHostedNodeIdentity: mockGetHostedNodeIdentity,
}));

import { stripRuntimeToolName } from '../../src/services/hostedRuntimeCatalogNames.js';
import { getHostedRuntimeCatalog } from '../../src/services/hostedRuntimeCatalogService.js';

describe('hostedRuntimeCatalogService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNameSeparator.mockReturnValue('-');
    mockGetHostedNodeIdentity.mockReturnValue({
      clusterId: 'prod-us',
      nodeId: 'hub-1',
    });
    mockGetServersInfo.mockResolvedValue([]);
  });

  it('strips the configured server prefix from runtime tool names', () => {
    expect(stripRuntimeToolName('time', 'time-current_time', '-')).toBe('current_time');
    expect(stripRuntimeToolName('brave-search', 'brave-search-web_search', '-')).toBe(
      'web_search',
    );
  });

  it('leaves non-prefixed tool names unchanged', () => {
    expect(stripRuntimeToolName('time', 'current_time', '-')).toBe('current_time');
  });

  it('maps runtime servers and tools into a sanitized hosted catalog', async () => {
    mockGetServersInfo.mockResolvedValue([
      {
        name: 'time',
        version: '1.2.3',
        instructions: 'Use timezone names.',
        status: 'connected',
        enabled: true,
        error: null,
        tools: [
          {
            name: 'time-current_time',
            description: 'Get current time',
            inputSchema: { type: 'object', properties: { timezone: { type: 'string' } } },
            enabled: true,
          },
          {
            name: 'time-disabled_tool',
            description: '',
            inputSchema: {},
            enabled: false,
          },
          {
            name: 'time-poll_dashboard',
            description: 'Refresh an MCP App',
            inputSchema: {},
            enabled: true,
            _meta: { ui: { visibility: ['app'] } },
          },
        ],
        prompts: [],
        resources: [],
        createTime: 1,
        config: { description: 'Runtime time server' },
      },
    ]);

    const catalog = await getHostedRuntimeCatalog();

    expect(catalog).toEqual({
      clusterId: 'prod-us',
      nodeId: 'hub-1',
      nameSeparator: '-',
      servers: [
        {
          slug: 'time',
          status: 'connected',
          enabled: true,
          description: 'Runtime time server',
          version: '1.2.3',
          instructions: 'Use timezone names.',
          error: null,
          tools: [
            {
              name: 'current_time',
              publicName: 'time-current_time',
              description: 'Get current time',
              inputSchema: { type: 'object', properties: { timezone: { type: 'string' } } },
              enabled: true,
            },
            {
              name: 'disabled_tool',
              publicName: 'time-disabled_tool',
              description: '',
              inputSchema: {},
              enabled: false,
            },
          ],
        },
      ],
    });
  });

  it('defaults cluster id and empty optional fields safely', async () => {
    mockGetHostedNodeIdentity.mockReturnValue({ nodeId: 'hub-local' });
    mockGetServersInfo.mockResolvedValue([
      {
        name: 'fetch',
        status: 'connecting',
        error: 'booting',
        tools: [
          {
            name: 'fetch-fetch_url',
          },
        ],
        prompts: [],
        resources: [],
        createTime: 1,
      },
    ]);

    const catalog = await getHostedRuntimeCatalog();

    expect(catalog.clusterId).toBe('default');
    expect(catalog.nodeId).toBe('hub-local');
    expect(catalog.servers[0]).toMatchObject({
      slug: 'fetch',
      enabled: true,
      description: '',
      error: 'booting',
      tools: [
        {
          name: 'fetch_url',
          publicName: 'fetch-fetch_url',
          description: '',
          inputSchema: {},
          enabled: true,
        },
      ],
    });
  });
});
