import { jest } from '@jest/globals';
import type { IGroup, ServerInfo } from '../../src/types/index.js';

const groups: IGroup[] = [
  {
    id: 'group-a',
    name: 'team-a',
    owner: 'alice',
    servers: [{ serverId: 'server-a', name: 'notion', tools: 'all' }],
  },
  {
    id: 'group-b',
    name: 'team-b',
    owner: 'alice',
    servers: [{ serverId: 'server-b', name: 'notion', tools: 'all' }],
  },
];

const callTeamA = jest.fn();
const callTeamB = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => ({
    findByName: jest.fn(
      async (name: string) => groups.find((group) => group.name === name) ?? null,
    ),
    findById: jest.fn(async (id: string) => groups.find((group) => group.id === id) ?? null),
  })),
  getServerDao: jest.fn(() => ({
    findById: jest.fn(async () => null),
  })),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(async () => ({})) })),
  getBuiltinPromptDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
  getBuiltinResourceDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({ filterData: (data: unknown[]) => data })),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn((sessionId: string) => (sessionId === 'session-a' ? 'team-a' : 'team-b')),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({ logToolCall: jest.fn(async () => undefined) })),
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

jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({ createOAuthProvider: jest.fn() }));
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
  getNameSeparator: jest.fn(() => '-'),
  default: { mcpHubName: 'test-hub', mcpHubVersion: '1.0.0', initTimeout: 60000 },
}));

import {
  cleanupAllServers,
  handleCallToolRequest,
  handleListToolsRequest,
  setServerInfosForTest,
} from '../../src/services/mcpService.js';

const serverInfo = (id: string, callTool: jest.Mock): ServerInfo =>
  ({
    id,
    name: 'notion',
    owner: 'alice',
    status: 'connected',
    enabled: true,
    tools: [{ name: 'notion-search', description: 'Search', inputSchema: { type: 'object' } }],
    prompts: [],
    resources: [],
    client: { callTool },
    options: {},
    createTime: Date.now(),
  }) as unknown as ServerInfo;

describe('mcpService group server ids', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupAllServers();
    callTeamA.mockResolvedValue({ content: [{ type: 'text', text: 'a' }], isError: false });
    callTeamB.mockResolvedValue({ content: [{ type: 'text', text: 'b' }], isError: false });
    setServerInfosForTest([serverInfo('server-a', callTeamA), serverInfo('server-b', callTeamB)]);
  });

  afterEach(() => cleanupAllServers());

  it('lists the same clean tool name in separate groups', async () => {
    const teamA = await handleListToolsRequest({}, { sessionId: 'session-a' });
    const teamB = await handleListToolsRequest({}, { sessionId: 'session-b' });

    expect(teamA.tools.map((tool) => tool.name)).toEqual(['notion-search']);
    expect(teamB.tools.map((tool) => tool.name)).toEqual(['notion-search']);
  });

  it('routes the same tool name to the server referenced by each group', async () => {
    await handleCallToolRequest(
      { params: { name: 'notion-search', arguments: { query: 'a' } } },
      { sessionId: 'session-a' },
    );
    await handleCallToolRequest(
      { params: { name: 'notion-search', arguments: { query: 'b' } } },
      { sessionId: 'session-b' },
    );

    expect(callTeamA).toHaveBeenCalledWith(
      { name: 'search', arguments: { query: 'a' } },
      undefined,
      expect.anything(),
    );
    expect(callTeamB).toHaveBeenCalledWith(
      { name: 'search', arguments: { query: 'b' } },
      undefined,
      expect.anything(),
    );
  });
});
