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
      url: 'https://example.com/mcp',
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
      url: 'https://example.com/sse',
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
});
