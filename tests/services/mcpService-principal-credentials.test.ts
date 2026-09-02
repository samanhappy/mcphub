/// <reference types="jest" />

const mockCreatedClients: any[] = [];
const mockCreatedTransports: any[] = [];
const resolvedCredentials = new Map<string, { secret: string; version: string }>();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => {
    const client = {
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
      getServerCapabilities: jest.fn(() => ({ tools: {} })),
      getServerVersion: jest.fn(() => ({ version: '1.0.0' })),
      getInstructions: jest.fn(() => undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    };
    mockCreatedClients.push(client);
    return client;
  }),
}));

class MockStreamableHTTPClientTransport {
  close = jest.fn();
  constructor(
    public url: URL,
    public options?: any,
  ) {
    mockCreatedTransports.push(this);
  }
}

class MockSSEClientTransport extends MockStreamableHTTPClientTransport {}

class MockStdioClientTransport {
  close = jest.fn();
  pid = 4242;
  stderr = { on: jest.fn() };
  constructor(public options?: any) {
    mockCreatedTransports.push(this);
  }
}

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}));
jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: MockSSEClientTransport,
}));
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockStdioClientTransport,
}));
jest.mock('tree-kill', () =>
  jest.fn((_pid: number, _signal: string, callback?: (error?: Error) => void) => callback?.()),
);
jest.mock('../../src/utils/ssrf.js', () => ({
  assertSafeUrl: jest.fn().mockResolvedValue(undefined),
  createRedirectValidatingFetch: jest.fn((fetchImpl: any) => fetchImpl),
}));
jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));
jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));
jest.mock('../../src/services/sseService.js', () => ({ getGroup: jest.fn(() => '') }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({ filterData: (data: any) => data })),
}));
jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({ logToolCall: jest.fn() })),
}));
jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn(),
}));
jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(() => jest.fn()),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

const rawServer = {
  name: 'personal-server',
  type: 'stdio' as const,
  command: 'node',
  args: ['server.js'],
  enabled: true,
  visibility: 'public' as const,
  owner: 'admin',
  credentialTemplate: { env: { PERSONAL_TOKEN: { label: 'Personal token' } } },
};

const mockServerDao = {
  findAll: jest.fn(async () => []),
  findById: jest.fn(async () => rawServer),
};

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(async () => ({})) })),
  getBuiltinPromptDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
  getBuiltinResourceDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
  getUserDao: jest.fn(() => ({ findByUsername: jest.fn(async () => null) })),
}));

