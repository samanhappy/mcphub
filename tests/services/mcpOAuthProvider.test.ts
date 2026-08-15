jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  initializeOAuthForServer: jest.fn(),
  getRegisteredClient: jest.fn(),
  removeRegisteredClient: jest.fn(),
  fetchScopesFromServer: jest.fn(),
}));

jest.mock('../../src/services/oauthSettingsStore.js', () => ({
  clearOAuthData: jest.fn(),
  loadServerConfig: jest.fn(),
  mutateOAuthSettings: jest.fn(),
  persistClientCredentials: jest.fn(),
  persistTokens: jest.fn(),
  updatePendingAuthorization: jest.fn(),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: jest.fn(),
}));

import { getSystemConfigDao } from '../../src/dao/index.js';
import { MCPHubOAuthProvider, createOAuthProvider } from '../../src/services/mcpOAuthProvider.js';

describe('MCPHubOAuthProvider redirect URI resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.INSTALL_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('prefers oauth.redirectUri over installation Base URL for the callback URL', async () => {
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({
        install: {
          baseUrl: 'https://base.example.com',
        },
      }),
    });

    const provider = await MCPHubOAuthProvider.create('notion', {
      url: 'https://mcp.notion.com/mcp',
      oauth: {
        redirectUri: 'https://custom.example.com/oauth/callback?server=notion',
      },
    } as any);

    expect(provider.redirectUrl).toBe('https://custom.example.com/oauth/callback');
  });

  it('uses INSTALL_BASE_URL for the callback URL when installation Base URL is unset', async () => {
    process.env.INSTALL_BASE_URL = 'https://env.example.com/mcphub';
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({}),
    });

    const provider = await MCPHubOAuthProvider.create('notion', {
      url: 'https://mcp.notion.com/mcp',
    } as any);

    expect(provider.redirectUrl).toBe('https://env.example.com/mcphub/oauth/callback');
  });

  it('registers the preferred redirect URI ahead of the Base URL in client metadata', async () => {
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({
        install: {
          baseUrl: 'https://base.example.com',
        },
      }),
    });

    const provider = await MCPHubOAuthProvider.create('notion', {
      url: 'https://mcp.notion.com/mcp',
      oauth: {
        redirectUri: 'https://custom.example.com/oauth/callback',
        dynamicRegistration: {
          metadata: {
            redirect_uris: ['https://backup.example.com/oauth/callback'],
          },
        },
      },
    } as any);

    expect(provider.clientMetadata.redirect_uris).toEqual([
      'https://custom.example.com/oauth/callback',
      'https://backup.example.com/oauth/callback',
      'https://base.example.com/oauth/callback',
    ]);
  });
});

describe('createOAuthProvider - 401 auto-discovery guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({}),
    });
  });

  it('creates a provider for a URL-only server so 401 auto-discovery can run', async () => {
    const provider = await createOAuthProvider('notion', {
      type: 'streamable-http',
      url: 'https://mcp.notion.com/mcp',
    } as any);

    expect(provider).toBeInstanceOf(MCPHubOAuthProvider);
  });

  it('creates a provider for a URL-only server with non-Authorization headers', async () => {
    const provider = await createOAuthProvider('notion', {
      type: 'streamable-http',
      url: 'https://mcp.notion.com/mcp',
      headers: { 'X-Custom': 'value' },
    } as any);

    expect(provider).toBeInstanceOf(MCPHubOAuthProvider);
  });

  it('returns undefined when only a static Authorization header is configured', async () => {
    const provider = await createOAuthProvider('static', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer api-token' },
    } as any);

    expect(provider).toBeUndefined();
  });

  it('returns undefined for a static auth header with non-canonical casing', async () => {
    const provider = await createOAuthProvider('static', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { authorization: 'Bearer api-token' },
    } as any);

    expect(provider).toBeUndefined();
  });

  it('creates a provider when OAuth is explicitly configured', async () => {
    const provider = await createOAuthProvider('oauth', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      oauth: { clientId: 'abc' },
    } as any);

    expect(provider).toBeInstanceOf(MCPHubOAuthProvider);
  });

  it('creates a provider when OAuth is configured alongside a static Authorization header', async () => {
    const provider = await createOAuthProvider('oauth', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer stale-token' },
      oauth: { clientId: 'abc' },
    } as any);

    expect(provider).toBeInstanceOf(MCPHubOAuthProvider);
  });
});
