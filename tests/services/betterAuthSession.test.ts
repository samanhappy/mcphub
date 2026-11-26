import { Request } from 'express';

// ── Mock DAO layer ────────────────────────────────────────────────
const mockFindBySsoUserId = jest.fn();
const mockFindByEmail = jest.fn();
const mockFindByUsername = jest.fn();
const mockUpdate = jest.fn();
const mockCreateWithHashedPassword = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: jest.fn(() => ({
    findBySsoUserId: mockFindBySsoUserId,
    findByEmail: mockFindByEmail,
    findByUsername: mockFindByUsername,
    update: mockUpdate,
    createWithHashedPassword: mockCreateWithHashedPassword,
  })),
}));

// ── Mock Better Auth runtime config ──────────────────────────────
const mockGetBetterAuthRuntimeConfig = jest.fn();
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: (...args: any[]) => mockGetBetterAuthRuntimeConfig(...args),
}));

// ── Mock Better Auth modules (used by getBetterAuthSession) ──────
const mockSessionGet = jest.fn();
jest.mock('../../src/betterAuth.js', () => ({
  auth: { api: { getSession: mockSessionGet } },
}));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn((h: any) => h),
}));

import { resolveBetterAuthUser } from '../../src/services/betterAuthSession.js';

const makeReq = () => ({ headers: { authorization: 'Bearer test' } }) as unknown as Request;

