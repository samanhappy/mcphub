// Mock openid-client before importing the service
const mockDynamicClientRegistration = jest.fn();

jest.mock('openid-client', () => ({
  discovery: jest.fn(),
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
}));

import { getSystemConfigDao } from '../../src/dao/index.js';
import { registerClient } from '../../src/services/oauthClientRegistration.js';

describe('registerClient redirect URI handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    await registerClient(
      'notion',
      {
        url: 'https://mcp.notion.com/mcp',
        oauth: {
          redirectUri: 'https://custom.example.com/oauth/callback',
          dynamicRegistration: {
            enabled: true,
            issuer: 'https://issuer.example.com',
          },
        },
      } as any,
    );

    expect(mockDynamicClientRegistration).toHaveBeenCalledWith(
      new URL('https://issuer.example.com'),
      expect.objectContaining({
        redirect_uris: [
          'https://custom.example.com/oauth/callback',
          'https://base.example.com/oauth/callback',
        ],
      }),
      expect.any(Function),
    );
  });
});
