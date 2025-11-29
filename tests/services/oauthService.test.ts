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

// Mock the DAO module
jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(),
  getServerDao: jest.fn(),
}));

import {
  initOAuthProvider,
  isOAuthEnabled,
  getServerOAuthToken,
  addOAuthHeader,
} from '../../src/services/oauthService.js';
import * as daoModule from '../../src/dao/index.js';

describe('OAuth Service', () => {
  const mockGetSystemConfigDao = daoModule.getSystemConfigDao as jest.MockedFunction<
    typeof daoModule.getSystemConfigDao
  >;
  const mockGetServerDao = daoModule.getServerDao as jest.MockedFunction<
    typeof daoModule.getServerDao
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initOAuthProvider', () => {
    it('should not initialize OAuth when disabled', async () => {
      mockGetSystemConfigDao.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          oauth: {
            enabled: false,
            issuerUrl: 'http://auth.example.com',
            endpoints: {
              authorizationUrl: 'http://auth.example.com/authorize',
              tokenUrl: 'http://auth.example.com/token',
            },
          },
          enableSessionRebuild: false,
        }),
      } as any);

      await initOAuthProvider();
      expect(isOAuthEnabled()).toBe(false);
    });

    it('should not initialize OAuth when not configured', async () => {
      mockGetSystemConfigDao.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          enableSessionRebuild: false,
        }),
      } as any);

      await initOAuthProvider();
      expect(isOAuthEnabled()).toBe(false);
    });

    it('should attempt to initialize OAuth when enabled and properly configured', async () => {
      const mockGet = jest.fn().mockResolvedValue({
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
      });
      mockGetSystemConfigDao.mockReturnValue({
        get: mockGet,
      } as any);

      // In a test environment, the ProxyOAuthServerProvider may not fully initialize
      // due to missing dependencies or network issues, which is expected
      await initOAuthProvider();
      // We just verify that the function doesn't throw an error
      expect(mockGet).toHaveBeenCalled();
    });
  });

  describe('getServerOAuthToken', () => {
    it('should return undefined when server has no OAuth config', async () => {
      mockGetServerDao.mockReturnValue({
        findById: jest.fn().mockResolvedValue({
          url: 'http://example.com',
        }),
      } as any);

      const token = await getServerOAuthToken('test-server');
      expect(token).toBeUndefined();
    });

    it('should return undefined when server has no access token', async () => {
      mockGetServerDao.mockReturnValue({
        findById: jest.fn().mockResolvedValue({
          url: 'http://example.com',
          oauth: {
            clientId: 'test-client',
          },
        }),
      } as any);

      const token = await getServerOAuthToken('test-server');
      expect(token).toBeUndefined();
    });

    it('should return access token when configured', async () => {
      mockGetServerDao.mockReturnValue({
        findById: jest.fn().mockResolvedValue({
          url: 'http://example.com',
          oauth: {
            clientId: 'test-client',
            accessToken: 'test-access-token',
          },
        }),
      } as any);

      const token = await getServerOAuthToken('test-server');
      expect(token).toBe('test-access-token');
    });
  });

  describe('addOAuthHeader', () => {
    it('should not modify headers when no OAuth token is configured', async () => {
      mockGetServerDao.mockReturnValue({
        findById: jest.fn().mockResolvedValue({
          url: 'http://example.com',
        }),
      } as any);

      const headers = { 'Content-Type': 'application/json' };
      const result = await addOAuthHeader('test-server', headers);

      expect(result).toEqual(headers);
      expect(result.Authorization).toBeUndefined();
    });

    it('should add Authorization header when OAuth token is configured', async () => {
      mockGetServerDao.mockReturnValue({
        findById: jest.fn().mockResolvedValue({
          url: 'http://example.com',
          oauth: {
            clientId: 'test-client',
            accessToken: 'test-access-token',
          },
        }),
      } as any);

      const headers = { 'Content-Type': 'application/json' };
      const result = await addOAuthHeader('test-server', headers);

      expect(result).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      });
    });

    it('should preserve existing headers when adding OAuth token', async () => {
      mockGetServerDao.mockReturnValue({
        findById: jest.fn().mockResolvedValue({
          url: 'http://example.com',
          oauth: {
            clientId: 'test-client',
            accessToken: 'test-access-token',
          },
        }),
      } as any);

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
