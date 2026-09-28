jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  initializeOAuthForServer: jest.fn(),
  getRegisteredClient: jest.fn(),
  removeRegisteredClient: jest.fn(),
  fetchScopesFromServer: jest.fn(),
  createOAuthFetch: jest.fn().mockResolvedValue(jest.fn()),
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
import {
  getRegisteredClient,
  fetchScopesFromServer,
} from '../../src/services/oauthClientRegistration.js';
import { mutateOAuthSettings } from '../../src/services/oauthSettingsStore.js';
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

describe('MCPHubOAuthProvider client information', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({}),
    });
  });

  it('preserves client_secret_post for persisted static credentials', async () => {
    (getRegisteredClient as jest.Mock).mockReturnValue(undefined);

    const provider = await MCPHubOAuthProvider.create('hospitable', {
      url: 'https://mcp.hospitable.com/mcp',
      oauth: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    } as any);

    expect(provider.clientInformation()).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      token_endpoint_auth_method: 'client_secret_post',
    });
  });

  it('preserves an explicitly configured method for a cached client', async () => {
    (getRegisteredClient as jest.Mock).mockReturnValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    const provider = await MCPHubOAuthProvider.create('example', {
      url: 'https://mcp.example.com/mcp',
      oauth: {
        clientSecret: 'client-secret',
        dynamicRegistration: {
          metadata: {
            token_endpoint_auth_method: 'client_secret_basic',
          },
        },
      },
    } as any);

    expect(provider.clientInformation()).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      token_endpoint_auth_method: 'client_secret_basic',
    });
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

describe('createOAuthProvider - scope discovery before first registration (#1227)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({}),
    });
  });

  it('discovers scopes for a URL-only config and the first registration sees them, not openid', async () => {
    // Exact repro from the upstream review: `{ type: 'streamable-http', url: '...' }` with no
    // `oauth` key at all -- the very first connection attempt, before any registration has
    // happened. Scope discovery must run here so the *first* registration already knows the
    // upstream server uses no scopes, instead of only finding out after defaulting to 'openid'.
    // Asserting the resulting `clientMetadata.scope` (not just that the mocks were called) is
    // what actually proves the behavior the maintainer asked for.
    (fetchScopesFromServer as jest.Mock).mockResolvedValue([]);
    (mutateOAuthSettings as jest.Mock).mockImplementation(async (_name, mutator) => {
      const oauth: Record<string, unknown> = {};
      mutator({ oauth, serverConfig: {} });
      return { oauth };
    });

    const provider = await createOAuthProvider('pcloud', {
      type: 'streamable-http',
      url: 'https://mcp.pcloud.com/mcp',
    } as any);

    expect(fetchScopesFromServer).toHaveBeenCalledWith(
      'https://mcp.pcloud.com/mcp',
      expect.any(Function),
    );
    expect(mutateOAuthSettings).toHaveBeenCalledWith('pcloud', expect.any(Function));
    expect((provider as MCPHubOAuthProvider).clientMetadata.scope).toBe('');
  });

  it('keeps the openid default when discovery finds nothing, without persisting anything', async () => {
    (fetchScopesFromServer as jest.Mock).mockResolvedValue(undefined);

    const provider = await createOAuthProvider('undiscoverable', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    } as any);

    expect(fetchScopesFromServer).toHaveBeenCalledWith(
      'https://example.com/mcp',
      expect.any(Function),
    );
    expect(mutateOAuthSettings).not.toHaveBeenCalled();
    expect((provider as MCPHubOAuthProvider).clientMetadata.scope).toBe('openid');
  });

  it('does not throw and keeps the openid default when discovery itself fails', async () => {
    (fetchScopesFromServer as jest.Mock).mockRejectedValue(new Error('network error'));

    const provider = await createOAuthProvider('flaky', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    } as any);

    expect(mutateOAuthSettings).not.toHaveBeenCalled();
    expect((provider as MCPHubOAuthProvider).clientMetadata.scope).toBe('openid');
  });

  it('does not re-fetch scopes when they were already resolved to an empty array', async () => {
    await createOAuthProvider('pcloud', {
      type: 'streamable-http',
      url: 'https://mcp.pcloud.com/mcp',
      oauth: { scopes: [] },
    } as any);

    expect(fetchScopesFromServer).not.toHaveBeenCalled();
  });

  it('does not re-fetch scopes when a non-empty scope list is already configured', async () => {
    await createOAuthProvider('example', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      oauth: { scopes: ['read', 'write'] },
    } as any);

    expect(fetchScopesFromServer).not.toHaveBeenCalled();
  });
});

describe('MCPHubOAuthProvider issuer snapshot', () => {
  it.each([true, false, undefined])(
    'persists advertised support %s with the flow',
    async (supported) => {
      const { updatePendingAuthorization } = await import(
        '../../src/services/oauthSettingsStore.js'
      );
      const { getServerByName } = await import('../../src/services/mcpService.js');
      const serverInfo = { oauth: undefined };
      (getServerByName as jest.Mock).mockReturnValue(serverInfo);
      const provider = new MCPHubOAuthProvider('upstream', { url: 'https://as.example.com/mcp' });
      provider.saveDiscoveryState({
        authorizationServerUrl: 'https://as.example.com/tenant',
        authorizationServerMetadata: {
          issuer: 'https://as.example.com/tenant',
          authorization_endpoint: 'https://as.example.com/tenant/authorize',
          token_endpoint: 'https://as.example.com/tenant/token',
          response_types_supported: ['code'],
          authorization_response_iss_parameter_supported: supported,
        },
      });
      await expect(
        provider.redirectToAuthorization(
          new URL('https://as.example.com/tenant/authorize?state=snapshot-state'),
        ),
      ).rejects.toThrow('OAuth authorization required');
      const expected = {
        issuer: 'https://as.example.com/tenant',
        issRequired: supported === true,
        state: 'snapshot-state',
      };
      expect(updatePendingAuthorization).toHaveBeenCalledWith(
        'upstream',
        expect.objectContaining(expected),
      );
      expect(serverInfo.oauth).toEqual(expect.objectContaining(expected));
    },
  );
});
