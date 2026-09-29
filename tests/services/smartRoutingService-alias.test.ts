import { RequestContextService } from '../../src/services/requestContextService.js';
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
  handleDescribeToolRequest,
  handleSearchToolsRequest,
  initSmartRoutingService,
} from '../../src/services/smartRoutingService.js';

const fetchTool = {
  name: 'u17__fetch::fetch_url',
  description: 'Fetch a URL',
  inputSchema: { type: 'object' },
};

describe('smartRoutingService group server alias', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGroup.mockReturnValue('$smart/team-a');
    mockGetSmartRoutingConfig.mockResolvedValue({ progressiveDisclosure: false });
    mockGetServersInGroup.mockResolvedValue(['u17__fetch']);
    mockGetServerConfigsInGroup.mockResolvedValue([
      {
        name: 'u17__fetch',
        alias: 'fetch',
        tools: 'all',
        prompts: 'all',
        resources: 'all',
      },
    ]);
    mockFindById.mockResolvedValue({ name: 'u17__fetch', tools: {} });
    mockSearchToolsByVector.mockResolvedValue([
      {
        serverName: 'u17__fetch',
        toolName: 'u17__fetch::fetch_url',
        description: 'Fetch a URL',
        inputSchema: { type: 'object' },
        similarity: 0.95,
        searchableText: 'fetch',
      },
    ]);
    initSmartRoutingService(
      () =>
        [
          {
            name: 'u17__fetch',
            status: 'connected',
            enabled: true,
            tools: [fetchTool],
            prompts: [],
            resources: [],
          },
        ] as any,
      jest.fn(async (_serverName, tools) => tools),
      jest.fn(async (_group, _serverName, tools) => tools),
    );
  });

  it('returns aliased tool names and server names for smart group search results', async () => {
    const result = await handleSearchToolsRequest('fetch', 10, 'smart-session');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.tools).toEqual([
      expect.objectContaining({
        name: 'fetch::fetch_url',
        serverName: 'fetch',
      }),
    ]);
    expect(payload.tools[0].name).not.toContain('u17__fetch');
    expect(payload.tools[0].serverName).not.toContain('u17__fetch');
  });

  it('describes aliased tool names for smart groups without exposing internal server names', async () => {
    const result = await handleDescribeToolRequest('fetch::fetch_url', 'smart-session');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.tool).toEqual(
      expect.objectContaining({
        name: 'fetch::fetch_url',
        serverName: 'fetch',
      }),
    );
  });

  it('does not search embeddings when the current user has no visible servers', async () => {
    initSmartRoutingService(
      () => [],
      jest.fn(async (_serverName, tools) => tools),
      jest.fn(async (_group, _serverName, tools) => tools),
    );

    const result = await handleSearchToolsRequest('fetch', 10, 'smart-session');
    const payload = JSON.parse(result.content[0].text);

    expect(mockSearchToolsByVector).not.toHaveBeenCalled();
    expect(payload.tools).toEqual([]);
  });
  it('uses request context for sessionless search and describe', async () => {
    mockGetGroup.mockReturnValue('$smart/wrong-group');
    await RequestContextService.getInstance().runWithCustomRequestContext(
      { headers: {}, group: '$smart/team-a' },
      async () => {
        const search = await handleSearchToolsRequest('fetch', 10, '');
        expect(JSON.parse(search.content[0].text).tools[0].name).toBe('fetch::fetch_url');
        await handleDescribeToolRequest('fetch::fetch_url', '');
        expect(mockGetServerConfigsInGroup).toHaveBeenCalledWith('team-a');
        expect(mockGetServerConfigsInGroup).not.toHaveBeenCalledWith('wrong-group');
        expect(mockGetGroup).not.toHaveBeenCalled();
      },
    );
  });
});
