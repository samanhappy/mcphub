/// <reference types="jest" />

// Regression test for issue #922: a tool that returns a null (or other
// non-object JSON) payload as its text content must not crash the hub's
// tool-call path. The crash originated in checkAuthError, which parsed the
// text content and dereferenced `.code` on the result without checking that
// JSON.parse actually returned an object.

const mockCallTool = jest.fn();

const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  getServerCapabilities: jest.fn(() => ({ tools: {} })),
  listTools: jest.fn().mockResolvedValue({ tools: [] }),
  callTool: mockCallTool,
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
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

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(() => jest.fn()),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findAll: jest.fn(async () => []),
    findById: jest.fn(async () => undefined),
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

import * as mcpService from '../../src/services/mcpService.js';

describe('handleCallToolRequest null / primitive tool result payloads (issue #922)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createServerInfo = (callToolImpl: jest.Mock) => ({
    name: 'null-server',
    status: 'connected',
    enabled: true,
    tools: [{ name: 'null-server::do_thing' }],
    client: { callTool: callToolImpl, close: jest.fn() },
    transport: {},
    options: {},
  });

  const callWithPayload = async (text: string) => {
    const callTool = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      isError: false,
    });
    const serverInfo = createServerInfo(callTool) as any;

    const getServerByNameSpy = jest
      .spyOn(mcpService, 'getServerByName')
      .mockReturnValue(serverInfo);

    const result = await mcpService.handleCallToolRequest(
      {
        params: {
          name: 'call_tool',
          arguments: {
            toolName: 'null-server::do_thing',
            arguments: {},
          },
        },
      },
      {
        sessionId: 'session-1',
        server: 'null-server',
      },
    );

    getServerByNameSpy.mockRestore();
    return { result, callTool };
  };

  it('passes through a null JSON payload without throwing', async () => {
    const { result, callTool } = await callWithPayload('null');

    expect(callTool).toHaveBeenCalledTimes(1);
    // Raw text content is returned unchanged.
    expect(result).toEqual({
      content: [{ type: 'text', text: 'null' }],
      isError: false,
    });
  });

  it('passes through a primitive number payload without throwing', async () => {
    const { result } = await callWithPayload('42');
    expect(result).toEqual({
      content: [{ type: 'text', text: '42' }],
      isError: false,
    });
  });

  it('passes through a boolean payload without throwing', async () => {
    const { result } = await callWithPayload('true');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'true' }],
      isError: false,
    });
  });

  it('still surfaces a genuine { code: 401 } payload as an auth error', async () => {
    // A real auth-error object must keep triggering the 401 path — the null
    // guard must not swallow legitimate error objects.
    const callTool = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ code: 401, message: 'Unauthorized' }),
        },
      ],
      isError: false,
    });
    const serverInfo = createServerInfo(callTool) as any;

    const getServerByNameSpy = jest
      .spyOn(mcpService, 'getServerByName')
      .mockReturnValue(serverInfo);

    const result = await mcpService.handleCallToolRequest(
      {
        params: {
          name: 'call_tool',
          arguments: { toolName: 'null-server::do_thing', arguments: {} },
        },
      },
      { sessionId: 'session-1', server: 'null-server' },
    );

    getServerByNameSpy.mockRestore();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('401');
  });
});
