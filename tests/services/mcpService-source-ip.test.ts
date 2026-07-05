/// <reference types="jest" />

const mockCallTool = jest.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'ok' }],
  isError: false,
});

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn(),
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
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: unknown) => data,
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

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

jest.mock('../../src/dao/index.js', () => ({
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

jest.mock('../../src/config/index.js', () => ({
  expandEnvVars: jest.fn((value: string) => value),
  replaceEnvVars: jest.fn((value: unknown) => value),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import * as mcpService from '../../src/services/mcpService.js';
import { RequestContextService } from '../../src/services/requestContextService.js';

describe('mcpService activity logging source IP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    });
    RequestContextService.getInstance().clearRequestContext();
  });

  afterEach(() => {
    RequestContextService.getInstance().clearRequestContext();
  });

  it('passes request sourceIp to activity logging', async () => {
    const serverInfo = {
      name: 'clock-server',
      status: 'connected',
      enabled: true,
      tools: [{ name: 'clock-server::get_current_time' }],
      client: {
        callTool: mockCallTool,
      },
      options: {},
    } as any;

    const getServerByNameSpy = jest.spyOn(mcpService, 'getServerByName').mockReturnValue(serverInfo);

    await RequestContextService.getInstance().runWithCustomRequestContext(
      {
        headers: {},
        remoteAddress: '::ffff:198.51.100.24',
      },
      async () => {
        await mcpService.handleCallToolRequest(
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
      },
    );

    expect(mockLogToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceIp: '198.51.100.24',
      }),
    );

    getServerByNameSpy.mockRestore();
  });

  it('passes request username to activity logging', async () => {
    const serverInfo = {
      name: 'clock-server',
      status: 'connected',
      enabled: true,
      tools: [{ name: 'clock-server::get_current_time' }],
      client: {
        callTool: mockCallTool,
      },
      options: {},
    } as any;

    const getServerByNameSpy = jest.spyOn(mcpService, 'getServerByName').mockReturnValue(serverInfo);

    await RequestContextService.getInstance().runWithCustomRequestContext(
      {
        headers: {},
      } as any,
      async () => {
        (RequestContextService.getInstance().getRequestContext() as any).username = 'alice';

        await mcpService.handleCallToolRequest(
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
            sessionId: 'session-username',
            server: 'clock-server',
          },
        );
      },
    );

    expect(mockLogToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
      }),
    );

    getServerByNameSpy.mockRestore();
  });

  it('logs raw tool input and output for activity details', async () => {
    const rawResult = {
      content: [
        {
          type: 'text',
          text: '{"message":"tool failed for test"}',
        },
      ],
      isError: true,
    };
    mockCallTool.mockResolvedValueOnce(rawResult);

    const serverInfo = {
      name: 'amap',
      status: 'connected',
      enabled: true,
      tools: [{ name: 'amap::maps_geo' }],
      client: {
        callTool: mockCallTool,
      },
      options: {},
    } as any;

    const getServerByNameSpy = jest.spyOn(mcpService, 'getServerByName').mockReturnValue(serverInfo);

    const rawArguments = {
      address: 'Hangzhou West Lake',
    };

    await mcpService.handleCallToolRequest(
      {
        params: {
          name: 'call_tool',
          arguments: {
            toolName: 'amap::maps_geo',
            arguments: rawArguments,
          },
        },
      },
      {
        sessionId: 'session-2',
        server: 'amap',
      },
    );

    expect(mockLogToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        server: 'amap',
        tool: 'maps_geo',
        status: 'error',
        input: rawArguments,
        output: rawResult,
        errorMessage: 'Tool returned error response',
      }),
    );

    getServerByNameSpy.mockRestore();
  });
});
