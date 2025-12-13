import { jest } from '@jest/globals';

// Mocks must be defined before importing the module under test.

const initializeDatabaseMock = jest.fn(async () => undefined);
jest.mock('../db/connection.js', () => ({
  initializeDatabase: initializeDatabaseMock,
}));

const setDaoFactoryMock = jest.fn();
jest.mock('../dao/DaoFactory.js', () => ({
  setDaoFactory: setDaoFactoryMock,
}));

jest.mock('../dao/DatabaseDaoFactory.js', () => ({
  DatabaseDaoFactory: {
    getInstance: jest.fn(() => ({
      /* noop */
    })),
  },
}));

const loadOriginalSettingsMock = jest.fn(() => ({ users: [] }));
jest.mock('../config/index.js', () => ({
  loadOriginalSettings: loadOriginalSettingsMock,
}));

const userRepoCountMock = jest.fn<() => Promise<number>>();
jest.mock('../db/repositories/UserRepository.js', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    count: userRepoCountMock,
  })),
}));

const bearerKeyCountMock = jest.fn<() => Promise<number>>();
const bearerKeyCreateMock =
  jest.fn<
    (data: {
      name: string;
      token: string;
      enabled: boolean;
      accessType: string;
      allowedGroups: string[];
      allowedServers: string[];
    }) => Promise<unknown>
  >();
jest.mock('../db/repositories/BearerKeyRepository.js', () => ({
  BearerKeyRepository: jest.fn().mockImplementation(() => ({
    count: bearerKeyCountMock,
    create: bearerKeyCreateMock,
  })),
}));

const systemConfigGetMock = jest.fn<() => Promise<any>>();
jest.mock('../db/repositories/SystemConfigRepository.js', () => ({
  SystemConfigRepository: jest.fn().mockImplementation(() => ({
    get: systemConfigGetMock,
  })),
}));

describe('initializeDatabaseMode legacy bearer auth migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips legacy migration when bearerKeys table already has data', async () => {
    userRepoCountMock.mockResolvedValue(1);
    bearerKeyCountMock.mockResolvedValue(2);
    systemConfigGetMock.mockResolvedValue({
      routing: { enableBearerAuth: true, bearerAuthKey: 'db-key' },
    });

    const { initializeDatabaseMode } = await import('./migration.js');
    const ok = await initializeDatabaseMode();

    expect(ok).toBe(true);
    expect(initializeDatabaseMock).toHaveBeenCalled();
    expect(loadOriginalSettingsMock).not.toHaveBeenCalled();
    expect(systemConfigGetMock).not.toHaveBeenCalled();
    expect(bearerKeyCreateMock).not.toHaveBeenCalled();
  });

  it('migrates legacy routing bearerAuthKey into bearerKeys when users exist and keys table is empty', async () => {
    userRepoCountMock.mockResolvedValue(3);
    bearerKeyCountMock.mockResolvedValue(0);
    systemConfigGetMock.mockResolvedValue({
      routing: { enableBearerAuth: true, bearerAuthKey: 'db-key' },
    });

    const { initializeDatabaseMode } = await import('./migration.js');
    const ok = await initializeDatabaseMode();

    expect(ok).toBe(true);
    expect(loadOriginalSettingsMock).not.toHaveBeenCalled();
    expect(systemConfigGetMock).toHaveBeenCalledTimes(1);
    expect(bearerKeyCreateMock).toHaveBeenCalledTimes(1);
    expect(bearerKeyCreateMock).toHaveBeenCalledWith({
      name: 'default',
      token: 'db-key',
      enabled: true,
      accessType: 'all',
      allowedGroups: [],
      allowedServers: [],
    });
  });

  it('does not migrate when routing has no bearerAuthKey', async () => {
    userRepoCountMock.mockResolvedValue(1);
    bearerKeyCountMock.mockResolvedValue(0);
    systemConfigGetMock.mockResolvedValue({
      routing: { enableBearerAuth: true, bearerAuthKey: '   ' },
    });

    const { initializeDatabaseMode } = await import('./migration.js');
    const ok = await initializeDatabaseMode();

    expect(ok).toBe(true);
    expect(loadOriginalSettingsMock).not.toHaveBeenCalled();
    expect(systemConfigGetMock).toHaveBeenCalledTimes(1);
    expect(bearerKeyCreateMock).not.toHaveBeenCalled();
  });
});
