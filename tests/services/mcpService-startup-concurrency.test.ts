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
  StdioClientTransport: jest.fn().mockImplementation((params: { args?: string[] }) => ({
    // Kept so a test can tell which server a connect() call belongs to.
    params,
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
  initializeClientsFromSettings,
  setServerInfosForTest,
  toggleServerStatus,
} from '../../src/services/mcpService.js';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

const servers = ['a', 'b', 'c', 'd', 'e'].map((name) => ({
  name,
  enabled: true,
  command: 'node',
  args: ['server.js'],
}));

describe('startup connect concurrency', () => {
  let releases: Array<() => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    setServerInfosForTest([]);
    mockServerDao.findAll.mockResolvedValue(servers);
    mockListTools.mockResolvedValue({ tools: [] });
    releases = [];
    mockClientConnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(() => resolve());
        }),
    );
  });

  afterEach(() => {
    delete process.env.STARTUP_CONNECT_CONCURRENCY;
  });

  it('connects every server at once when no limit is configured', async () => {
    await initializeClientsFromSettings(true);

    expect(releases).toHaveLength(servers.length);
  });

  it('opens at most the configured number of connections', async () => {
    process.env.STARTUP_CONNECT_CONCURRENCY = '2';

    await initializeClientsFromSettings(true);
    // A queued server has not called connect() yet, so it is not spending its
    // timeout budget while it waits.
    expect(releases).toHaveLength(2);

    releases[0]();
    await flush();
    expect(releases).toHaveLength(3);

    releases[1]();
    releases[2]();
    await flush();
    expect(releases).toHaveLength(5);
  });

  it('keeps the queue moving when a connection fails', async () => {
    process.env.STARTUP_CONNECT_CONCURRENCY = '1';
    const rejects: Array<(error: Error) => void> = [];
    mockClientConnect.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejects.push((error) => reject(error));
        }),
    );

    await initializeClientsFromSettings(true);
    expect(rejects).toHaveLength(1);

    rejects[0](new Error('boom'));
    await flush();
    expect(rejects).toHaveLength(2);
  });

  it('ignores a value that is not a non-negative integer', async () => {
    process.env.STARTUP_CONNECT_CONCURRENCY = 'not-a-number';

    await initializeClientsFromSettings(true);

    expect(releases).toHaveLength(servers.length);
  });
});

describe('startup connect queue invalidation', () => {
  // Each server gets its own args so a connect() call can be traced back to it
  // through the transport the client was handed.
  const queued = ['a', 'b', 'c'].map((name) => ({
    name,
    enabled: true,
    command: 'node',
    args: ['server.js', name],
  }));

  const connectedServerNames = (): Array<string | undefined> =>
    mockClientConnect.mock.calls.map((call) => call[0]?.params?.args?.[1]);

  let releases: Array<() => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    setServerInfosForTest([]);
    mockServerDao.findAll.mockResolvedValue(queued);
    mockListTools.mockResolvedValue({ tools: [] });
    releases = [];
    mockClientConnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(() => resolve());
        }),
    );
    process.env.STARTUP_CONNECT_CONCURRENCY = '1';
  });

  afterEach(() => {
    delete process.env.STARTUP_CONNECT_CONCURRENCY;
  });

  it('does not connect a server that was disabled while it waited for a slot', async () => {
    await initializeClientsFromSettings(true);
    expect(connectedServerNames()).toEqual(['a']);

    // 'b' is queued but has not started: no child process exists yet, and
    // closeServerRuntime clears the references that would later own one.
    await toggleServerStatus('b', false);

    releases[0]();
    await flush();

    expect(connectedServerNames()).not.toContain('b');
  });

  it('does not connect a queued server whose pass has been superseded', async () => {
    await initializeClientsFromSettings(true);

    // A second pass builds its own clients for every server; the ones still
    // queued from the first pass belong to transports nobody will read.
    await initializeClientsFromSettings(false);
    const connectsBeforeRelease = mockClientConnect.mock.calls.length;

    // Release the first pass's in-flight connect, freeing its queue.
    releases[0]();
    await flush();

    expect(mockClientConnect.mock.calls.length).toBe(connectsBeforeRelease);
  });

  it('still connects a queued server that a scoped reload preserved', async () => {
    await initializeClientsFromSettings(true);
    expect(connectedServerNames()).toEqual(['a']);

    // Reloading one server preserves every other server as-is, whatever its
    // status (#921), carrying the same client across into the new entry. The
    // queued connect from this pass is the one that will complete it, so
    // cancelling it would strand the server on 'connecting' for good (#1150).
    await initializeClientsFromSettings(false, 'a');

    releases[0]();
    await flush();

    expect(connectedServerNames()).toContain('b');
  });

  it('gives the slot of a cancelled server to the next server in the queue', async () => {
    await initializeClientsFromSettings(true);

    await toggleServerStatus('b', false);

    releases[0]();
    await flush();

    expect(connectedServerNames()).toEqual(['a', 'c']);
  });
});

