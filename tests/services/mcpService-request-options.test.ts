const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  getServerCapabilities: jest.fn(() => ({ tools: {} })),
  listTools: jest.fn().mockResolvedValue({ tools: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn(),
  })),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

const mockFindAll = jest.fn();
const mockFindById = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findAll: mockFindAll,
    findById: mockFindById,
  })),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(async () => ({})),
  })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
  getBuiltinResourceDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
}));

jest.mock('../../src/config/index.js', () => ({
  expandEnvVars: jest.fn((value: string) => value),
  replaceEnvVars: jest.fn((value: any) => value),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import {
  cleanupAllServers,
  getServerByName,
  initUpstreamServers,
  reconnectServer,
} from '../../src/services/mcpService.js';
import { setupClientKeepAlive } from '../../src/services/keepAliveService.js';

const originalDefaultRequestTimeout = process.env.DEFAULT_REQUEST_TIMEOUT;

describe('mcpService request options defaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupAllServers();
    delete process.env.DEFAULT_REQUEST_TIMEOUT;
    mockFindById.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanupAllServers();
    if (originalDefaultRequestTimeout === undefined) {
      delete process.env.DEFAULT_REQUEST_TIMEOUT;
    } else {
      process.env.DEFAULT_REQUEST_TIMEOUT = originalDefaultRequestTimeout;
    }
  });

  it('enables resetTimeoutOnProgress by default for stdio servers', async () => {
    mockFindAll.mockResolvedValue([
      {
        name: 'slow-stdio',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
      },
    ]);

    await initUpstreamServers();

    expect(getServerByName('slow-stdio')?.options).toEqual({
      timeout: 60000,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: undefined,
    });
    expect(mockClient.connect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        timeout: 60000,
        resetTimeoutOnProgress: true,
      }),
    );
    expect(mockClient.listTools).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        timeout: 60000,
        resetTimeoutOnProgress: true,
      }),
    );
  });

  it('preserves an explicit resetTimeoutOnProgress=false override', async () => {
    mockFindAll.mockResolvedValue([
      {
        name: 'strict-stdio',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
        options: {
          timeout: 15000,
          resetTimeoutOnProgress: false,
        },
      },
    ]);

    await initUpstreamServers();

    expect(getServerByName('strict-stdio')?.options).toEqual({
      timeout: 15000,
      resetTimeoutOnProgress: false,
      maxTotalTimeout: undefined,
    });
  });

  it('uses DEFAULT_REQUEST_TIMEOUT when server timeout is not configured', async () => {
    process.env.DEFAULT_REQUEST_TIMEOUT = '120000';

    mockFindAll.mockResolvedValue([
      {
        name: 'env-timeout-stdio',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
      },
    ]);

    await initUpstreamServers();

    expect(getServerByName('env-timeout-stdio')?.options).toEqual({
      timeout: 120000,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: undefined,
    });
    mockClient.connect.mockClear();
    mockClient.listTools.mockClear();
    mockFindById.mockResolvedValue({
      name: 'env-timeout-stdio',
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      enabled: true,
    });

    await reconnectServer('env-timeout-stdio');

    expect(mockClient.connect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        timeout: 120000,
        resetTimeoutOnProgress: true,
      }),
    );
    expect(mockClient.listTools).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        timeout: 120000,
        resetTimeoutOnProgress: true,
      }),
    );
  });

  it('sets up keep-alive reconnect checks after a remote startup connection failure', async () => {
    mockClient.connect.mockRejectedValueOnce(new Error('connect timeout'));
    mockFindAll.mockResolvedValue([
      {
        name: 'flaky-http',
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        enabled: true,
        enableKeepAlive: true,
      },
    ]);

    await initUpstreamServers();
    await Promise.resolve();
    await Promise.resolve();

    const serverInfo = getServerByName('flaky-http');
    expect(serverInfo?.status).toBe('disconnected');
    expect(setupClientKeepAlive).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'flaky-http',
        status: 'disconnected',
      }),
      expect.objectContaining({
        name: 'flaky-http',
        enableKeepAlive: true,
      }),
      expect.objectContaining({
        reconnectServer: expect.any(Function),
      }),
    );
  });

  it('re-registers keep-alive when an automatic reconnect attempt fails', async () => {
    mockFindAll.mockResolvedValue([
      {
        name: 'flaky-http',
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        enabled: true,
        enableKeepAlive: true,
      },
    ]);
    mockFindById.mockResolvedValue({
      name: 'flaky-http',
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enabled: true,
      enableKeepAlive: true,
    });

    await initUpstreamServers();
    await Promise.resolve();
    await Promise.resolve();

    const reconnectOptions = (setupClientKeepAlive as jest.Mock).mock.calls[0][2];
    mockFindAll.mockRejectedValueOnce(new Error('settings unavailable'));

    await expect(reconnectOptions.reconnectServer('flaky-http')).rejects.toThrow(
      'settings unavailable',
    );

    expect(setupClientKeepAlive).toHaveBeenCalledTimes(2);
    expect(setupClientKeepAlive).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'flaky-http',
      }),
      expect.objectContaining({
        name: 'flaky-http',
        enableKeepAlive: true,
      }),
      expect.objectContaining({
        reconnectServer: expect.any(Function),
      }),
    );
  });
});
