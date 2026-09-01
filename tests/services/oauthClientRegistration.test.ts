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

import { getSystemConfigDao } from '../../src/dao/index.js';
import {
  fetchProtectedResourceMetadata,
  initializeOAuthForServer,
  registerClient,
  removeRegisteredClient,
} from '../../src/services/oauthClientRegistration.js';
import { UnsafeUrlError } from '../../src/utils/ssrf.js';

describe('registerClient redirect URI handling', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
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
