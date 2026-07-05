import crypto from 'crypto';

// Mock the dao module before importing the module under test
const mockCreateWithHashedPassword = jest.fn();
const mockFindAll = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: jest.fn(() => ({
    createWithHashedPassword: mockCreateWithHashedPassword,
    findAll: mockFindAll,
  })),
}));

// Mock bcryptjs since it's imported by User.ts
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn((password: string) => Promise.resolve(`hashed_${password}`)),
}));

import { initializeDefaultUser } from '../../src/models/User.js';

describe('initializeDefaultUser', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // Reset env var between tests
    delete process.env.ADMIN_PASSWORD;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    delete process.env.ADMIN_PASSWORD;
  });

  it('should NOT use hardcoded "admin123" as the default password', async () => {
    mockFindAll.mockResolvedValue([]);
    mockCreateWithHashedPassword.mockResolvedValue({
      username: 'admin',
      password: 'hashed',
      isAdmin: true,
    });

    await initializeDefaultUser();

    expect(mockCreateWithHashedPassword).toHaveBeenCalledTimes(1);
    const [username, password, isAdmin] = mockCreateWithHashedPassword.mock.calls[0];
    expect(username).toBe('admin');
    expect(isAdmin).toBe(true);
    // The password must NOT be the hardcoded default
    expect(password).not.toBe('admin123');
  });

  it('should generate a random password when no ADMIN_PASSWORD env var is set', async () => {
    mockFindAll.mockResolvedValue([]);
    mockCreateWithHashedPassword.mockResolvedValue({
      username: 'admin',
      password: 'hashed',
      isAdmin: true,
    });

    await initializeDefaultUser();

    const [, password] = mockCreateWithHashedPassword.mock.calls[0];
    // Random password should be sufficiently long (at least 16 chars)
    expect(password.length).toBeGreaterThanOrEqual(16);
  });

  it('should log the generated password to the console', async () => {
    mockFindAll.mockResolvedValue([]);
    mockCreateWithHashedPassword.mockResolvedValue({
      username: 'admin',
      password: 'hashed',
      isAdmin: true,
    });

    await initializeDefaultUser();

    const [, password] = mockCreateWithHashedPassword.mock.calls[0];
    // The password should appear in console output so the admin can see it
    const loggedMessages = consoleLogSpy.mock.calls.map((call: any[]) => call.join(' ')).join(' ');
    expect(loggedMessages).toContain(password);
  });

  it('should use ADMIN_PASSWORD env var when provided', async () => {
    process.env.ADMIN_PASSWORD = 'MyCustomP@ss1';
    mockFindAll.mockResolvedValue([]);
    mockCreateWithHashedPassword.mockResolvedValue({
      username: 'admin',
      password: 'hashed',
      isAdmin: true,
    });

    await initializeDefaultUser();

    const [, password] = mockCreateWithHashedPassword.mock.calls[0];
    expect(password).toBe('MyCustomP@ss1');
  });

  it('should not create a user when users already exist', async () => {
    mockFindAll.mockResolvedValue([{ username: 'existing', password: 'hash', isAdmin: true }]);

    await initializeDefaultUser();

    expect(mockCreateWithHashedPassword).not.toHaveBeenCalled();
  });

  it('should generate different passwords on successive calls (randomness check)', async () => {
    mockFindAll.mockResolvedValue([]);
    mockCreateWithHashedPassword.mockResolvedValue({
      username: 'admin',
      password: 'hashed',
      isAdmin: true,
    });

    await initializeDefaultUser();
    const [, password1] = mockCreateWithHashedPassword.mock.calls[0];

    jest.clearAllMocks();
    mockFindAll.mockResolvedValue([]);
    mockCreateWithHashedPassword.mockResolvedValue({
      username: 'admin',
      password: 'hashed',
      isAdmin: true,
    });

    await initializeDefaultUser();
    const [, password2] = mockCreateWithHashedPassword.mock.calls[0];

    // Two random passwords should differ (probabilistically certain)
    expect(password1).not.toBe(password2);
  });
});
