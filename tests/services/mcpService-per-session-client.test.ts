/// <reference types="jest" />

// Tracks every upstream Client the SUT constructs via `new Client(...)`, so tests
// can assert how many isolated clients were created and inspect/close them.
const mockCreatedClients: any[] = [];
const makeOkResult = () => ({
  content: [{ type: 'text', text: 'ok' }],
  isError: false,
});

jest.mock('@modelcontextprotocol/client', () => ({
  ...jest.requireActual('@modelcontextprotocol/client'),
  Client: jest.fn().mockImplementation(() => {
    const client = {
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
      getServerCapabilities: jest.fn(() => ({ tools: {} })),
      getServerVersion: jest.fn(() => ({ version: '1.0.0' })),
      getInstructions: jest.fn(() => undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      callTool: jest.fn().mockResolvedValue(makeOkResult()),
    };
    mockCreatedClients.push(client);
    return client;
  }),
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
  SSEClientTransport: MockSSEClientTransport,
}));

const mockCreatedTransports: any[] = [];

class MockStreamableHTTPClientTransport {
  close = jest.fn();
  constructor(
    public url: URL,
    public options?: any,
  ) {
    mockCreatedTransports.push(this);
  }
}

class MockSSEClientTransport {
  close = jest.fn();
  constructor(
    public url: URL,
    public options?: any,
  ) {
    mockCreatedTransports.push(this);
  }
}

class MockStdioClientTransport {
  close = jest.fn();
  // Expose a fake stdio child pid via the SDK's public `pid` getter so cleanup
  // exercises the process-tree path.
  pid = 4242;
  stderr = { on: jest.fn() };
  constructor(public options?: any) {
    mockCreatedTransports.push(this);
  }
}

jest.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: MockStdioClientTransport,
}));

// Kill the process tree without touching real processes.
const mockTreeKill = jest.fn((_pid: number, _signal: string, cb?: (err?: Error) => void) => {
  if (cb) cb();
});
jest.mock('tree-kill', () => mockTreeKill);

