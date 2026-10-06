import { Request, Response } from 'express';
import { jest } from '@jest/globals';

const createUserMock = jest.fn();
const findUserByUsernameMock = jest.fn();
const getBetterAuthRuntimeConfigMock = jest.fn();

jest.mock('../../src/models/User.js', () => ({
  createUser: createUserMock,
  findUserByUsername: findUserByUsernameMock,
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

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: getBetterAuthRuntimeConfigMock,
}));

import { login, register } from '../../src/controllers/authController.js';

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

describe('authController.login with password login disabled', () => {
  const callLogin = async () => {
    const req = {
      body: { username: 'admin', password: 'secret123' },
      t: (value: string) => value,
    } as unknown as Request;
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    await login(req, { json, status } as unknown as Response);
    return { json, status };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findUserByUsernameMock.mockResolvedValue(undefined);
  });

  it('refuses the login with 403 before looking the user up', async () => {
    getBetterAuthRuntimeConfigMock.mockResolvedValue({ disablePasswordLogin: true });

    const { json, status } = await callLogin();

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'api.errors.password_login_disabled',
    });
    expect(findUserByUsernameMock).not.toHaveBeenCalled();
  });

  it('checks the credentials as before when it is not disabled', async () => {
    getBetterAuthRuntimeConfigMock.mockResolvedValue({ disablePasswordLogin: false });

    const { status } = await callLogin();

    expect(findUserByUsernameMock).toHaveBeenCalledWith('admin');
    expect(status).toHaveBeenCalledWith(401);
  });
});
