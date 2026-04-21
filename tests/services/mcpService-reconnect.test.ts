/// <reference types="jest" />

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

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => mockReconnectClient),
}));

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

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: MockSSEClientTransport,
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
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
  setupClientKeepAlive: jest.fn(),
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
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('mcpService streamable-http reconnect', () => {
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
      transport:
        transport ?? new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
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

    const getServerByNameSpy = jest
      .spyOn(mcpService, 'getServerByName')
      .mockReturnValue(serverInfo);

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
      undefined,
      {},
    );

    getServerByNameSpy.mockRestore();
  });

  it('reconnects when the HTTP status is exposed via error.status', async () => {
    const initialCallTool = jest.fn().mockRejectedValue({
      message: 'Streamable HTTP error: upstream session expired',
      status: 404,
      name: 'Error',
    });
    const serverInfo = createServerInfo(initialCallTool) as any;

    const getServerByNameSpy = jest
      .spyOn(mcpService, 'getServerByName')
      .mockReturnValue(serverInfo);

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

    getServerByNameSpy.mockRestore();
  });

  it('does not reconnect for non-recoverable HTTP 400 errors', async () => {
    const initialCallTool = jest.fn().mockRejectedValue({
      message: 'Error POSTing to endpoint (HTTP 400 Bad Request)',
      status: 400,
      name: 'Error',
    });
    const serverInfo = createServerInfo(initialCallTool) as any;

    const getServerByNameSpy = jest
      .spyOn(mcpService, 'getServerByName')
      .mockReturnValue(serverInfo);

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

    getServerByNameSpy.mockRestore();
  });
});
