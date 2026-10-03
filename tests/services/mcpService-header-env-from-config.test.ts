import { SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const mockBaseFetch = jest.fn();

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
  saveToolsAsVectorEmbeddings: jest.fn(),
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
  createFetchWithProxy: jest.fn(() => mockBaseFetch),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: jest.fn(() => ({
    findByUsername: jest.fn(async (username: string) => ({ isAdmin: username === 'admin' })),
  })),
  getServerDao: jest.fn(() => ({
    findAll: jest.fn(async () => []),
    findById: jest.fn(async () => null),
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

jest.mock('@modelcontextprotocol/client', () => ({
  ...jest.requireActual('@modelcontextprotocol/client'),
  SSEClientTransport: jest.fn().mockImplementation((url: URL, options: any) => ({
    url,
    options,
  })),
  StreamableHTTPClientTransport: jest.fn().mockImplementation((url: URL, options: any) => ({
    url,
    options,
  })),
}));

jest.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: jest.fn(),
}));
import { expandServerConfig } from '../../src/services/serverConfigEnvironment.js';
import { createTransportFromConfig } from '../../src/services/mcpService.js';

describe('MCP Service - header env var expansion from server config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.AUTH_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('expands streamable-http header values using config env vars', async () => {
    await createTransportFromConfig('demo-streamable', {
      type: 'streamable-http',
      url: 'https://8.8.8.8/mcp',
      env: {
        AUTH_TOKEN: 'configured-token',
      },
      headers: {
        Authorization: 'Bearer ${AUTH_TOKEN}',
      },
    });

    const options = (StreamableHTTPClientTransport as jest.Mock).mock.calls[0][1];

    expect(options.requestInit.headers).toEqual({
      Authorization: 'Bearer configured-token',
    });
  });

  it('expands sse header values using config env vars', async () => {
    await createTransportFromConfig('demo-sse', {
      type: 'sse',
      url: 'https://8.8.8.8/sse',
      env: {
        AUTH_TOKEN: 'configured-token',
      },
      headers: {
        Authorization: 'Bearer ${AUTH_TOKEN}',
      },
    });

    const options = (SSEClientTransport as jest.Mock).mock.calls[0][1];

    expect(options.requestInit.headers).toEqual({
      Authorization: 'Bearer configured-token',
    });
    expect(options.eventSourceInit.headers).toEqual({
      Authorization: 'Bearer configured-token',
    });
  });
  it.each(['streamable-http', 'sse'])('does not send hub secrets in %s headers', async (type) => {
    process.env.HUB_SECRET = 'synthetic-hub-secret';
    await createTransportFromConfig('untrusted', {
      owner: 'member',
      type: type as 'sse' | 'streamable-http',
      url: 'https://8.8.8.8/mcp',
      env: { COPIED: '${HUB_SECRET}', OWN: 'own-token' },
      headers: { Leak: '${HUB_SECRET}', Indirect: '${COPIED}', Own: '${OWN}' },
    });
    const constructor = type === 'sse' ? SSEClientTransport : StreamableHTTPClientTransport;
    const options = (constructor as jest.Mock).mock.calls[0][1];
    expect(JSON.stringify(options.requestInit.headers)).not.toContain('synthetic-hub-secret');
    expect(options.requestInit.headers.Own).toBe('own-token');
  });
  it.each(['streamable-http', 'sse'])(
    'keeps literal owner privileges through %s expansion',
    async (type) => {
      process.env.HUB_SECRET = 'synthetic-hub-secret';
      const expanded = await expandServerConfig({
        owner: '${ROLE}',
        type: type as 'sse' | 'streamable-http',
        url: 'https://8.8.8.8/mcp',
        env: { ROLE: 'admin', DOLLAR: '$' },
        headers: { Leak: '${DOLLAR}{HUB_SECRET}' },
      });
      await createTransportFromConfig('literal-owner', expanded);
      const constructor = type === 'sse' ? SSEClientTransport : StreamableHTTPClientTransport;
      const options = (constructor as jest.Mock).mock.calls[0][1];
      expect(JSON.stringify(options.requestInit.headers)).not.toContain('synthetic-hub-secret');
    },
  );
});
