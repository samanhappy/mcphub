import { ConnectionIsNotSetError, TypeORMError } from 'typeorm';

const dataSources: Array<{
  options: Record<string, unknown>;
  isInitialized: boolean;
  initialize: jest.Mock;
  destroy: jest.Mock;
  query: jest.Mock;
}> = [];

jest.mock('typeorm', () => {
  const actual = jest.requireActual<typeof import('typeorm')>('typeorm');

  return {
    ...actual,
    DataSource: jest.fn().mockImplementation((options: Record<string, unknown>) => {
      const dataSource = {
        options,
        isInitialized: false,
        initialize: jest.fn(async function (this: { isInitialized: boolean }) {
          if (this.isInitialized) {
            throw new Error('Cannot connect because the DataSource is already initialized');
          }
          this.isInitialized = true;
          return this;
        }),
        destroy: jest.fn(async function (this: { isInitialized: boolean }) {
          this.isInitialized = false;
        }),
        query: jest.fn(async () => []),
      };
      dataSources.push(dataSource);
      return dataSource;
    }),
  };
});

const getSmartRoutingConfigMock = jest.fn(async () => ({
  dbUrl: 'postgresql://mcphub:test@postgres:5432/mcphub',
}));

jest.mock('../utils/smartRouting.js', () => ({
  getSmartRoutingConfig: getSmartRoutingConfigMock,
}));

jest.mock('../services/vectorSearchService.js', () => ({
  createVectorIndex: jest.fn(async () => ({ success: true })),
}));

jest.mock('./types/postgresVectorType.js', () => ({
  registerPostgresVectorType: jest.fn(),
}));

import {
  checkDatabaseHealth,
  closeDatabase,
  initializeDatabase,
  reconnectDatabase,
  stopHealthCheck,
  updateDataSourceConfig,
} from './connection.js';
import { registerPostgresVectorType } from './types/postgresVectorType.js';

const registerPostgresVectorTypeMock = jest.mocked(registerPostgresVectorType);

describe('database connection recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    stopHealthCheck();
    await closeDatabase();
  });

  it('reuses the existing configuration when recovering an uninitialized or disconnected driver', async () => {
    const dataSource = await updateDataSourceConfig();

    await expect(checkDatabaseHealth()).resolves.toBe(true);
    expect(dataSource.initialize).toHaveBeenCalledTimes(1);

    dataSource.query.mockRejectedValueOnce(new TypeORMError('Driver not Connected'));

    await expect(checkDatabaseHealth()).resolves.toBe(true);
    expect(dataSource.destroy).toHaveBeenCalledTimes(1);
    expect(dataSource.initialize).toHaveBeenCalledTimes(2);
    expect(getSmartRoutingConfigMock).toHaveBeenCalledTimes(1);
  });

  it('shares one reconnection attempt with concurrent initialization callers', async () => {
    const dataSource = await updateDataSourceConfig();
    let finishInitialization!: () => void;
    dataSource.initialize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInitialization = () => {
            dataSource.isInitialized = true;
            resolve(dataSource);
          };
        }),
    );

    const firstReconnect = reconnectDatabase();
    const secondReconnect = reconnectDatabase();
    const concurrentInitialization = initializeDatabase();

    await new Promise((resolve) => setImmediate(resolve));
    const initializationCallsBeforeRelease = dataSource.initialize.mock.calls.length;
    finishInitialization();

    await expect(
      Promise.all([firstReconnect, secondReconnect, concurrentInitialization]),
    ).resolves.toEqual([dataSource, dataSource, dataSource]);
    expect(initializationCallsBeforeRelease).toBe(1);
    expect(dataSource.initialize).toHaveBeenCalledTimes(1);
  });

  it('cleans up an initialized connection when post-initialization setup fails', async () => {
    jest.useFakeTimers();
    const dataSource = await updateDataSourceConfig();
    registerPostgresVectorTypeMock.mockImplementationOnce(() => {
      throw new Error('vector type registration failed');
    });

    try {
      const recovery = reconnectDatabase();
      await jest.runAllTimersAsync();

      await expect(recovery).resolves.toBe(dataSource);
      expect(dataSource.initialize).toHaveBeenCalledTimes(2);
      expect(dataSource.destroy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('recovers when the driver pool is gone but TypeORM still reports the DataSource as initialized', async () => {
    jest.useFakeTimers();
    const dataSource = await updateDataSourceConfig();
    dataSource.isInitialized = true;
    dataSource.destroy.mockRejectedValueOnce(new ConnectionIsNotSetError('postgres'));

    try {
      const recovery = reconnectDatabase();
      await jest.runAllTimersAsync();

      await expect(recovery).resolves.toBe(dataSource);
      expect(dataSource.initialize).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
