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
  createOAuthProvider: jest.fn(),
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
  getUserDao: jest.fn(() => ({
    findByUsername: jest.fn(async () => null),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn(),
}));

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import { createTransportFromConfig } from '../../src/services/mcpService.js';

const mockedCreateOAuthProvider = jest.mocked(createOAuthProvider);

describe('MCP Service - OAuth auth provider and static Authorization header', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateOAuthProvider.mockResolvedValue(undefined);
  });

  it.each(['streamable-http', 'sse'] as const)(
    'preserves an Authorization header on %s when no OAuth is configured',
    async (type) => {
      mockedCreateOAuthProvider.mockResolvedValue(undefined);

      await createTransportFromConfig('static-auth-only', {
        type,
        url: 'https://example.com/mcp',
        headers: {
          Authorization: 'Bearer api-token',
          'X-Other': 'value',
        },
      });

      if (type === 'streamable-http') {
        const options = (StreamableHTTPClientTransport as jest.Mock).mock.calls[0][1];
        expect(options.requestInit?.headers).toEqual({
          Authorization: 'Bearer api-token',
          'X-Other': 'value',
        });
        expect(options.authProvider).toBeUndefined();
      } else {
        const options = (SSEClientTransport as jest.Mock).mock.calls[0][1];
        expect(options.requestInit?.headers).toEqual({
          Authorization: 'Bearer api-token',
          'X-Other': 'value',
        });
        expect(options.eventSourceInit?.headers).toEqual({
          Authorization: 'Bearer api-token',
          'X-Other': 'value',
        });
        expect(options.authProvider).toBeUndefined();
      }

      expect(createOAuthProvider).toHaveBeenCalledWith('static-auth-only', expect.any(Object));
    },
  );
});

class FakeOAuthProvider {
  private _tokens: { access_token: string } | undefined;
  constructor(hasToken: boolean) {
    if (hasToken) {
      this._tokens = { access_token: 'oauth-token' };
    }
  }
  tokens() {
    return this._tokens;
  }
}

describe('MCP Service - active OAuth strips stale static Authorization header', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['streamable-http', 'sse'] as const)(
    'strips static Authorization on %s when OAuth provider has a token',
    async (type) => {
      const provider = new FakeOAuthProvider(true);
      mockedCreateOAuthProvider.mockResolvedValue(provider as any);

      await createTransportFromConfig('oauth-active', {
        type,
        url: 'https://example.com/mcp',
        headers: {
          Authorization: 'Bearer old-static-token',
          'X-Other': 'kept',
        },
      });

      if (type === 'streamable-http') {
        const options = (StreamableHTTPClientTransport as jest.Mock).mock.calls[0][1];
        expect(options.requestInit?.headers).toEqual({
          'X-Other': 'kept',
        });
        expect(options.authProvider).toBe(provider);
      } else {
        const options = (SSEClientTransport as jest.Mock).mock.calls[0][1];
        expect(options.requestInit?.headers).toEqual({
          'X-Other': 'kept',
        });
        expect(options.eventSourceInit?.headers).toEqual({
          'X-Other': 'kept',
        });
        expect(options.authProvider).toBe(provider);
      }
    },
  );

  it.each(['streamable-http', 'sse'] as const)(
    'keeps other headers on %s when stripping Authorization for active OAuth',
    async (type) => {
      const provider = new FakeOAuthProvider(true);
      mockedCreateOAuthProvider.mockResolvedValue(provider as any);

      await createTransportFromConfig('oauth-active-other-headers', {
        type,
        url: 'https://example.com/mcp',
        headers: {
          authorization: 'Bearer old-static-token',
          'X-Custom': 'custom-value',
        },
      });

      if (type === 'streamable-http') {
        const options = (StreamableHTTPClientTransport as jest.Mock).mock.calls[0][1];
        expect(options.requestInit?.headers).toEqual({
          'X-Custom': 'custom-value',
        });
      } else {
        const options = (SSEClientTransport as jest.Mock).mock.calls[0][1];
        expect(options.requestInit?.headers).toEqual({
          'X-Custom': 'custom-value',
        });
      }
    },
  );
});
