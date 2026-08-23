// Regression tests for GHSA-3m7m-37xf-xp9x: OAuth authorization server must
// authenticate confidential clients and require PKCE S256 for public clients.

jest.mock('@node-oauth/oauth2-server', () => {
  const actual = jest.requireActual('@node-oauth/oauth2-server');
  return { ...actual };
});

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn().mockResolvedValue({}) })),
  getBearerKeyDao: jest.fn(),
}));

jest.mock('../../src/models/User.js', () => ({
  findUserByUsername: jest.fn(),
  verifyPassword: jest.fn(),
}));

const mockFindOAuthClientById = jest.fn();
const mockSaveAuthorizationCode = jest.fn();
const mockGetAuthorizationCode = jest.fn();
const mockRevokeAuthorizationCode = jest.fn();
const mockSaveToken = jest.fn();
const mockGetToken = jest.fn();
const mockRevokeToken = jest.fn();

jest.mock('../../src/models/OAuth.js', () => ({
  findOAuthClientById: (...args: unknown[]) => mockFindOAuthClientById(...args),
  saveAuthorizationCode: (...args: unknown[]) => mockSaveAuthorizationCode(...args),
  getAuthorizationCode: (...args: unknown[]) => mockGetAuthorizationCode(...args),
  revokeAuthorizationCode: (...args: unknown[]) => mockRevokeAuthorizationCode(...args),
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
  getToken: (...args: unknown[]) => mockGetToken(...args),
  revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
}));

import { getOAuthModel } from '../../src/services/oauthServerService.js';

const confidentialClient = {
  clientId: 'conf-client',
  clientSecret: 'top-secret',
  redirectUris: ['https://app.example/cb'],
  grants: ['authorization_code', 'refresh_token'],
};
const publicClient = {
  clientId: 'pub-client',
  clientSecret: undefined,
  redirectUris: ['https://app.example/cb'],
  grants: ['authorization_code'],
};

describe('oauthModel.getClient enforces per-client authentication (GHSA-3m7m)', () => {
  const model = getOAuthModel();

  it('rejects a confidential client when no secret is presented', async () => {
    mockFindOAuthClientById.mockResolvedValue(confidentialClient);
    await expect(model.getClient('conf-client')).resolves.toBe(false);
  });

  it('rejects a confidential client with a wrong secret', async () => {
    mockFindOAuthClientById.mockResolvedValue(confidentialClient);
    await expect(model.getClient('conf-client', 'wrong')).resolves.toBe(false);
  });

  it('accepts a confidential client with the correct secret', async () => {
    mockFindOAuthClientById.mockResolvedValue(confidentialClient);
    const result = await model.getClient('conf-client', 'top-secret');
    expect(result).not.toBe(false);
    expect((result as { clientId: string }).clientId).toBe('conf-client');
  });

  it('still accepts a public (secret-less) client without a secret', async () => {
    mockFindOAuthClientById.mockResolvedValue(publicClient);
    const result = await model.getClient('pub-client');
    expect(result).not.toBe(false);
  });
});

describe('oauthModel.saveAuthorizationCode requires PKCE S256 for public clients (GHSA-3m7m)', () => {
  const model = getOAuthModel();

  const baseCode = {
    redirectUri: 'https://app.example/cb',
    scope: ['read'],
    codeChallenge: undefined as string | undefined,
    codeChallengeMethod: undefined as string | undefined,
  };
  const user = { username: 'alice' };

  beforeEach(() => {
    mockSaveAuthorizationCode.mockReset();
    mockSaveAuthorizationCode.mockReturnValue({ code: 'abc' });
  });

  it('rejects a public client authorization code without a challenge', async () => {
    const client = { id: 'pub-client', clientId: 'pub-client' } as never;
    await expect(
      model.saveAuthorizationCode(baseCode as never, client, user as never),
    ).rejects.toThrow(/PKCE/i);
    expect(mockSaveAuthorizationCode).not.toHaveBeenCalled();
  });

  it('rejects a public client using the plain challenge method', async () => {
    const client = { id: 'pub-client', clientId: 'pub-client' } as never;
    await expect(
      model.saveAuthorizationCode(
        { ...baseCode, codeChallenge: 'abc', codeChallengeMethod: 'plain' } as never,
        client,
        user as never,
      ),
    ).rejects.toThrow(/S256/i);
    expect(mockSaveAuthorizationCode).not.toHaveBeenCalled();
  });

  it('accepts a public client with an S256 challenge', async () => {
    const client = { id: 'pub-client', clientId: 'pub-client' } as never;
    await expect(
      model.saveAuthorizationCode(
        { ...baseCode, codeChallenge: 'abc', codeChallengeMethod: 'S256' } as never,
        client,
        user as never,
      ),
    ).resolves.toBeDefined();
    expect(mockSaveAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it('does not require PKCE for confidential clients (backwards compatible)', async () => {
    const client = {
      id: 'conf-client',
      clientId: 'conf-client',
      clientSecret: 'top-secret',
    } as never;
    await expect(
      model.saveAuthorizationCode(baseCode as never, client, user as never),
    ).resolves.toBeDefined();
    expect(mockSaveAuthorizationCode).toHaveBeenCalledTimes(1);
  });
});
