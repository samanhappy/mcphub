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
    getServerCapabilities: jest.fn(() => ({})),
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

describe('initializeClientsFromSettings transport failures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setServerInfosForTest([]);
    mockClientConnect.mockResolvedValue(undefined);
  });

  it('isolates a server whose transport cannot be created', async () => {
    // 'bad' has an unparseable URL, which assertSafeUrl rejects with
    // UnsafeUrlError while creating the transport.
    mockServerDao.findAll.mockResolvedValue([
      { name: 'bad', enabled: true, type: 'streamable-http', url: 'dd' },
      { name: 'good', enabled: true, command: 'node', args: ['server.js'] },
    ]);

    await expect(initializeClientsFromSettings(true)).resolves.toBeDefined();

    // The broken server is reported as failed...
    const bad = getServerByName('bad');
    expect(bad?.status).toBe('disconnected');
    expect(bad?.error).toMatch(/Failed to create transport/);

    // ...and every other server is still present rather than vanishing.
    expect(getServerByName('good')).toBeDefined();
  });
});
