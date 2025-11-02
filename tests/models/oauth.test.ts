import {
  createOAuthClient,
  findOAuthClientById,
  updateOAuthClient,
  deleteOAuthClient,
  saveAuthorizationCode,
  getAuthorizationCode,
  revokeAuthorizationCode,
  saveToken,
  getToken,
  revokeToken,
} from '../../src/models/OAuth.js';

// Mock the config module to use in-memory storage for tests
let mockSettings = { mcpServers: {}, users: [], oauthClients: [] };

jest.mock('../../src/config/index.js', () => ({
  loadSettings: jest.fn(() => ({ ...mockSettings })),
  saveSettings: jest.fn((settings: any) => {
    mockSettings = { ...settings };
    return true;
  }),
  loadOriginalSettings: jest.fn(() => ({ ...mockSettings })),
}));

describe('OAuth Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock settings before each test
    mockSettings = { mcpServers: {}, users: [], oauthClients: [] };
  });

  describe('OAuth Client Management', () => {
    test('should create a new OAuth client', () => {
      const client = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grants: ['authorization_code', 'refresh_token'],
        scopes: ['read', 'write'],
      };

      const created = createOAuthClient(client);
      expect(created).toEqual(client);

      const found = findOAuthClientById('test-client');
      expect(found).toEqual(client);
    });

    test('should not create duplicate OAuth client', () => {
      const client = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grants: ['authorization_code'],
        scopes: ['read'],
      };

      createOAuthClient(client);
      expect(() => createOAuthClient(client)).toThrow();
    });

    test('should update an OAuth client', () => {
      const client = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grants: ['authorization_code'],
        scopes: ['read'],
      };

      createOAuthClient(client);

      const updated = updateOAuthClient('test-client', {
        name: 'Updated Client',
        scopes: ['read', 'write'],
      });

      expect(updated?.name).toBe('Updated Client');
      expect(updated?.scopes).toEqual(['read', 'write']);
    });

    test('should delete an OAuth client', () => {
      const client = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grants: ['authorization_code'],
        scopes: ['read'],
      };

      createOAuthClient(client);
      expect(findOAuthClientById('test-client')).toBeDefined();

      const deleted = deleteOAuthClient('test-client');
      expect(deleted).toBe(true);
      expect(findOAuthClientById('test-client')).toBeUndefined();
    });
  });

  describe('Authorization Code Management', () => {
    test('should save and retrieve authorization code', () => {
      const code = saveAuthorizationCode({
        redirectUri: 'http://localhost:3000/callback',
        scope: 'read write',
        clientId: 'test-client',
        username: 'testuser',
        codeChallenge: 'test-challenge',
        codeChallengeMethod: 'S256',
      });

      expect(code).toBeDefined();
      expect(typeof code).toBe('string');

      const retrieved = getAuthorizationCode(code);
      expect(retrieved).toBeDefined();
      expect(retrieved?.redirectUri).toBe('http://localhost:3000/callback');
      expect(retrieved?.clientId).toBe('test-client');
      expect(retrieved?.username).toBe('testuser');
    });

    test('should not retrieve expired authorization code', async () => {
      const code = saveAuthorizationCode(
        {
          redirectUri: 'http://localhost:3000/callback',
          scope: 'read',
          clientId: 'test-client',
          username: 'testuser',
        },
        -1, // Expired
      );

      // Wait a bit to ensure expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      const retrieved = getAuthorizationCode(code);
      expect(retrieved).toBeUndefined();
    });

    test('should revoke authorization code', () => {
      const code = saveAuthorizationCode({
        redirectUri: 'http://localhost:3000/callback',
        scope: 'read',
        clientId: 'test-client',
        username: 'testuser',
      });

      expect(getAuthorizationCode(code)).toBeDefined();

      revokeAuthorizationCode(code);
      expect(getAuthorizationCode(code)).toBeUndefined();
    });
  });

  describe('Token Management', () => {
    test('should save and retrieve token', () => {
      const token = saveToken(
        {
          scope: 'read write',
          clientId: 'test-client',
          username: 'testuser',
        },
        3600, // accessTokenLifetime
        86400, // refreshTokenLifetime
      );

      expect(token.accessToken).toBeDefined();
      expect(token.refreshToken).toBeDefined();
      expect(token.accessTokenExpiresAt).toBeInstanceOf(Date);

      const retrieved = getToken(token.accessToken);
      expect(retrieved).toBeDefined();
      expect(retrieved?.clientId).toBe('test-client');
      expect(retrieved?.username).toBe('testuser');
    });

    test('should retrieve token by refresh token', () => {
      const token = saveToken(
        {
          scope: 'read',
          clientId: 'test-client',
          username: 'testuser',
        },
        3600,
        86400,
      );

      expect(token.refreshToken).toBeDefined();

      const retrieved = getToken(token.refreshToken!);
      expect(retrieved).toBeDefined();
      expect(retrieved?.accessToken).toBe(token.accessToken);
    });

    test('should not retrieve expired access token', async () => {
      const token = saveToken(
        {
          scope: 'read',
          clientId: 'test-client',
          username: 'testuser',
        },
        -1, // Expired
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const retrieved = getToken(token.accessToken);
      expect(retrieved).toBeUndefined();
    });

    test('should revoke token', () => {
      const token = saveToken(
        {
          scope: 'read',
          clientId: 'test-client',
          username: 'testuser',
        },
        3600,
        86400,
      );

      expect(getToken(token.accessToken)).toBeDefined();

      revokeToken(token.accessToken);
      expect(getToken(token.accessToken)).toBeUndefined();

      if (token.refreshToken) {
        expect(getToken(token.refreshToken)).toBeUndefined();
      }
    });
  });
});
