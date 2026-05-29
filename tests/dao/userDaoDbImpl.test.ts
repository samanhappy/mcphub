// ── Mock UserRepository ───────────────────────────────────────────
const mockRepo = {
  findAll: jest.fn(),
  findByUsername: jest.fn(),
  findByEmail: jest.fn(),
  findBySsoUserId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
  count: jest.fn(),
  findAdmins: jest.fn(),
};

jest.mock('../../src/db/repositories/UserRepository.js', () => ({
  UserRepository: jest.fn().mockImplementation(() => mockRepo),
}));

import { UserDaoDbImpl } from '../../src/dao/UserDaoDbImpl.js';

describe('UserDaoDbImpl', () => {
  let dao: UserDaoDbImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    dao = new UserDaoDbImpl();
  });

  const dbUser = (overrides: Record<string, any> = {}) => ({
    id: 'uuid-1',
    username: 'testuser',
    password: 'hashed',
    isAdmin: false,
    email: null,
    ssoUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // ── findBySsoUserId ──────────────────────────────────────────

  describe('findBySsoUserId', () => {
    it('should return mapped user when ssoUserId matches', async () => {
      mockRepo.findBySsoUserId.mockResolvedValue(
        dbUser({ ssoUserId: 'ba-123', email: 'test@example.com' }),
      );

      const result = await dao.findBySsoUserId('ba-123');

      expect(result).not.toBeNull();
      expect(result!.ssoUserId).toBe('ba-123');
      expect(result!.email).toBe('test@example.com');
      expect(result!.username).toBe('testuser');
      expect(mockRepo.findBySsoUserId).toHaveBeenCalledWith('ba-123');
    });

    it('should return null when no user matches ssoUserId', async () => {
      mockRepo.findBySsoUserId.mockResolvedValue(null);

      const result = await dao.findBySsoUserId('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── toIUser mapping ─────────────────────────────────────────

  describe('toIUser mapping', () => {
    it('should map null ssoUserId to undefined', async () => {
      mockRepo.findByUsername.mockResolvedValue(dbUser({ ssoUserId: null }));

      const result = await dao.findByUsername('testuser');

      expect(result!.ssoUserId).toBeUndefined();
    });

    it('should map null email to undefined', async () => {
      mockRepo.findByUsername.mockResolvedValue(dbUser({ email: null }));

      const result = await dao.findByUsername('testuser');

      expect(result!.email).toBeUndefined();
    });

    it('should preserve ssoUserId value when present', async () => {
      mockRepo.findByUsername.mockResolvedValue(
        dbUser({ ssoUserId: 'ba-abc', email: 'a@b.com' }),
      );

      const result = await dao.findByUsername('testuser');

      expect(result!.ssoUserId).toBe('ba-abc');
      expect(result!.email).toBe('a@b.com');
    });

    it('should include ssoUserId in findAll results', async () => {
      mockRepo.findAll.mockResolvedValue([
        dbUser({ ssoUserId: 'ba-1' }),
        dbUser({ username: 'user2', ssoUserId: null }),
      ]);

      const result = await dao.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].ssoUserId).toBe('ba-1');
      expect(result[1].ssoUserId).toBeUndefined();
    });
  });

  // ── create with ssoUserId ───────────────────────────────────

  describe('create', () => {
    it('should pass ssoUserId to repository on create', async () => {
      mockRepo.create.mockImplementation(async (u: any) => dbUser(u));

      const result = await dao.create({
        username: 'newuser',
        password: 'hashed',
        isAdmin: false,
        email: 'new@example.com',
        ssoUserId: 'ba-new',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ssoUserId: 'ba-new', email: 'new@example.com' }),
      );
      expect(result.ssoUserId).toBe('ba-new');
    });

    it('should default ssoUserId to null when not provided', async () => {
      mockRepo.create.mockImplementation(async (u: any) => dbUser(u));

      await dao.create({
        username: 'newuser',
        password: 'hashed',
        isAdmin: false,
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ssoUserId: null }),
      );
    });
  });

  // ── createWithHashedPassword with ssoUserId ─────────────────

  describe('createWithHashedPassword', () => {
    it('should pass ssoUserId through to create', async () => {
      mockRepo.create.mockImplementation(async (u: any) => dbUser(u));

      const result = await dao.createWithHashedPassword(
        'newuser',
        'plainpass',
        false,
        'new@example.com',
        'ba-xyz',
      );

      expect(result.ssoUserId).toBe('ba-xyz');
      expect(result.email).toBe('new@example.com');
    });
  });

  // ── update with ssoUserId ───────────────────────────────────

  describe('update', () => {
    it('should include ssoUserId in update data', async () => {
      mockRepo.update.mockResolvedValue(
        dbUser({ ssoUserId: 'ba-updated', email: 'updated@example.com' }),
      );

      const result = await dao.update('testuser', {
        ssoUserId: 'ba-updated',
        email: 'updated@example.com',
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        'testuser',
        expect.objectContaining({ ssoUserId: 'ba-updated', email: 'updated@example.com' }),
      );
      expect(result!.ssoUserId).toBe('ba-updated');
      expect(result!.email).toBe('updated@example.com');
    });

    it('should not include ssoUserId in update when value is undefined', async () => {
      mockRepo.update.mockResolvedValue(dbUser({ ssoUserId: null }));

      await dao.update('testuser', { ssoUserId: undefined });

      const updateArg = mockRepo.update.mock.calls[0][1];
      expect(updateArg).not.toHaveProperty('ssoUserId');
    });

    it('should include ssoUserId as null when explicitly set to null', async () => {
      mockRepo.update.mockResolvedValue(dbUser({ ssoUserId: null }));

      await dao.update('testuser', { ssoUserId: null as any });

      expect(mockRepo.update).toHaveBeenCalledWith(
        'testuser',
        expect.objectContaining({ ssoUserId: null }),
      );
    });
  });
});