describe('resolveBetterAuthUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBetterAuthRuntimeConfig.mockResolvedValue({
      enabled: true,
      disableAutoCreate: false,
    });
  });

  // ── Strict ssoUserId match ───────────────────────────────────

  describe('strict ssoUserId match', () => {
    it('should match user by ssoUserId and return immediately', async () => {
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

      expect(result).not.toBeNull();
      expect(result!.username).toBe('testuser');
      expect(mockFindBySsoUserId).toHaveBeenCalledWith('ba-123');
      expect(mockFindByEmail).not.toHaveBeenCalled();
      expect(mockFindByUsername).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should backfill email when ssoUserId match has no email', async () => {
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

      const result = await resolveBetterAuthUser(makeReq());

      expect(result!.username).toBe('testuser');
      expect(mockUpdate).toHaveBeenCalledWith('testuser', { email: 'new@example.com' });
    });

    it('should not attempt email backfill when session has no email', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-123', email: undefined, name: 'Test' },
      });
      mockFindBySsoUserId.mockResolvedValue({
        username: 'testuser',
        email: undefined,
        ssoUserId: 'ba-123',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result!.username).toBe('testuser');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should handle email backfill errors gracefully', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-err', email: 'err@example.com' },
      });
      mockFindBySsoUserId.mockResolvedValue({
        username: 'erruser',
        email: undefined,
        ssoUserId: 'ba-err',
        isAdmin: false,
      });
      mockUpdate.mockRejectedValue(new Error('DB write failed'));

      const result = await resolveBetterAuthUser(makeReq());

      expect(result!.username).toBe('erruser');
    });

    it('should refuse a forward-auth user even if ssoUserId matches', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'forward-auth:abc123', email: 'gw@example.com', name: 'GW' },
      });
      mockFindBySsoUserId.mockResolvedValue({
        username: 'gateway-user',
        email: 'gw@example.com',
        ssoUserId: 'forward-auth:abc123',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });
  });

  // ── Missing or empty ssoUserId ───────────────────────────────

  describe('missing or empty ssoUserId', () => {
    it('should return null when session has no user.id', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: undefined, email: 'admin@example.com', name: 'admin' },
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockFindBySsoUserId).not.toHaveBeenCalled();
      expect(mockFindByEmail).not.toHaveBeenCalled();
      expect(mockFindByUsername).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should return null when session user.id is whitespace only', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: '   ', email: 'user@example.com', name: 'user' },
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockFindBySsoUserId).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });
  });

  // ── Fail-closed collision handling (no account adoption) ─────

  describe('fail-closed collision handling', () => {
    it('should reject when IdP email matches a local admin user without mutating it', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-attacker', email: 'admin@example.com', name: 'Attacker' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue(undefined);
      mockFindByEmail.mockResolvedValue({
        username: 'admin',
        email: 'admin@example.com',
        ssoUserId: undefined,
        isAdmin: true,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should reject when IdP email matches a local regular user without mutating it', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-attacker', email: 'alice@example.com', name: 'Alice' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue(undefined);
      mockFindByEmail.mockResolvedValue({
        username: 'alice',
        email: 'alice@example.com',
        ssoUserId: undefined,
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should reject when IdP email matches an already-bound SSO user', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-provider-b', email: 'shared@example.com', name: 'Shared' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue(undefined);
      mockFindByEmail.mockResolvedValue({
        username: 'shared-user',
        email: 'shared@example.com',
        ssoUserId: 'ba-provider-a',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should reject when IdP email matches a forward-auth user', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-999', email: 'shared@example.com', name: 'Shared' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue(undefined);
      mockFindByEmail.mockResolvedValue({
        username: 'gateway-user',
        email: 'shared@example.com',
        ssoUserId: 'forward-auth:abc123',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should reject when IdP name matches local admin and email is missing', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-attacker', email: undefined, name: 'admin' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue({
        username: 'admin',
        email: undefined,
        ssoUserId: undefined,
        isAdmin: true,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockFindByUsername).toHaveBeenCalledWith('admin');
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should reject when derived username matches a forward-auth user', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-999', email: undefined, name: 'gateway-user' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue({
        username: 'gateway-user',
        email: 'shared@example.com',
        ssoUserId: 'forward-auth:abc123',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should reject when email used as username matches an existing local account', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-new', email: 'legacy@example.com', name: 'Legacy' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue({
        username: 'legacy@example.com',
        email: undefined,
        ssoUserId: undefined,
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockFindByUsername).toHaveBeenCalledWith('legacy@example.com');
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });
  });

  // ── disableAutoCreate ────────────────────────────────────────

  describe('disableAutoCreate', () => {
    it('should reject unbound SSO identity when disableAutoCreate is true', async () => {
      mockGetBetterAuthRuntimeConfig.mockResolvedValue({
        enabled: true,
        disableAutoCreate: true,
      });
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-x', email: 'x@x.com', name: 'X' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockFindByUsername).not.toHaveBeenCalled();
      expect(mockFindByEmail).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should reject unbound SSO identity even when email and name match an existing admin', async () => {
      mockGetBetterAuthRuntimeConfig.mockResolvedValue({
        enabled: true,
        disableAutoCreate: true,
      });
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-attacker', email: 'admin@example.com', name: 'admin' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByEmail.mockResolvedValue({
        username: 'admin',
        email: 'admin@example.com',
        isAdmin: true,
      });
      mockFindByUsername.mockResolvedValue({
        username: 'admin',
        email: 'admin@example.com',
        isAdmin: true,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });

    it('should still allow an already-bound SSO user when disableAutoCreate is true', async () => {
      mockGetBetterAuthRuntimeConfig.mockResolvedValue({
        enabled: true,
        disableAutoCreate: true,
      });
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-bound', email: 'bound@example.com', name: 'Bound' },
      });
      mockFindBySsoUserId.mockResolvedValue({
        username: 'bound@example.com',
        email: 'bound@example.com',
        ssoUserId: 'ba-bound',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).not.toBeNull();
      expect(result!.username).toBe('bound@example.com');
    });
  });

  // ── Auto-creation when no collision exists ───────────────────

  describe('auto-creation', () => {
    it('should create new non-admin user with ssoUserId and email when no collision exists', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-new', email: 'new@example.com', name: 'New' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue(undefined);
      mockFindByEmail.mockResolvedValue(undefined);
      mockCreateWithHashedPassword.mockResolvedValue({
        username: 'new@example.com',
        email: 'new@example.com',
        ssoUserId: 'ba-new',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).not.toBeNull();
      expect(result!.username).toBe('new@example.com');
      expect(result!.ssoUserId).toBe('ba-new');
      expect(result!.isAdmin).toBe(false);
      expect(mockCreateWithHashedPassword).toHaveBeenCalledWith(
        'new@example.com',
        expect.any(String),
        false,
        'new@example.com',
        'ba-new',
      );
    });

    it('should fall back to name as username when email is absent', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-2', email: undefined, name: 'DisplayName' },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue(undefined);
      mockCreateWithHashedPassword.mockResolvedValue({
        username: 'DisplayName',
        ssoUserId: 'ba-2',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).not.toBeNull();
      expect(mockFindByUsername).toHaveBeenCalledWith('DisplayName');
      expect(mockFindByEmail).not.toHaveBeenCalled();
      expect(mockCreateWithHashedPassword).toHaveBeenCalledWith(
        'DisplayName',
        expect.any(String),
        false,
        undefined,
        'ba-2',
      );
    });

    it('should fall back to ssoUserId as username when email and name are absent', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-only-id', email: undefined, name: undefined },
      });
      mockFindBySsoUserId.mockResolvedValue(undefined);
      mockFindByUsername.mockResolvedValue(undefined);
      mockCreateWithHashedPassword.mockResolvedValue({
        username: 'ba-only-id',
        ssoUserId: 'ba-only-id',
        isAdmin: false,
      });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).not.toBeNull();
      expect(mockFindByUsername).toHaveBeenCalledWith('ba-only-id');
      expect(mockCreateWithHashedPassword).toHaveBeenCalledWith(
        'ba-only-id',
        expect.any(String),
        false,
        undefined,
        'ba-only-id',
      );
    });
  });

  // ── Concurrent auto-creation race condition ──────────────────

  describe('concurrent auto-creation race', () => {
    it('should re-query findUserBySsoUserId when createUser loses a race for the same identity', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-race', email: 'race@example.com', name: 'Race' },
      });
      const racedUser = {
        username: 'race@example.com',
        email: 'race@example.com',
        ssoUserId: 'ba-race',
        isAdmin: false,
      };
      mockFindBySsoUserId.mockResolvedValueOnce(undefined).mockResolvedValueOnce(racedUser);
      mockFindByUsername.mockResolvedValue(undefined);
      mockFindByEmail.mockResolvedValue(undefined);
      mockCreateWithHashedPassword.mockRejectedValue({ code: '23505' });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toEqual(racedUser);
      expect(mockFindBySsoUserId).toHaveBeenNthCalledWith(1, 'ba-race');
      expect(mockFindBySsoUserId).toHaveBeenNthCalledWith(2, 'ba-race');
      expect(mockFindByUsername).toHaveBeenCalledTimes(1);
    });

    it('should return null instead of adopting a colliding username when createUser loses a race to another account', async () => {
      mockSessionGet.mockResolvedValue({
        user: { id: 'ba-attacker-race', email: undefined, name: 'admin' },
      });
      mockFindBySsoUserId.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      // First pre-check saw nothing; another request created a local admin right before insert.
      mockFindByUsername.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        username: 'admin',
        ssoUserId: undefined,
        isAdmin: true,
      });
      mockCreateWithHashedPassword.mockRejectedValue({ code: '23505' });

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockFindBySsoUserId).toHaveBeenNthCalledWith(1, 'ba-attacker-race');
      expect(mockFindBySsoUserId).toHaveBeenNthCalledWith(2, 'ba-attacker-race');
      // Never re-queries findByUsername after createUser failure
      expect(mockFindByUsername).toHaveBeenCalledTimes(1);
    });
  });

  // ── Session edge cases ───────────────────────────────────────

  describe('session edge cases', () => {
    it('should return null when no session exists', async () => {
      mockSessionGet.mockResolvedValue(null);

      const result = await resolveBetterAuthUser(makeReq());

      expect(result).toBeNull();
      expect(mockFindBySsoUserId).not.toHaveBeenCalled();
    });
  });
});
