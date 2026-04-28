import { Request, Response } from 'express';
import { jest } from '@jest/globals';

const createUserMock = jest.fn();

jest.mock('../../src/models/User.js', () => ({
  createUser: createUserMock,
  findUserByUsername: jest.fn(),
  verifyPassword: jest.fn(),
  updateUserPassword: jest.fn(),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    getPermissions: jest.fn(() => ['']),
  })),
}));

jest.mock('../../src/config/jwt.js', () => ({
  JWT_SECRET: 'test-secret',
}));

jest.mock('../../src/utils/passwordValidation.js', () => ({
  validatePasswordStrength: jest.fn(() => ({ isValid: true, errors: [] })),
  isDefaultPassword: jest.fn(() => false),
}));

jest.mock('../../src/utils/version.js', () => ({
  getPackageVersion: jest.fn(() => 'dev'),
}));

import { register } from '../../src/controllers/authController.js';

describe('authController.register', () => {
  it('forces self-registration to create a non-admin user', async () => {
    createUserMock.mockResolvedValue({
      username: 'alice',
      password: 'secret123',
      isAdmin: false,
    });

    const req = {
      body: {
        username: 'alice',
        password: 'secret123',
        isAdmin: true,
      },
      t: (value: string) => value,
    } as unknown as Request;

    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = {
      json,
      status,
    } as unknown as Response;

    await register(req, res);

    expect(createUserMock).toHaveBeenCalledWith({
      username: 'alice',
      password: 'secret123',
      isAdmin: false,
    });
  });
});
