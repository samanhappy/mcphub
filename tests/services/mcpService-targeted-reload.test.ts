// Regression coverage for issue #921: reloading a single server must not
// reconnect other enabled-but-not-connected (e.g. failed/disconnected) servers
// as a side effect.

const mockClientConnect = jest.fn().mockResolvedValue(undefined);
const mockClientClose = jest.fn();
const mockListTools = jest.fn().mockResolvedValue({ tools: [] });
const mockGetServerCapabilities = jest.fn(() => ({ tools: {} }));

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    close: mockClientClose,
    getServerCapabilities: mockGetServerCapabilities,
    getServerVersion: jest.fn(() => ({ version: '1.0.0' })),
    getInstructions: jest.fn(),
    listTools: mockListTools,
    listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
    listResources: jest.fn().mockResolvedValue({ resources: [] }),
  })),
}));

class MockStreamableHTTPClientTransport {
  url: URL;
  close = jest.fn();
  constructor(url: URL) {
    this.url = url;
  }
}

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn(),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  registerOAuthClient: jest.fn(),
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
  removeServerToolEmbeddings: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(() => jest.fn()),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

const allServers = [
  {
    name: 'target',
    type: 'streamable-http',
    url: 'https://example.com/target/mcp',
    enabled: true,
    owner: 'admin',
    visibility: 'public',
  },
  {
    name: 'other-failed-1',
    type: 'streamable-http',
    url: 'https://example.com/other1/mcp',
    enabled: true,
    owner: 'admin',
    visibility: 'public',
  },
  {
    name: 'other-failed-2',
    type: 'streamable-http',
    url: 'https://example.com/other2/mcp',
    enabled: true,
    owner: 'admin',
    visibility: 'public',
  },
];

const mockServerDao = {
  findAll: jest.fn(async () => allServers),
  findById: jest.fn(async (name: string) => allServers.find((s) => s.name === name)),
};

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(async () => ({})),
  })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
  getBuiltinResourceDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
  getUserDao: jest.fn(() => ({
    findByUsername: jest.fn(async () => ({ isAdmin: false })),
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
  reconnectServer,
  setServerInfosForTest,
  getServerByName,
} from '../../src/services/mcpService.js';
import type { ServerInfo } from '../../src/types/index.js';

const makeDisconnectedServerInfo = (name: string): ServerInfo =>
  ({
    name,
    status: 'disconnected',
    error: 'previous failure',
    tools: [],
    prompts: [],
    resources: [],
    enabled: true,
    createTime: Date.now(),
    client: { close: jest.fn() },
    transport: { close: jest.fn() },
  }) as unknown as ServerInfo;

describe('targeted reload does not reconnect other servers (issue #921)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reconnects only the target server and leaves disconnected peers untouched', async () => {
    const target = makeDisconnectedServerInfo('target');
    const other1 = makeDisconnectedServerInfo('other-failed-1');
    const other2 = makeDisconnectedServerInfo('other-failed-2');
    setServerInfosForTest([target, other1, other2]);

    await reconnectServer('target');

    // Only the target server should have spawned a new client / attempted
    // a fresh connection. The two unrelated disconnected servers must NOT be
    // reconnected as a side effect.
    expect(mockClientConnect).toHaveBeenCalledTimes(1);

    // The pre-existing clients/transports of the untouched peers must not be
    // closed by a collateral reconnect (which would orphan them — see #920).
    expect((other1.client as any).close).not.toHaveBeenCalled();
    expect((other1.transport as any).close).not.toHaveBeenCalled();
    expect((other2.client as any).close).not.toHaveBeenCalled();
    expect((other2.transport as any).close).not.toHaveBeenCalled();

    // The target itself is reconnected (its own state is replaced).
    expect(getServerByName('other-failed-1')?.status).toBe('disconnected');
    expect(getServerByName('other-failed-2')?.status).toBe('disconnected');
  });
});
