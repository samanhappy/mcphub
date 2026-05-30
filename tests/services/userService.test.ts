// ── Mock DAO layer ────────────────────────────────────────────────
const mockFindByUsername = jest.fn();
const mockFindByEmail = jest.fn();
const mockFindBySsoUserId = jest.fn();
const mockFindAll = jest.fn();
const mockCreateWithHashedPassword = jest.fn();
const mockUpdate = jest.fn();
const mockUpdatePassword = jest.fn();
const mockDelete = jest.fn();
const mockFindAdmins = jest.fn();
const mockDeleteBearerKeysByOwner = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: jest.fn(() => ({
    findByUsername: mockFindByUsername,
    findByEmail: mockFindByEmail,
    findBySsoUserId: mockFindBySsoUserId,
    findAll: mockFindAll,
    createWithHashedPassword: mockCreateWithHashedPassword,
    update: mockUpdate,
    updatePassword: mockUpdatePassword,
    delete: mockDelete,
    findAdmins: mockFindAdmins,
  })),
  getBearerKeyDao: jest.fn(() => ({
    deleteByOwner: mockDeleteBearerKeysByOwner,
  })),
}));

import {
  createNewUser,
  updateUser,
  deleteUser,
} from '../../src/services/userService.js';

describe('userService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createNewUser ────────────────────────────────────────────

  describe('createNewUser', () => {
    it('should create user with email when provided', async () => {
      mockFindByUsername.mockResolvedValue(undefined);
      mockCreateWithHashedPassword.mockResolvedValue({
        username: 'newuser',
        email: 'new@example.com',
        isAdmin: false,
      });

      const result = await createNewUser('newuser', 'pass123', false, 'new@example.com');

      expect(result).not.toBeNull();
      expect(mockCreateWithHashedPassword).toHaveBeenCalledWith(
        'newuser',
        'pass123',
        false,
        'new@example.com',
      );
    });

    it('should create user without email when not provided', async () => {
      mockFindByUsername.mockResolvedValue(undefined);
      mockCreateWithHashedPassword.mockResolvedValue({
        username: 'newuser',
        isAdmin: false,
      });

      await createNewUser('newuser', 'pass123');

      expect(mockCreateWithHashedPassword).toHaveBeenCalledWith(
        'newuser',
        'pass123',
        false,
        undefined,
      );
    });

    it('should return null when user already exists', async () => {
      mockFindByUsername.mockResolvedValue({ username: 'existing' });

      const result = await createNewUser('existing', 'pass123', false, 'e@x.com');

      expect(result).toBeNull();
      expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
    });
  });

  // ── updateUser ───────────────────────────────────────────────

  describe('updateUser', () => {
    it('should update email when provided', async () => {
      mockFindByUsername.mockResolvedValue({ username: 'testuser' });
      mockUpdate.mockResolvedValue({ username: 'testuser', email: 'updated@example.com' });
      mockFindByUsername.mockResolvedValueOnce({ username: 'testuser' }).mockResolvedValueOnce({
        username: 'testuser',
        email: 'updated@example.com',
      });

      const result = await updateUser('testuser', { email: 'updated@example.com' });

      expect(mockUpdate).toHaveBeenCalledWith('testuser', {
        email: 'updated@example.com',
      });
    });

    it('should update isAdmin and email together', async () => {
      mockFindByUsername.mockResolvedValue({ username: 'testuser', isAdmin: false });
      mockUpdate.mockResolvedValue({});
      mockFindByUsername.mockResolvedValue({
        username: 'testuser',
        isAdmin: true,
        email: 'admin@example.com',
      });

      await updateUser('testuser', { isAdmin: true, email: 'admin@example.com' });

      expect(mockUpdate).toHaveBeenCalledWith('testuser', { isAdmin: true });
      expect(mockUpdate).toHaveBeenCalledWith('testuser', { email: 'admin@example.com' });
    });

    it('should return null when user not found', async () => {
      mockFindByUsername.mockResolvedValue(undefined);

      const result = await updateUser('nonexistent', { email: 'x@x.com' });

      expect(result).toBeNull();
    });

    it('should clear email when empty string provided', async () => {
      mockFindByUsername.mockResolvedValue({ username: 'testuser' });
      mockUpdate.mockResolvedValue({});

      await updateUser('testuser', { email: '' });

      expect(mockUpdate).toHaveBeenCalledWith('testuser', { email: null });
    });
  });

  // ── deleteUser ───────────────────────────────────────────────

  describe('deleteUser', () => {
    it('should delete user when not the last admin', async () => {
      mockFindAll.mockResolvedValue([
        { username: 'admin1', isAdmin: true },
        { username: 'admin2', isAdmin: true },
        { username: 'user1', isAdmin: false },
      ]);
      mockDelete.mockResolvedValue(true);
      mockDeleteBearerKeysByOwner.mockResolvedValue(1);

      const result = await deleteUser('user1');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('user1');
      expect(mockDeleteBearerKeysByOwner).toHaveBeenCalledWith('user1');
    });

    it('should not delete the last admin', async () => {
      mockFindAll.mockResolvedValue([
        { username: 'admin1', isAdmin: true },
        { username: 'user1', isAdmin: false },
      ]);

      const result = await deleteUser('admin1');

      expect(result).toBe(false);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});
