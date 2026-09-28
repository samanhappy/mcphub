/// <reference types="jest" />
import { SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// Keep DNS deterministic while exercising the real SSRF URL validation.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const mockReconnectClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  getServerCapabilities: jest.fn(() => ({ tools: {} })),
  listTools: jest.fn().mockResolvedValue({
    tools: [
      {
        name: 'get_current_time',
        description: 'Get current time',
        inputSchema: { type: 'object' },
      },
    ],
  }),
  callTool: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'ok-after-reconnect' }],
    isError: false,
  }),
};

jest.mock('@modelcontextprotocol/client', () => {
  class MockSSEClientTransport {
    constructor(
      public url: URL,
      public options?: any,
    ) {}

    close = jest.fn();
  }

  class MockStreamableHTTPClientTransport {
    constructor(
      public url: URL,
      public options?: any,
    ) {}

    close = jest.fn();
  }
  return {
    ...jest.requireActual('@modelcontextprotocol/client'),
    Client: jest.fn().mockImplementation(() => mockReconnectClient),
    SSEClientTransport: MockSSEClientTransport,
    StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
  };
});

jest.mock('@modelcontextprotocol/client/stdio', () => ({
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

const mockLogToolCall = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: mockLogToolCall,
  })),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

const mockBaseFetch = jest.fn();
jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(() => mockBaseFetch),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

const mockServerDao = {
  findAll: jest.fn(async () => []),
  findById: jest.fn(async () => ({
    name: 'clock-server',
    type: 'streamable-http',
    url: 'https://example.com/mcp',
    enabled: true,
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
}));

jest.mock('../../src/config/index.js', () => ({
  ...jest.requireActual('../../src/config/index.js'),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import * as mcpService from '../../src/services/mcpService.js';
describe('mcpService reconnect config integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createServerInfo = (initialCallTool: jest.Mock, transport?: any) => {
    const initialClientClose = jest.fn();

    return {
      name: 'clock-server',
      status: 'connected',
      enabled: true,
      tools: [{ name: 'clock-server::get_current_time' }],
      client: {
        callTool: initialCallTool,
        close: initialClientClose,
      },
      transport: transport ?? new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      options: {},
      initialClientClose,
    };
  };

  it('reconnects when streamable-http tool calls fail with HTTP 404 session errors', async () => {
    const initialCallTool = jest.fn().mockRejectedValue({
      message:
        'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","id":"server-error","error":{"code":-32600,"message":"Session not found"}}',
      code: 404,
      name: 'Error',
    });
    const initialTransport = new StreamableHTTPClientTransport(new URL('https://example.com/mcp'));
    const serverInfo = createServerInfo(initialCallTool, initialTransport) as any;

    mcpService.setServerInfosForTest([serverInfo]);

    const result = await mcpService.handleCallToolRequest(
      {
        params: {
          name: 'call_tool',
          arguments: {
            toolName: 'clock-server::get_current_time',
            arguments: {},
          },
        },
      },
      {
        sessionId: 'session-1',
        server: 'clock-server',
      },
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'ok-after-reconnect' }],
      isError: false,
    });
    expect(initialCallTool).toHaveBeenCalledTimes(1);
    expect(serverInfo.initialClientClose).toHaveBeenCalledTimes(1);
    expect(initialTransport.close).toHaveBeenCalledTimes(1);
    expect(mockReconnectClient.connect).toHaveBeenCalledTimes(1);
    expect(mockReconnectClient.listTools).toHaveBeenCalledTimes(1);
    expect(mockReconnectClient.callTool).toHaveBeenCalledWith(
      { name: 'get_current_time', arguments: {} },
      {},
    );
  });

  it.each(['sse', 'streamable-http'])('expands URL credentials on %s reconnect', async (type) => {
    const previousToken = process.env.MCPHUB_TEST_RECONNECT_TOKEN;
    process.env.MCPHUB_TEST_RECONNECT_TOKEN = 'reconnect-secret';
    const rawConfig = {
      name: 'clock-server',
      type,
      url: 'https://example.com/mcp?token=${MCPHUB_TEST_RECONNECT_TOKEN}',
      enabled: true,
    };
    mockServerDao.findById.mockResolvedValueOnce(rawConfig);
    const initialTransport =
      type === 'sse'
        ? new SSEClientTransport(new URL('https://example.com/mcp?token=reconnect-secret'))
        : new StreamableHTTPClientTransport(
            new URL('https://example.com/mcp?token=reconnect-secret'),
          );
    const serverInfo = createServerInfo(
      jest
        .fn()
        .mockRejectedValue(type === 'sse' ? new Error('Request timed out') : { status: 404 }),
      initialTransport,
    ) as any;
    mcpService.setServerInfosForTest([serverInfo]);
    try {
      const result = await mcpService.handleCallToolRequest(
        {
          params: {
            name: 'call_tool',
            arguments: { toolName: 'clock-server::get_current_time', arguments: {} },
          },
        },
        { sessionId: 'session-1', server: 'clock-server' },
      );
      expect(result.isError).toBe(false);
      expect(serverInfo.transport.url.searchParams.get('token')).toBe('reconnect-secret');
      expect(serverInfo.status).toBe('connected');
      expect(mockReconnectClient.callTool).toHaveBeenCalledTimes(1);
      expect(rawConfig.url).toContain('${MCPHUB_TEST_RECONNECT_TOKEN}');
    } finally {
      if (previousToken === undefined) delete process.env.MCPHUB_TEST_RECONNECT_TOKEN;
      else process.env.MCPHUB_TEST_RECONNECT_TOKEN = previousToken;
      mcpService.setServerInfosForTest([]);
    }
  });

  it('reconnects when the HTTP status is exposed via error.status', async () => {
    const initialCallTool = jest.fn().mockRejectedValue({
      message: 'Streamable HTTP error: upstream session expired',
      status: 404,
      name: 'Error',
    });
    const serverInfo = createServerInfo(initialCallTool) as any;

    mcpService.setServerInfosForTest([serverInfo]);

    const result = await mcpService.handleCallToolRequest(
      {
        params: {
          name: 'call_tool',
          arguments: {
            toolName: 'clock-server::get_current_time',
            arguments: {},
          },
        },
      },
      {
        sessionId: 'session-1',
        server: 'clock-server',
      },
    );

    expect(result.isError).toBe(false);
    expect(serverInfo.initialClientClose).toHaveBeenCalledTimes(1);
    expect(mockReconnectClient.connect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect for non-recoverable HTTP 400 errors', async () => {
    const initialCallTool = jest.fn().mockRejectedValue({
      message: 'Error POSTing to endpoint (HTTP 400 Bad Request)',
      status: 400,
      name: 'Error',
    });
    const serverInfo = createServerInfo(initialCallTool) as any;

    mcpService.setServerInfosForTest([serverInfo]);

    const result = await mcpService.handleCallToolRequest(
      {
        params: {
          name: 'call_tool',
          arguments: {
            toolName: 'clock-server::get_current_time',
            arguments: {},
          },
        },
      },
      {
        sessionId: 'session-1',
        server: 'clock-server',
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('HTTP 400 Bad Request');
    expect(serverInfo.initialClientClose).not.toHaveBeenCalled();
    expect(mockReconnectClient.connect).not.toHaveBeenCalled();
  });
});
