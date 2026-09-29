// Mock openid-client before importing the service
const mockDiscovery = jest.fn();
const mockDynamicClientRegistration = jest.fn();
const mockCustomFetch = Symbol('customFetch');
const mockFindByUsername = jest.fn();

jest.mock('openid-client', () => ({
  discovery: mockDiscovery,
  customFetch: mockCustomFetch,
  dynamicClientRegistration: mockDynamicClientRegistration,
  ClientSecretPost: jest.fn(() => jest.fn()),
  None: jest.fn(() => jest.fn()),
  calculatePKCECodeChallenge: jest.fn(),
  randomPKCECodeVerifier: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  authorizationCodeGrant: jest.fn(),
  refreshTokenGrant: jest.fn(),
}));

jest.mock('../../src/services/oauthSettingsStore.js', () => ({
  mutateOAuthSettings: jest.fn(),
  persistClientCredentials: jest.fn(),
  persistTokens: jest.fn(),
}));

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(),
  getUserDao: jest.fn(() => ({ findByUsername: mockFindByUsername })),
}));

import { mutateOAuthSettings, persistClientCredentials } from '../../src/services/oauthSettingsStore.js';
import { getSystemConfigDao } from '../../src/dao/index.js';
import {
  fetchProtectedResourceMetadata,
  getAuthorizationUrl,
  initializeOAuthForServer,
  registerClient,
  removeRegisteredClient,
} from '../../src/services/oauthClientRegistration.js';
import { UnsafeUrlError } from '../../src/utils/ssrf.js';
import * as client from 'openid-client';

