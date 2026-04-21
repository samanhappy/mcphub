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
import { MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';

describe('MCPHubOAuthProvider redirect URI resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
