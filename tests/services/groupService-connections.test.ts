// Mock dependencies before importing mcpService
const mockClientConnect = jest.fn().mockResolvedValue(undefined);

jest.mock('@modelcontextprotocol/client', () => ({
  ...jest.requireActual('@modelcontextprotocol/client'),
  Client: jest.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    close: jest.fn(),
    getServerCapabilities: jest.fn(() => ({ tools: {} })),
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
  })),
}));

jest.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
    stderr: { on: jest.fn() },
  })),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  registerOAuthClient: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(),
}));

let mockGroup = { id: 'g1', name: 'team', owner: 'admin', servers: ['alpha'] as any[] };
const mockGroupDao = {
  findById: jest.fn(async () => mockGroup),
  findByName: jest.fn(async () => mockGroup),
  update: jest.fn(async (_id: string, changes: any) => (mockGroup = { ...mockGroup, ...changes })),
};
jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({ getCurrentUser: () => ({ username: 'admin', isAdmin: true }) })),
  },
}));

const mockServerDao = {
  findById: jest.fn(),
  findAll: jest.fn(() => Promise.resolve([] as any[])),
};

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getGroupDao: jest.fn(() => mockGroupDao),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(),
  })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(),
  getSmartRoutingTools: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn().mockResolvedValue(undefined),
  removeServerToolEmbeddings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/config/index.js', () => ({
  loadSettings: jest.fn(),
  expandEnvVars: jest.fn((val: string) => val),
  replaceEnvVars: jest.fn((val: any) => val),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
  },
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logActivity: jest.fn(),
  })),
}));

import {
  getServerByName,
  getFilteredServerInfosForGroup,
  initializeClientsFromSettings,
  setServerInfosForTest,
} from '../../src/services/mcpService.js';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

import {
  addServerToGroup,
  removeServerFromGroup,
  updateGroup,
  updateGroupServers,
  updateServerToolsInGroup,
} from '../../src/services/groupService.js';

describe('group mutations preserve upstream connections (#1426)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    setServerInfosForTest([]);
    mockGroup = { id: 'g1', name: 'team', owner: 'admin', servers: ['alpha'] };
    mockServerDao.findById.mockResolvedValue({ name: 'alpha' });
    mockServerDao.findAll.mockResolvedValue([
      { name: 'alpha', enabled: true, command: 'node', args: ['server.js'] },
    ]);
    // Model an upstream that never finishes initialization, without starting a child process.
    mockClientConnect.mockImplementation(() => new Promise<void>(() => {}));
    await initializeClientsFromSettings(true);
    await flush();
    expect(mockClientConnect).toHaveBeenCalledTimes(1);
  });

  afterEach(() => setServerInfosForTest([]));

  it.each([
    ['metadata', () => updateGroup('g1', { description: 'updated' })],
    ['replacement', () => updateGroupServers('g1', [])],
    [
      'addition',
      async () => {
        mockGroup.servers = [];
        return addServerToGroup('g1', 'alpha');
      },
    ],
    ['duplicate addition', () => addServerToGroup('g1', 'alpha')],
    ['removal', () => removeServerFromGroup('g1', 'alpha')],
    ['tool selection', () => updateServerToolsInGroup('g1', 'alpha', [])],
  ])('does not restart a connecting upstream after %s', async (_name, mutate) => {
    const upstream = getServerByName('alpha');
    await expect(mutate()).resolves.not.toBeNull();
    await flush();
    expect(mockClientConnect).toHaveBeenCalledTimes(1);
    expect(getServerByName('alpha')).toBe(upstream);
  });

  it('uses the latest membership and capability selections without reconnecting', async () => {
    const selection = {
      name: 'alpha',
      tools: ['search'],
      prompts: ['draft'],
      resources: ['resource://guide'],
    };
    await updateGroupServers('g1', [selection]);
    let result = await getFilteredServerInfosForGroup('team');
    expect(result.filteredServerInfos.map((server) => server.name)).toEqual(['alpha']);
    expect(result.serverConfigsByName.get('alpha')).toEqual(selection);
    await removeServerFromGroup('g1', 'alpha');
    result = await getFilteredServerInfosForGroup('team');
    expect(result.filteredServerInfos).toEqual([]);
    expect(mockClientConnect).toHaveBeenCalledTimes(1);
  });
});
