// Mock dependencies before importing mcpService
const mockRemoveServerToolEmbeddings = jest.fn().mockResolvedValue(undefined);
const mockSaveToolsAsVectorEmbeddings = jest.fn().mockResolvedValue(undefined);
const mockClientConnect = jest.fn().mockResolvedValue(undefined);
const mockClientClose = jest.fn();
const mockListTools = jest.fn().mockResolvedValue({ tools: [] });
const mockStderrListeners = new Map<string, (data?: Buffer) => void>();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    close: mockClientClose,
    getServerCapabilities: jest.fn(() => ({ tools: {} })),
    listTools: mockListTools,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
    stderr: {
      on: jest.fn((event: string, listener: (data?: Buffer) => void) => {
        mockStderrListeners.set(event, listener);
      }),
    },
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

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(),
}));

const mockServerDao = {
  findById: jest.fn(),
  findAll: jest.fn(() => Promise.resolve([] as any[])),
  setEnabled: jest.fn().mockResolvedValue(true),
};

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
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
  saveToolsAsVectorEmbeddings: mockSaveToolsAsVectorEmbeddings,
  removeServerToolEmbeddings: mockRemoveServerToolEmbeddings,
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
  initializeClientsFromSettings,
  setServerInfosForTest,
} from '../../src/services/mcpService.js';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

describe('initializeClientsFromSettings re-entrancy', () => {
  const serverConfig = { name: 'alpha', enabled: true, command: 'node', args: ['server.js'] };

  beforeEach(() => {
    jest.clearAllMocks();
    setServerInfosForTest([]);
    mockServerDao.findAll.mockResolvedValue([serverConfig]);
    mockListTools.mockResolvedValue({ tools: [{ name: 'tool-a' }] });
  });

  it('discards a superseded connect and lets the newer one own the state', async () => {
    // Every connect() stays pending until we release it explicitly.
    const releases: Array<() => void> = [];
    mockClientConnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(() => resolve());
        }),
    );

    // Run 1: returns as soon as the loop finishes; the connect is still in flight.
    await initializeClientsFromSettings(true);
    expect(getServerByName('alpha')?.status).toBe('connecting');
    expect(releases).toHaveLength(1);

    // Run 2: a second full init (no serverName) while run 1's connect is pending.
    // The reuse guard only preserves servers already in 'connected', so 'alpha'
    // is rebuilt with a new client and a second connect is started.
    await initializeClientsFromSettings(false);
    expect(releases).toHaveLength(2);

    // Run 1's connect now succeeds, after it has been superseded.
    releases[0]();
    await flush();

    // Its result must not be applied to the live entry, and its client must be
    // shut down rather than leaking a stdio child process.
    expect(mockClientClose).toHaveBeenCalled();
    expect(getServerByName('alpha')?.status).toBe('connecting');

    // The newer connection owns the state.
    releases[1]();
    await flush();

    const live = getServerByName('alpha');
    expect(live?.status).toBe('connected');
    expect(live?.tools).toHaveLength(1);
  });
});

describe('initializeClientsFromSettings scoped reload', () => {
  const servers = [
    { name: 'alpha', enabled: true, command: 'node', args: ['server.js'] },
    { name: 'beta', enabled: true, command: 'node', args: ['server.js'] },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    setServerInfosForTest([]);
    mockServerDao.findAll.mockResolvedValue(servers);
    mockListTools.mockResolvedValue({ tools: [{ name: 'tool-a' }] });
  });

  it('does not orphan an unrelated server that is still connecting', async () => {
    const releases: Array<() => void> = [];
    mockClientConnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(() => resolve());
        }),
    );

    // Startup: both servers begin connecting.
    await initializeClientsFromSettings(true);
    expect(releases).toHaveLength(2);
    expect(getServerByName('alpha')?.status).toBe('connecting');

    // A scoped reload of 'beta' only - e.g. enabling it from the dashboard.
    // 'alpha' is "preserved" by the reuse guard, but preservation shallow-copies
    // it into a new object, so the in-flight connect's closure now holds a
    // reference that is no longer in serverInfos.
    await initializeClientsFromSettings(false, 'beta');

    // alpha's original connect completes successfully.
    releases[0]();
    await flush();

    const alpha = getServerByName('alpha');
    expect(alpha?.status).toBe('connected');
    expect(alpha?.tools).toHaveLength(1);
  });
});
