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
import { IOAuthClient, IOAuthToken } from '../../src/types/index.js';

// Mock in-memory storage for OAuth clients and tokens
let mockOAuthClients: IOAuthClient[] = [];
let mockOAuthTokens: IOAuthToken[] = [];

// Mock the DAO factory to use in-memory storage for tests
jest.mock('../../src/dao/index.js', () => {
  const originalModule = jest.requireActual('../../src/dao/index.js');

  return {
    ...originalModule,
    getOAuthClientDao: jest.fn(() => ({
      findAll: jest.fn(async () => [...mockOAuthClients]),
      findByClientId: jest.fn(
        async (clientId: string) => mockOAuthClients.find((c) => c.clientId === clientId) || null,
      ),
      create: jest.fn(async (client: IOAuthClient) => {
        mockOAuthClients.push(client);
        return client;
      }),
      update: jest.fn(async (clientId: string, updates: Partial<IOAuthClient>) => {
        const index = mockOAuthClients.findIndex((c) => c.clientId === clientId);
        if (index === -1) return null;
        mockOAuthClients[index] = { ...mockOAuthClients[index], ...updates };
        return mockOAuthClients[index];
      }),
      delete: jest.fn(async (clientId: string) => {
        const index = mockOAuthClients.findIndex((c) => c.clientId === clientId);
        if (index === -1) return false;
        mockOAuthClients.splice(index, 1);
        return true;
      }),
    })),
    getOAuthTokenDao: jest.fn(() => ({
      findAll: jest.fn(async () => [...mockOAuthTokens]),
      findByAccessToken: jest.fn(
        async (accessToken: string) =>
          mockOAuthTokens.find((t) => t.accessToken === accessToken) || null,
      ),
      findByRefreshToken: jest.fn(
        async (refreshToken: string) =>
          mockOAuthTokens.find((t) => t.refreshToken === refreshToken) || null,
      ),
      create: jest.fn(async (token: IOAuthToken) => {
        mockOAuthTokens.push(token);
        return token;
      }),
      revokeToken: jest.fn(async (token: string) => {
        const index = mockOAuthTokens.findIndex(
          (t) => t.accessToken === token || t.refreshToken === token,
        );
        if (index === -1) return false;
        mockOAuthTokens.splice(index, 1);
        return true;
      }),
      cleanupExpired: jest.fn(async () => {
        const now = new Date();
        mockOAuthTokens = mockOAuthTokens.filter((t) => {
          const accessExpired = t.accessTokenExpiresAt < now;
          const refreshExpired =
            !t.refreshToken || (t.refreshTokenExpiresAt && t.refreshTokenExpiresAt < now);
          return !accessExpired || !refreshExpired;
        });
      }),
    })),
  };
});

describe('OAuth Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock storage before each test
    mockOAuthClients = [];
    mockOAuthTokens = [];
  });

  describe('OAuth Client Management', () => {
    test('should create a new OAuth client', async () => {
      const client: IOAuthClient = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grants: ['authorization_code', 'refresh_token'],
        scopes: ['read', 'write'],
      };

      const created = await createOAuthClient(client);
      expect(created).toEqual(client);

      const found = await findOAuthClientById('test-client');
      expect(found).toEqual(client);
    });

    test('should not create duplicate OAuth client', async () => {
      const client: IOAuthClient = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grants: ['authorization_code'],
        scopes: ['read'],
      };

      await createOAuthClient(client);
      await expect(createOAuthClient(client)).rejects.toThrow();
    });

    test('should update an OAuth client', async () => {
      const client: IOAuthClient = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grants: ['authorization_code'],
        scopes: ['read'],
      };

      await createOAuthClient(client);

      const updated = await updateOAuthClient('test-client', {
        name: 'Updated Client',
        scopes: ['read', 'write'],
      });

      expect(updated?.name).toBe('Updated Client');
      expect(updated?.scopes).toEqual(['read', 'write']);
    });

    test('should delete an OAuth client', async () => {
      const client: IOAuthClient = {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grants: ['authorization_code'],
        scopes: ['read'],
      };

      await createOAuthClient(client);
      expect(await findOAuthClientById('test-client')).toBeDefined();

      const deleted = await deleteOAuthClient('test-client');
      expect(deleted).toBe(true);
      expect(await findOAuthClientById('test-client')).toBeUndefined();
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
    test('should save and retrieve token', async () => {
      const token = await saveToken(
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

      const retrieved = await getToken(token.accessToken);
      expect(retrieved).toBeDefined();
      expect(retrieved?.clientId).toBe('test-client');
      expect(retrieved?.username).toBe('testuser');
    });

    test('should retrieve token by refresh token', async () => {
      const token = await saveToken(
        {
          scope: 'read',
          clientId: 'test-client',
          username: 'testuser',
        },
        3600,
        86400,
      );

      expect(token.refreshToken).toBeDefined();

      const retrieved = await getToken(token.refreshToken!);
      expect(retrieved).toBeDefined();
      expect(retrieved?.accessToken).toBe(token.accessToken);
    });

    test('should not retrieve expired access token', async () => {
      const token = await saveToken(
        {
          scope: 'read',
          clientId: 'test-client',
          username: 'testuser',
        },
        -1, // Expired
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const retrieved = await getToken(token.accessToken);
      expect(retrieved).toBeUndefined();
    });

    test('should revoke token', async () => {
      const token = await saveToken(
        {
          scope: 'read',
          clientId: 'test-client',
          username: 'testuser',
        },
        3600,
        86400,
      );

      expect(await getToken(token.accessToken)).toBeDefined();

      await revokeToken(token.accessToken);
      expect(await getToken(token.accessToken)).toBeUndefined();

      if (token.refreshToken) {
        expect(await getToken(token.refreshToken)).toBeUndefined();
      }
    });
  });
});