describe('registerClient redirect URI handling', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(persistClientCredentials)
      .mockResolvedValue({ oauth: { clientId: 'registered-client' } });
    removeRegisteredClient('notion');
    process.env = { ...originalEnv };
    delete process.env.INSTALL_BASE_URL;
    mockFindByUsername.mockResolvedValue(undefined);
    mockDiscovery.mockResolvedValue({});
    mockDynamicClientRegistration.mockResolvedValue({
      client_id: 'registered-client',
      client_secret: 'registered-secret',
      serverMetadata: () => ({
        authorization_endpoint: 'https://issuer.example.com/authorize',
        token_endpoint: 'https://issuer.example.com/token',
      }),
    });
  });

  it('uses oauth.redirectUri for dynamic client registration when provided', async () => {
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({
        install: {
          baseUrl: 'https://base.example.com',
        },
      }),
    });

    await registerClient('notion', {
      url: 'https://mcp.notion.com/mcp',
      oauth: {
        redirectUri: 'https://custom.example.com/oauth/callback',
        dynamicRegistration: {
          enabled: true,
          issuer: 'https://issuer.example.com',
        },
      },
    } as any);

    expect(mockDynamicClientRegistration).toHaveBeenCalledWith(
      new URL('https://issuer.example.com'),
      expect.objectContaining({
        redirect_uris: [
          'https://custom.example.com/oauth/callback',
          'https://base.example.com/oauth/callback',
        ],
      }),
      expect.any(Function),
      expect.objectContaining({
        [mockCustomFetch]: expect.any(Function),
      }),
    );
  });

  it('uses INSTALL_BASE_URL for dynamic client registration when install.baseUrl is unset', async () => {
    process.env.INSTALL_BASE_URL = 'https://env.example.com/mcphub';
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({}),
    });

    await registerClient('notion', {
      url: 'https://mcp.notion.com/mcp',
      oauth: {
        dynamicRegistration: {
          enabled: true,
          issuer: 'https://issuer.example.com',
        },
      },
    } as any);

    expect(mockDynamicClientRegistration).toHaveBeenCalledWith(
      new URL('https://issuer.example.com'),
      expect.objectContaining({
        redirect_uris: ['https://env.example.com/mcphub/oauth/callback'],
      }),
      expect.any(Function),
      expect.objectContaining({
        [mockCustomFetch]: expect.any(Function),
      }),
    );
  });

  it('passes an SSRF-safe fetch to dynamic client registration', async () => {
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({}),
    });

    await registerClient('notion', {
      url: 'https://mcp.notion.com/mcp',
      oauth: {
        dynamicRegistration: {
          enabled: true,
          issuer: 'https://issuer.example.com',
        },
      },
    } as any);

    const options = mockDynamicClientRegistration.mock.calls[0][3];
    expect(options).toEqual(
      expect.objectContaining({
        [mockCustomFetch]: expect.any(Function),
      }),
    );
    await expect(
      options[mockCustomFetch]('http://127.0.0.1:8181/secret', { method: 'GET' }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects internal protected-resource metadata before making a request', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(
      fetchProtectedResourceMetadata('http://127.0.0.1:8181/.well-known/oauth-protected-resource'),
    ).rejects.toThrow(UnsafeUrlError);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('passes an SSRF-safe fetch to static OAuth discovery', async () => {
    await initializeOAuthForServer('notion', {
      owner: 'alice',
      url: 'https://mcp.notion.com/mcp',
      oauth: {
        clientId: 'static-client',
        scopes: [],
        authorizationEndpoint: 'https://issuer.example.com/authorize',
      },
    } as any);

    const options = mockDiscovery.mock.calls[0][4];
    expect(options).toEqual(
      expect.objectContaining({
        [mockCustomFetch]: expect.any(Function),
      }),
    );
    await expect(
      options[mockCustomFetch]('http://127.0.0.1:8181/secret', { method: 'GET' }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  afterAll(() => {
    process.env = originalEnv;
  });
});

describe('scope handling: explicitly-empty vs unset (#1227)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.INSTALL_BASE_URL;
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({}),
    });
    (persistClientCredentials as jest.Mock).mockResolvedValue({
      oauth: { clientId: 'registered-client' },
    });
    removeRegisteredClient('pcloud');
    mockDynamicClientRegistration.mockResolvedValue({
      client_id: 'registered-client',
      client_secret: undefined,
      serverMetadata: () => ({
        authorization_endpoint: 'https://mcp.pcloud.com/authorize',
        token_endpoint: 'https://mcp.pcloud.com/token',
      }),
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('registers with an empty scope string when auto-detected scopes resolved to []', async () => {
    await registerClient(
      'pcloud',
      { url: 'https://mcp.pcloud.com/mcp' } as any,
      'https://mcp.pcloud.com',
      [],
    );

    expect(mockDynamicClientRegistration).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ scope: '' }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('falls back to openid when no scopes were ever detected or configured', async () => {
    await registerClient(
      'pcloud',
      { url: 'https://mcp.pcloud.com/mcp' } as any,
      'https://mcp.pcloud.com',
      undefined,
    );

    expect(mockDynamicClientRegistration).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ scope: 'openid' }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('prefers a configured empty scopes array over the openid default', async () => {
    await registerClient(
      'pcloud',
      {
        url: 'https://mcp.pcloud.com/mcp',
        oauth: { scopes: [] },
      } as any,
      'https://mcp.pcloud.com',
      undefined,
    );

    expect(mockDynamicClientRegistration).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ scope: '' }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('builds the authorization URL with an empty scope for a server with scopes: []', async () => {
    (client.buildAuthorizationUrl as jest.Mock).mockReturnValue(
      new URL('https://mcp.pcloud.com/authorize?scope='),
    );

    await getAuthorizationUrl(
      'pcloud',
      { url: 'https://mcp.pcloud.com/mcp', oauth: { scopes: [] } } as any,
      { clientId: 'c', config: {} } as any,
      'https://gateway.example.com/oauth/callback',
      'state-value',
      'verifier-value',
    );

    expect(client.buildAuthorizationUrl).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ scope: '' }),
    );
  });

  it('builds the authorization URL with openid when no scopes are configured', async () => {
    (client.buildAuthorizationUrl as jest.Mock).mockReturnValue(
      new URL('https://example.com/authorize?scope=openid'),
    );

    await getAuthorizationUrl(
      'example',
      { url: 'https://example.com/mcp' } as any,
      { clientId: 'c', config: {} } as any,
      'https://gateway.example.com/oauth/callback',
      'state-value',
      'verifier-value',
    );

    expect(client.buildAuthorizationUrl).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ scope: 'openid' }),
    );
  });

  it('persists an explicitly empty discovered scope list for a static (pre-configured clientId) server too', async () => {
    // The static-client branch of initializeOAuthForServer had its own separate instance of the
    // same #1227 bug: `if (fetchedScopes && fetchedScopes.length > 0)` silently dropped a
    // discovered `[]`. Not caught by the first round of this fix because it's a different
    // branch (clientId already configured, so dynamic registration is skipped entirely).
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_servers: ['https://mcp.pcloud.com'],
        scopes_supported: [],
      }),
    } as Response);

    const serverConfig: any = {
      url: 'https://mcp.pcloud.com/mcp',
      oauth: {
        clientId: 'preconfigured-client',
        authorizationEndpoint: 'https://mcp.pcloud.com/authorize',
        tokenEndpoint: 'https://mcp.pcloud.com/token',
      },
    };

    await initializeOAuthForServer('pcloud', serverConfig);

    expect(mutateOAuthSettings).toHaveBeenCalledWith('pcloud', expect.any(Function));
    expect(serverConfig.oauth.scopes).toEqual([]);

    fetchSpy.mockRestore();
  });

  it('discovers scopes inside initializeOAuthForServer itself, for callers that skip createOAuthProvider', async () => {
    // oauthService.ts's getServerOAuthToken() and the startup pre-registration loop both call
    // initializeOAuthForServer directly (never through createOAuthProvider, so
    // mcpOAuthProvider.ts's own pre-registration discovery never runs for them) whenever
    // oauth.dynamicRegistration.enabled is true. Without discovery running here too, a
    // pre-registered zero-scope server would still register with 'openid'.
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_servers: ['https://mcp.pcloud.com'],
        scopes_supported: [],
      }),
    } as Response);

    await initializeOAuthForServer(
      'pcloud',
      {
        url: 'https://mcp.pcloud.com/mcp',
        oauth: { dynamicRegistration: { enabled: true, issuer: 'https://mcp.pcloud.com' } },
      } as any,
      undefined,
      undefined,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://mcp.pcloud.com/.well-known/oauth-protected-resource/mcp',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockDynamicClientRegistration).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ scope: '' }),
      expect.any(Function),
      expect.any(Object),
    );

    fetchSpy.mockRestore();
  });

  it('skips discovery inside initializeOAuthForServer when the 401 flow already supplied scopes', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await initializeOAuthForServer(
      'pcloud',
      {
        url: 'https://mcp.pcloud.com/mcp',
        oauth: { dynamicRegistration: { enabled: true, issuer: 'https://mcp.pcloud.com' } },
      } as any,
      'https://mcp.pcloud.com',
      [],
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockDynamicClientRegistration).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ scope: '' }),
      expect.any(Function),
      expect.any(Object),
    );

    fetchSpy.mockRestore();
  });
});
