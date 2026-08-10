import { Request } from 'express';

const mockFindBySsoUserId = jest.fn();
const mockFindByEmail = jest.fn();
const mockFindByUsername = jest.fn();
const mockUpdate = jest.fn();
const mockCreateWithHashedPassword = jest.fn();
const mockSessionGet = jest.fn();
const mockGetAccessToken = jest.fn();
const originalFetch = global.fetch;

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: jest.fn(() => ({
    findBySsoUserId: mockFindBySsoUserId,
    findByEmail: mockFindByEmail,
    findByUsername: mockFindByUsername,
    update: mockUpdate,
    createWithHashedPassword: mockCreateWithHashedPassword,
  })),
}));

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(() =>
    Promise.resolve({
      enabled: true,
      disableAutoCreate: false,
      providers: { oidc: { enabled: true, providerId: 'authentik' } },
    }),
  ),
}));

jest.mock('../../src/betterAuth.js', () => ({
  auth: { api: { getSession: mockSessionGet, getAccessToken: mockGetAccessToken } },
}));

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn((h: any) => h),
}));

import { resolveBetterAuthUser } from '../../src/services/betterAuthSession.js';

const makeReq = () => ({ headers: { authorization: 'Bearer token' } }) as unknown as Request;

describe('resolveBetterAuthUser', () => {
  beforeEach(() => {
    mockFindBySsoUserId.mockReset();
    mockFindByEmail.mockReset();
    mockFindByUsername.mockReset();
    mockUpdate.mockReset();
    mockCreateWithHashedPassword.mockReset();
    mockSessionGet.mockReset();
    mockGetAccessToken.mockReset();
    const configMod = jest.requireMock('../../src/services/betterAuthConfig.js');
    configMod.getBetterAuthRuntimeConfig.mockResolvedValue({
      enabled: true,
      disableAutoCreate: false,
      providers: {
        oidc: {
          enabled: true,
          providerId: 'authentik',
          discoveryUrl: 'https://auth.example.de/.well-known/openid-configuration',
        },
      },
    });
    mockGetAccessToken.mockResolvedValue({ idToken: undefined, accessToken: undefined });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null when no Better Auth session exists', async () => {
    mockSessionGet.mockResolvedValue(null);
    await expect(resolveBetterAuthUser(makeReq())).resolves.toBeNull();
  });

  it('matches user by ssoUserId first', async () => {
    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-123', email: 'test@example.com', name: 'Test' },
    });
    mockFindBySsoUserId.mockResolvedValue({
      username: 'testuser',
      email: 'test@example.com',
      ssoUserId: 'ba-123',
      isAdmin: false,
    });

    const result = await resolveBetterAuthUser(makeReq());

    expect(result?.username).toBe('testuser');
    expect(mockFindBySsoUserId).toHaveBeenCalledWith('ba-123');
    expect(mockFindByEmail).not.toHaveBeenCalled();
    expect(mockFindByUsername).not.toHaveBeenCalled();
  });

  it('backfills email on ssoUserId match', async () => {
    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-123', email: 'new@example.com', name: 'Test' },
    });
    mockFindBySsoUserId.mockResolvedValue({
      username: 'testuser',
      email: undefined,
      ssoUserId: 'ba-123',
      isAdmin: false,
    });
    mockUpdate.mockResolvedValue({});

    await resolveBetterAuthUser(makeReq());
    expect(mockUpdate).toHaveBeenCalledWith('testuser', { email: 'new@example.com' });
  });

  it('falls back to email match and backfills ssoUserId', async () => {
    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-456', email: 'legacy@example.com', name: 'Legacy' },
    });
    mockFindBySsoUserId.mockResolvedValue(undefined);
    mockFindByEmail.mockResolvedValue({
      username: 'legacy@example.com',
      email: 'legacy@example.com',
      ssoUserId: undefined,
      isAdmin: false,
    });
    mockUpdate.mockResolvedValue({});

    const result = await resolveBetterAuthUser(makeReq());

    expect(result?.username).toBe('legacy@example.com');
    expect(mockUpdate).toHaveBeenCalledWith('legacy@example.com', { ssoUserId: 'ba-456' });
  });

  it('falls back to username match when no sso/email match exists', async () => {
    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-789', email: 'old@example.com', name: 'Old' },
    });
    mockFindBySsoUserId.mockResolvedValue(undefined);
    mockFindByEmail.mockResolvedValue(undefined);
    mockFindByUsername.mockResolvedValue({
      username: 'old@example.com',
      email: undefined,
      ssoUserId: undefined,
      isAdmin: false,
    });
    mockUpdate.mockResolvedValue({});

    const result = await resolveBetterAuthUser(makeReq());

    expect(result?.username).toBe('old@example.com');
    expect(mockUpdate).toHaveBeenCalledWith('old@example.com', {
      ssoUserId: 'ba-789',
      email: 'old@example.com',
    });
  });

  it('creates a new user when no match exists', async () => {
    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-new', email: 'new@example.com', name: 'New' },
    });
    mockFindBySsoUserId.mockResolvedValue(undefined);
    mockFindByEmail.mockResolvedValue(undefined);
    mockFindByUsername.mockResolvedValue(undefined);
    mockCreateWithHashedPassword.mockResolvedValue({
      username: 'new@example.com',
      email: 'new@example.com',
      ssoUserId: 'ba-new',
      isAdmin: false,
    });

    await resolveBetterAuthUser(makeReq());

    expect(mockCreateWithHashedPassword).toHaveBeenCalledWith(
      'new@example.com',
      expect.any(String),
      false,
      'new@example.com',
      'ba-new',
    );
  });

  it('maps entitlement isAdmin to local isAdmin', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iss: 'https://auth.example.de', sub: '12345', entitlements: ['isAdmin'] }),
    ).toString('base64url');
    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-admin', email: 'admin@example.com', name: 'Admin User' },
    });
    mockGetAccessToken.mockResolvedValue({
      idToken: `${header}.${payload}.signature`,
      accessToken: 'access-token',
    });
    mockFindBySsoUserId.mockResolvedValue({
      username: 'admin-user',
      email: 'admin@example.com',
      isAdmin: false,
      ssoUserId: 'ba-admin',
    });

    const result = await resolveBetterAuthUser(makeReq());
    expect(result?.isAdmin).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith('admin-user', expect.objectContaining({ isAdmin: true }));
  });

  it('maps boolean isAdmin claim to local isAdmin', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iss: 'https://auth.example.de', sub: '12345', isAdmin: true }),
    ).toString('base64url');
    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-admin', email: 'admin@example.com', name: 'Admin User' },
    });
    mockGetAccessToken.mockResolvedValue({
      idToken: `${header}.${payload}.signature`,
      accessToken: 'access-token',
    });
    mockFindBySsoUserId.mockResolvedValue({
      username: 'admin-user',
      email: 'admin@example.com',
      isAdmin: false,
      ssoUserId: 'ba-admin',
    });

    const result = await resolveBetterAuthUser(makeReq());
    expect(result?.isAdmin).toBe(true);
  });

  it('returns null when auto-create is disabled and user does not exist', async () => {
    const configMod = jest.requireMock('../../src/services/betterAuthConfig.js');
    configMod.getBetterAuthRuntimeConfig.mockResolvedValue({
      enabled: true,
      disableAutoCreate: true,
      providers: {
        oidc: {
          enabled: true,
          providerId: 'authentik',
          discoveryUrl: 'https://auth.example.de/.well-known/openid-configuration',
        },
      },
    });

    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-x', email: 'x@x.com', name: 'X' },
    });
    mockFindBySsoUserId.mockResolvedValue(undefined);
    mockFindByEmail.mockResolvedValue(undefined);
    mockFindByUsername.mockResolvedValue(undefined);

    const result = await resolveBetterAuthUser(makeReq());
    expect(result).toBeNull();
    expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
  });

  it('maps isAdmin entitlement from userinfo when token claims do not include it', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iss: 'https://auth.example.de', sub: '12345' }),
    ).toString('base64url');
    mockSessionGet.mockResolvedValue({
      user: { id: 'ba-admin', email: 'admin@example.com', name: 'Admin User' },
    });
    mockGetAccessToken.mockResolvedValue({
      idToken: `${header}.${payload}.signature`,
      accessToken: `${header}.${payload}.signature`,
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          userinfo_endpoint: 'https://auth.example.de/application/o/userinfo/',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entitlements: ['isAdmin'],
        }),
      });
    mockFindBySsoUserId.mockResolvedValue({
      username: 'admin-user',
      email: 'admin@example.com',
      isAdmin: false,
      ssoUserId: 'ba-admin',
    });

    const result = await resolveBetterAuthUser(makeReq());

    expect(result?.isAdmin).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith('admin-user', expect.objectContaining({ isAdmin: true }));
  });
});
