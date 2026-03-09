const mockBaseFetch = jest.fn(async (_url: string | URL, _init?: RequestInit) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  body: {
    cancel: jest.fn(),
  },
} as any));

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
  setupClientKeepAlive: jest.fn(),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(() => mockBaseFetch),
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
  replaceEnvVars: jest.fn((value: any) => value),
  getNameSeparator: jest.fn(() => '-'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn().mockImplementation((url: URL, options: any) => ({
    url,
    options,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation((url: URL, options: any) => ({
    url,
    options,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn(),
}));

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RequestContextService } from '../../src/services/requestContextService.js';
import { createTransportFromConfig } from '../../src/services/mcpService.js';

describe('MCP Service - passthrough headers for upstream MCP transports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RequestContextService.getInstance().clearRequestContext();
  });

  afterEach(() => {
    RequestContextService.getInstance().clearRequestContext();
  });

  it('should merge request-context passthrough headers into streamable-http requests', async () => {
    await createTransportFromConfig('demo-streamable', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: {
        Authorization: 'Bearer static-token',
        'X-Static': 'static-value',
      },
      passthroughHeaders: ['Authorization', 'X-Custom-User-Id'],
    });

    const options = (StreamableHTTPClientTransport as jest.Mock).mock.calls[0][1];

    await RequestContextService.getInstance().runWithCustomRequestContext(
      {
        headers: {
          authorization: 'Bearer user-token',
          'x-custom-user-id': 'user-42',
        },
      },
      async () => {
        await options.fetch('https://example.com/mcp', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer static-token',
            'X-Static': 'static-value',
            'Content-Type': 'application/json',
          },
        });
      },
    );

    expect(mockBaseFetch).toHaveBeenCalledWith(
      'https://example.com/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer user-token',
          'X-Custom-User-Id': 'user-42',
          'X-Static': 'static-value',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('should expose passthrough-aware fetch for SSE connect and message requests', async () => {
    await createTransportFromConfig('demo-sse', {
      type: 'sse',
      url: 'https://example.com/sse',
      headers: {
        'X-Static': 'static-value',
      },
      passthroughHeaders: ['Authorization', 'X-Custom-User-Id'],
    });

    const options = (SSEClientTransport as jest.Mock).mock.calls[0][1];

    await RequestContextService.getInstance().runWithCustomRequestContext(
      {
        headers: {
          authorization: 'Bearer user-token',
          'x-custom-user-id': 'user-99',
        },
      },
      async () => {
        await options.eventSourceInit.fetch('https://example.com/sse', {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'X-Static': 'static-value',
          },
        });

        await options.fetch('https://example.com/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      },
    );

    expect(mockBaseFetch).toHaveBeenNthCalledWith(
      1,
      'https://example.com/sse',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer user-token',
          'X-Custom-User-Id': 'user-99',
          'X-Static': 'static-value',
          Accept: 'text/event-stream',
        }),
      }),
    );

    expect(mockBaseFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer user-token',
          'X-Custom-User-Id': 'user-99',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});