// SSRF guard is real in production; mock it here so tests stay hermetic (no DNS).
jest.mock('../../src/utils/ssrf.js', () => ({
  assertSafeUrl: jest.fn().mockResolvedValue(undefined),
  createRedirectValidatingFetch: jest.fn((fetchImpl: any) => fetchImpl),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
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
    logToolCall: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(() => jest.fn()),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

const mockServerDao = {
  findAll: jest.fn(async () => []),
  findById: jest.fn(async () => ({
    name: 'iso-server',
    type: 'streamable-http',
    url: 'https://example.com/mcp',
    enabled: true,
    perSessionClient: true,
  })),
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
    findByUsername: jest.fn(async () => null),
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

import * as mcpService from '../../src/services/mcpService.js';

// The SIGKILL fallback probes liveness with process.kill(pid, 0). Force it to
// report "dead" (ESRCH) for our fake pid so the 2s SIGKILL timer never fires.
const originalProcessKill = process.kill.bind(process);
const installProcessKillMock = (): void => {
  jest.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    if (pid === 4242 && (signal === 0 || signal === undefined)) {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    }
    return originalProcessKill(pid, signal as any);
  }) as any);
};

type IsolatedConfig = Record<string, unknown>;

const makeServerInfo = (config: IsolatedConfig) => {
  // The shared client must never be used for a perSessionClient server; give it a
  // spy so tests can assert isolation.
  const sharedClient = {
    callTool: jest.fn().mockResolvedValue(makeOkResult()),
    close: jest.fn(),
  };

  return {
    name: 'iso-server',
    status: 'connected',
    enabled: true,
    tools: [{ name: 'iso-server::do_thing' }],
    client: sharedClient,
    transport: new MockStreamableHTTPClientTransport(new URL('https://example.com/mcp')),
    options: {},
    config: {
      name: 'iso-server',
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enabled: true,
      ...config,
    },
    sharedClient,
  } as any;
};

const callTool = (sessionId: string) =>
  mcpService.handleCallToolRequest(
    {
      params: {
        name: 'call_tool',
        arguments: {
          toolName: 'iso-server::do_thing',
          arguments: {},
        },
      },
    },
    { sessionId, server: 'iso-server' },
  );

describe('mcpService per-session client isolation (perSessionClient)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreatedClients.length = 0;
    mockCreatedTransports.length = 0;
    installProcessKillMock();
    mcpService.cleanupAllServers();
  });

  afterEach(() => {
    mcpService.cleanupAllServers();
    // closeServer/killStdioProcessTree schedule a 2s SIGKILL fallback timer.
    // Flush it so it does not keep the event loop alive between tests, then
    // restore the process.kill spy.
    jest.useFakeTimers();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('creates one dedicated upstream client per session and reuses it within a session', async () => {
    const serverInfo = makeServerInfo({ perSessionClient: true });
    mcpService.setServerInfosForTest([serverInfo]);

    // First call for session-A: this is the *first* isolated client creation,
    // which must succeed (previously it wrongly threw "session no longer exists").
    const first = await callTool('session-A');
    expect(first.isError).toBe(false);
    expect(mockCreatedClients).toHaveLength(1);

    // Second call for session-A reuses the same isolated client — no new client.
    await callTool('session-A');
    expect(mockCreatedClients).toHaveLength(1);
    expect(mockCreatedClients[0].callTool).toHaveBeenCalledTimes(2);

    // A different session gets its own dedicated client.
    await callTool('session-B');
    expect(mockCreatedClients).toHaveLength(2);
    expect(mockCreatedClients[1].callTool).toHaveBeenCalledTimes(1);

    // The shared serverInfo client is never used for an isolated server.
    expect(serverInfo.sharedClient.callTool).not.toHaveBeenCalled();
  });

  it('falls back to the shared client when perSessionClient is not set', async () => {
    const serverInfo = makeServerInfo({ perSessionClient: false });
    mcpService.setServerInfosForTest([serverInfo]);

    await callTool('session-A');

    // No isolated client created; the shared client handled the call.
    expect(mockCreatedClients).toHaveLength(0);
    expect(serverInfo.sharedClient.callTool).toHaveBeenCalledTimes(1);
  });

  it('closes the isolated client and transport when the session is deleted', async () => {
    const serverInfo = makeServerInfo({ perSessionClient: true });
    mcpService.setServerInfosForTest([serverInfo]);

    await callTool('session-A');
    const isolatedClient = mockCreatedClients[0];
    const isolatedTransport = mockCreatedTransports.find(
      (t) => t instanceof MockStreamableHTTPClientTransport && t !== serverInfo.transport,
    );

    mcpService.deleteMcpServer('session-A');

    expect(isolatedClient.close).toHaveBeenCalledTimes(1);
    expect(isolatedTransport.close).toHaveBeenCalledTimes(1);

    // A subsequent call for the same session creates a fresh isolated client.
    await callTool('session-A');
    expect(mockCreatedClients).toHaveLength(2);
  });

  it('kills the stdio process tree for isolated stdio servers on cleanup', async () => {
    const serverInfo = makeServerInfo({
      type: 'stdio',
      url: undefined,
      command: 'npx',
      args: ['-y', 'some-stateful-server'],
      perSessionClient: true,
    });
    mcpService.setServerInfosForTest([serverInfo]);

    await callTool('session-A');
    const stdioTransport = mockCreatedTransports.find((t) => t instanceof MockStdioClientTransport);
    expect(stdioTransport).toBeDefined();

    mcpService.deleteMcpServer('session-A');

    // The process-tree helper (tree-kill) must be used, not a bare SIGTERM.
    expect(mockTreeKill).toHaveBeenCalledWith(4242, 'SIGTERM', expect.any(Function));
  });

  it('closes the client and kills the stdio process tree when the isolated connect fails', async () => {
    const serverInfo = makeServerInfo({
      type: 'stdio',
      url: undefined,
      command: 'npx',
      args: ['-y', 'some-stateful-server'],
      perSessionClient: true,
    });
    mcpService.setServerInfosForTest([serverInfo]);

    // Make the next isolated client's handshake fail so we exercise the
    // connect-failure cleanup path (transport + process tree must be torn down).
    const { Client: MockClient } = jest.requireMock('@modelcontextprotocol/client');
    MockClient.mockImplementationOnce(() => {
      const client = {
        connect: jest.fn().mockRejectedValue(new Error('handshake failed')),
        close: jest.fn(),
      };
      mockCreatedClients.push(client);
      return client;
    });

    const result = await callTool('session-fail');
    expect(result.isError).toBe(true);

    const failedClient = mockCreatedClients[0];
    const stdioTransport = mockCreatedTransports.find((t) => t instanceof MockStdioClientTransport);

    // The half-open client and its transport were closed, and the whole stdio
    // process tree was killed rather than left as an orphan.
    expect(failedClient.close).toHaveBeenCalledTimes(1);
    expect(stdioTransport.close).toHaveBeenCalledTimes(1);
    expect(mockTreeKill).toHaveBeenCalledWith(4242, 'SIGTERM', expect.any(Function));

    // No stale entry was cached — a retry builds a brand-new isolated client.
    await callTool('session-fail');
    expect(mockCreatedClients).toHaveLength(2);
  });

  it('drains isolated clients on cleanupAllServers', async () => {
    const serverInfo = makeServerInfo({ perSessionClient: true });
    mcpService.setServerInfosForTest([serverInfo]);

    await callTool('session-A');
    await callTool('session-B');
    expect(mockCreatedClients).toHaveLength(2);

    mcpService.cleanupAllServers();

    for (const client of mockCreatedClients) {
      expect(client.close).toHaveBeenCalledTimes(1);
    }
  });

  it('reconnects the isolated client on a 404 without disturbing the shared connection', async () => {
    const serverInfo = makeServerInfo({ perSessionClient: true });
    mcpService.setServerInfosForTest([serverInfo]);

    // First call lazily creates isolated client #0.
    await callTool('session-R');
    const isolatedClient = mockCreatedClients[0];
    expect(mockCreatedClients).toHaveLength(1);

    // Make the isolated client fail with a recoverable HTTP 404 session error so
    // the next call triggers reconnection.
    isolatedClient.callTool = jest.fn().mockRejectedValue({
      message: 'Streamable HTTP error: Error POSTing to endpoint (HTTP 404 session expired)',
      status: 404,
      name: 'Error',
    });

    const result = await callTool('session-R');

    // A brand-new isolated client was built and used for the retry.
    expect(mockCreatedClients).toHaveLength(2);
    expect(mockCreatedClients[1].connect).toHaveBeenCalledTimes(1);
    expect(mockCreatedClients[1].callTool).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(false);

    // The stale isolated client was closed; the shared connection was untouched.
    expect(isolatedClient.close).toHaveBeenCalledTimes(1);
    expect(serverInfo.sharedClient.close).not.toHaveBeenCalled();
    expect(serverInfo.status).toBe('connected');

    // The per-session map now points at the reconnected client — a third call
    // reuses it rather than creating yet another connection.
    await callTool('session-R');
    expect(mockCreatedClients).toHaveLength(2);
  });
});
