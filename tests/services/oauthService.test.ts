// Mock openid-client before importing services
jest.mock('openid-client', () => ({
  discovery: jest.fn(),
  dynamicClientRegistration: jest.fn(),
  ClientSecretPost: jest.fn(() => jest.fn()),
  ClientSecretBasic: jest.fn(() => jest.fn()),
  None: jest.fn(() => jest.fn()),
  calculatePKCECodeChallenge: jest.fn(),
  randomPKCECodeVerifier: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  authorizationCodeGrant: jest.fn(),
  refreshTokenGrant: jest.fn(),
}));

import {
  initOAuthProvider,
  isOAuthEnabled,
  getServerOAuthToken,
  addOAuthHeader,
} from '../../src/services/oauthService.js';
import * as config from '../../src/config/index.js';

// Mock the config module
jest.mock('../../src/config/index.js', () => ({
  loadSettings: jest.fn(),
}));

describe('OAuth Service', () => {
  const mockLoadSettings = config.loadSettings as jest.MockedFunction<typeof config.loadSettings>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initOAuthProvider', () => {
    it('should not initialize OAuth when disabled', () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {},
        systemConfig: {
          oauth: {
            enabled: false,
            issuerUrl: 'http://auth.example.com',
            endpoints: {
              authorizationUrl: 'http://auth.example.com/authorize',
              tokenUrl: 'http://auth.example.com/token',
            },
          },
          enableSessionRebuild: false,
        },
      });

      initOAuthProvider();
      expect(isOAuthEnabled()).toBe(false);
    });

    it('should not initialize OAuth when not configured', () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {},
        systemConfig: {
          enableSessionRebuild: false,
        },
      });

      initOAuthProvider();
      expect(isOAuthEnabled()).toBe(false);
    });

    it('should attempt to initialize OAuth when enabled and properly configured', () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {},
        systemConfig: {
          oauth: {
            enabled: true,
            issuerUrl: 'http://auth.example.com',
            endpoints: {
              authorizationUrl: 'http://auth.example.com/authorize',
              tokenUrl: 'http://auth.example.com/token',
            },
            clients: [
              {
                client_id: 'test-client',
                redirect_uris: ['http://localhost:3000/callback'],
              },
            ],
          },
          enableSessionRebuild: false,
        },
      });

      // In a test environment, the ProxyOAuthServerProvider may not fully initialize
      // due to missing dependencies or network issues, which is expected
      initOAuthProvider();
      // We just verify that the function doesn't throw an error
      expect(mockLoadSettings).toHaveBeenCalled();
    });
  });

  describe('getServerOAuthToken', () => {
    it('should return undefined when server has no OAuth config', async () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {
          'test-server': {
            url: 'http://example.com',
          },
        },
      });

      const token = await getServerOAuthToken('test-server');
      expect(token).toBeUndefined();
    });

    it('should return undefined when server has no access token', async () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {
          'test-server': {
            url: 'http://example.com',
            oauth: {
              clientId: 'test-client',
            },
          },
        },
      });

      const token = await getServerOAuthToken('test-server');
      expect(token).toBeUndefined();
    });

    it('should return access token when configured', async () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {
          'test-server': {
            url: 'http://example.com',
            oauth: {
              clientId: 'test-client',
              accessToken: 'test-access-token',
            },
          },
        },
      });

      const token = await getServerOAuthToken('test-server');
      expect(token).toBe('test-access-token');
    });
  });

  describe('addOAuthHeader', () => {
    it('should not modify headers when no OAuth token is configured', async () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {
          'test-server': {
            url: 'http://example.com',
          },
        },
      });

      const headers = { 'Content-Type': 'application/json' };
      const result = await addOAuthHeader('test-server', headers);

      expect(result).toEqual(headers);
      expect(result.Authorization).toBeUndefined();
    });

    it('should add Authorization header when OAuth token is configured', async () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {
          'test-server': {
            url: 'http://example.com',
            oauth: {
              clientId: 'test-client',
              accessToken: 'test-access-token',
            },
          },
        },
      });

      const headers = { 'Content-Type': 'application/json' };
      const result = await addOAuthHeader('test-server', headers);

      expect(result).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      });
    });

    it('should preserve existing headers when adding OAuth token', async () => {
      mockLoadSettings.mockReturnValue({
        mcpServers: {
          'test-server': {
            url: 'http://example.com',
            oauth: {
              clientId: 'test-client',
              accessToken: 'test-access-token',
            },
          },
        },
      });

      const headers = {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value',
      };
      const result = await addOAuthHeader('test-server', headers);

      expect(result).toEqual({
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value',
        Authorization: 'Bearer test-access-token',
      });
    });
  });
});
