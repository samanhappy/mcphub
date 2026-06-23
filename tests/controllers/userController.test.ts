import { Request, Response } from 'express';

// ── Mock service layer ───────────────────────────────────────────
const mockGetAllUsers = jest.fn();
const mockGetUserByUsername = jest.fn();
const mockCreateNewUser = jest.fn();
const mockUpdateUser = jest.fn();
const mockDeleteUser = jest.fn();
const mockGetUserCount = jest.fn();
const mockGetAdminCount = jest.fn();
const mockCheckReservedUsername = jest.fn(() => null);

jest.mock('../../src/services/userService.js', () => ({
  getAllUsers: mockGetAllUsers,
  getUserByUsername: mockGetUserByUsername,
  createNewUser: mockCreateNewUser,
  updateUser: mockUpdateUser,
  deleteUser: mockDeleteUser,
  getUserCount: mockGetUserCount,
  getAdminCount: mockGetAdminCount,
  checkReservedUsername: mockCheckReservedUsername,
}));

jest.mock('../../src/utils/passwordValidation.js', () => ({
  validatePasswordStrength: jest.fn(() => ({ isValid: true, errors: [] })),
}));

import {
  getUsers,
  createUser,
  updateExistingUser,
} from '../../src/controllers/userController.js';

const makeRes = () => {
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

const makeReq = (overrides: Record<string, any> = {}) =>
  ({
    body: {},
    params: {},
    user: { username: 'admin', isAdmin: true },
    ...overrides,
  }) as unknown as Request;

describe('userController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createUser ───────────────────────────────────────────────

  describe('createUser', () => {
    it('should pass email to createNewUser service', async () => {
      mockCreateNewUser.mockResolvedValue({
        username: 'newuser',
        email: 'new@example.com',
        isAdmin: false,
      });

      const req = makeReq({
        body: { username: 'newuser', password: 'pass1234', isAdmin: false, email: 'new@example.com' },
      });
      const res = makeRes();

      await createUser(req, res);

      expect(mockCreateNewUser).toHaveBeenCalledWith('newuser', 'pass1234', false, 'new@example.com');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ email: 'new@example.com' }),
        }),
      );
    });

    it('should work without email (backward compatible)', async () => {
      mockCreateNewUser.mockResolvedValue({
        username: 'newuser',
        isAdmin: false,
      });

      const req = makeReq({
        body: { username: 'newuser', password: 'pass1234' },
      });
      const res = makeRes();

      await createUser(req, res);

      expect(mockCreateNewUser).toHaveBeenCalledWith('newuser', 'pass1234', false, undefined);
    });

    it('should require username and password', async () => {
      const req = makeReq({ body: { email: 'x@x.com' } });
      const res = makeRes();

      await createUser(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockCreateNewUser).not.toHaveBeenCalled();
    });
  });

  // ── updateExistingUser ───────────────────────────────────────

  describe('updateExistingUser', () => {
    it('should pass email to updateUser service', async () => {
      mockGetUserByUsername.mockResolvedValue({ username: 'testuser', isAdmin: false });
      mockUpdateUser.mockResolvedValue({
        username: 'testuser',
        email: 'updated@example.com',
        isAdmin: false,
      });

      const req = makeReq({
        params: { username: 'testuser' },
        body: { email: 'updated@example.com' },
      });
      const res = makeRes();

      await updateExistingUser(req, res);

      expect(mockUpdateUser).toHaveBeenCalledWith('testuser', {
        email: 'updated@example.com',
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ email: 'updated@example.com' }),
        }),
      );
    });

    it('should update isAdmin and email together', async () => {
      mockGetUserByUsername.mockResolvedValue({ username: 'testuser', isAdmin: false });
      mockGetAdminCount.mockResolvedValue(2);
      mockUpdateUser.mockResolvedValue({
        username: 'testuser',
        email: 'admin@example.com',
        isAdmin: true,
      });

      const req = makeReq({
        params: { username: 'testuser' },
        body: { isAdmin: true, email: 'admin@example.com' },
      });
      const res = makeRes();

      await updateExistingUser(req, res);

      expect(mockUpdateUser).toHaveBeenCalledWith('testuser', {
        isAdmin: true,
        email: 'admin@example.com',
      });
    });

    it('should require at least one field to update', async () => {
      mockGetUserByUsername.mockResolvedValue({ username: 'testuser', isAdmin: false });

      const req = makeReq({
        params: { username: 'testuser' },
        body: {},
      });
      const res = makeRes();

      await updateExistingUser(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('should require admin privileges', async () => {
      const req = makeReq({
        user: { username: 'regular', isAdmin: false },
        body: { email: 'x@x.com' },
      });
      const res = makeRes();

      await updateExistingUser(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