jest.mock('../../src/services/credentialBindingService.js', () => ({
  credentialBindingService: {
    resolveServerConfig: jest.fn(async (server: typeof rawServer, principal: { username: string }) => {
      const resolved = resolvedCredentials.get(principal.username);
      if (!resolved) throw new Error('binding missing');
      return {
        config: {
          ...server,
          env: { PERSONAL_TOKEN: resolved.secret },
          headers: { Authorization: `Bearer ${resolved.secret}` },
        },
        bindingVersion: resolved.version,
      };
    }),
  },
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
import { UserContextService } from '../../src/services/userContextService.js';

const makeServerInfo = (overrides: Record<string, unknown> = {}) => {
  const sharedClient = {
    callTool: jest.fn().mockResolvedValue({ content: [], isError: false }),
    close: jest.fn(),
  };
  return {
    name: rawServer.name,
    status: 'connected',
    enabled: true,
    tools: [{ name: 'personal-server::search' }],
    prompts: [],
    resources: [],
    client: sharedClient,
    transport: new MockStdioClientTransport(),
    options: {},
    config: { ...rawServer, ...overrides },
    sharedClient,
    createTime: Date.now(),
  } as any;
};

const callAs = (username: string, sessionId: string) =>
  UserContextService.getInstance().runWithContext(
    () =>
      mcpService.handleCallToolRequest(
        {
          params: {
            name: 'call_tool',
            arguments: { toolName: 'personal-server::search', arguments: {} },
          },
        },
        { sessionId, server: 'personal-server', username },
      ),
    { username, password: '', isAdmin: false },
  );

describe('mcpService principal credential runtimes (#1114)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreatedClients.length = 0;
    mockCreatedTransports.length = 0;
    resolvedCredentials.clear();
    resolvedCredentials.set('alice@example.com', { secret: 'alice-secret', version: 'v1' });
    resolvedCredentials.set('bob@example.com', { secret: 'bob-secret', version: 'v1' });
    mockServerDao.findAll.mockResolvedValue([]);
    mockServerDao.findById.mockResolvedValue(rawServer);
    jest.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      if (pid === 4242 && (signal === 0 || signal === undefined)) {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
      return true;
    }) as any);
    mcpService.cleanupAllServers();
  });

  afterEach(() => {
    mcpService.cleanupAllServers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('isolates by principal across sessions and never uses the shared client', async () => {
    const serverInfo = makeServerInfo({ perSessionClient: true });
    mcpService.setServerInfosForTest([serverInfo]);

    await Promise.all([
      callAs('alice@example.com', 'alice-session-1'),
      callAs('bob@example.com', 'bob-session-1'),
    ]);
    await callAs('alice@example.com', 'alice-session-2');

    expect(mockCreatedClients).toHaveLength(2);
    const clientsBySecret = new Map(
      mockCreatedClients.map((client) => [
        client.connect.mock.calls[0][0].options.env.PERSONAL_TOKEN,
        client,
      ]),
    );
    expect(clientsBySecret.get('alice-secret').callTool).toHaveBeenCalledTimes(2);
    expect(clientsBySecret.get('bob-secret').callTool).toHaveBeenCalledTimes(1);
    const stdioEnvs = mockCreatedTransports
      .filter((transport) => transport instanceof MockStdioClientTransport && transport.options?.env)
      .map((transport) => transport.options.env.PERSONAL_TOKEN)
      .sort();
    expect(stdioEnvs).toEqual(['alice-secret', 'bob-secret']);
    expect(serverInfo.sharedClient.callTool).not.toHaveBeenCalled();
  });

  it('registers one shared catalog entry at startup without creating an unbound client', async () => {
    mockServerDao.findAll.mockResolvedValue([rawServer]);

    await mcpService.registerAllTools(true, 'personal-server');

    const serverInfo = mcpService.getServerByName('personal-server');
    expect(serverInfo).toMatchObject({
      name: 'personal-server',
      status: 'disconnected',
      tools: [],
      config: { credentialTemplate: rawServer.credentialTemplate },
    });
    expect(serverInfo?.client).toBeUndefined();
    expect(serverInfo?.transport).toBeUndefined();
    expect(mockCreatedClients).toHaveLength(0);
  });

  it('restarts the exact principal stdio runtime when a binding changes', async () => {
    const serverInfo = makeServerInfo();
    mcpService.setServerInfosForTest([serverInfo]);

    await callAs('alice@example.com', 'session-1');
    const originalClient = mockCreatedClients[0];
    resolvedCredentials.set('alice@example.com', { secret: 'alice-rotated', version: 'v2' });
    mcpService.invalidateCredentialRuntime('personal-server', 'alice@example.com');
    await callAs('alice@example.com', 'session-2');

    expect(originalClient.close).toHaveBeenCalledTimes(1);
    expect(mockCreatedClients).toHaveLength(2);
    const latestTransport = mockCreatedTransports.filter(
      (transport) => transport instanceof MockStdioClientTransport && transport.options?.env,
    ).at(-1);
    expect(latestTransport.options.env.PERSONAL_TOKEN).toBe('alice-rotated');
  });

  it('injects per-principal headers for HTTP transports', async () => {
    mockServerDao.findById.mockResolvedValueOnce({
      ...rawServer,
      type: 'streamable-http',
      command: undefined,
      args: undefined,
      url: 'https://example.com/mcp',
      credentialTemplate: { headers: { Authorization: { label: 'Token' } } },
    });
    const serverInfo = makeServerInfo({
      type: 'streamable-http',
      command: undefined,
      args: undefined,
      url: 'https://example.com/mcp',
      credentialTemplate: { headers: { Authorization: { label: 'Token' } } },
    });
    mcpService.setServerInfosForTest([serverInfo]);

    await callAs('alice@example.com', 'session-http');

    const transport = mockCreatedTransports.find(
      (candidate) => candidate instanceof MockStreamableHTTPClientTransport,
    );
    expect(transport.options.requestInit.headers.Authorization).toBe('Bearer alice-secret');
  });

  it('recycles an idle startOnDemand principal runtime', async () => {
    jest.useFakeTimers();
    const serverInfo = makeServerInfo({ startOnDemand: true, idleTimeoutMs: 25 });
    mcpService.setServerInfosForTest([serverInfo]);

    await callAs('alice@example.com', 'session-1');
    const originalClient = mockCreatedClients[0];
    await jest.advanceTimersByTimeAsync(25);

    expect(originalClient.close).toHaveBeenCalledTimes(1);
    await callAs('alice@example.com', 'session-2');
    expect(mockCreatedClients).toHaveLength(2);
  });
});
