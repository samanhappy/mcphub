import { DataSource, ConnectionIsNotSetError, TypeORMError } from 'typeorm';

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
        setOptions: jest.fn((updates) => Object.assign(options, updates)),
        synchronize: jest.fn(async () => {}),
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
        query: jest.fn(async (sql: string) =>
          sql.includes('to_regclass') ? [{ exists: false }] : [],
        ),
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
  getDatabaseHealth,
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

      const recovered = await recovery;
      expect(recovered).not.toBe(dataSource);
      expect(recovered.isInitialized).toBe(true);
      expect(dataSource.initialize).toHaveBeenCalledTimes(1);
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

      const recovered = await recovery;
      expect(recovered).not.toBe(dataSource);
      expect(recovered.isInitialized).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the recovered connection usable when the old destroy finishes late', async () => {
    jest.useFakeTimers();
    const oldSource = await updateDataSourceConfig();
    oldSource.isInitialized = true;
    let finishDestroy!: () => void;
    oldSource.destroy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = () => {
            oldSource.isInitialized = false;
            resolve();
          };
        }),
    );
    try {
      const recovery = reconnectDatabase();
      await jest.runAllTimersAsync();
      const recovered = await recovery;
      finishDestroy();
      await Promise.resolve();
      expect(recovered.isInitialized).toBe(true);
      expect(await initializeDatabase()).toBe(recovered);
    } finally {
      jest.useRealTimers();
    }
  });

  it('bails out of a hung pool destroy instead of wedging reconnection forever', async () => {
    jest.useFakeTimers();
    const dataSource = await updateDataSourceConfig();
    dataSource.isInitialized = true;
    // Simulate a checked-out client stuck in an open transaction (idle in
    // transaction): pg-pool end() would wait for it forever.
    dataSource.destroy.mockReturnValueOnce(new Promise(() => {}));

    try {
      const recovery = reconnectDatabase();
      await jest.runAllTimersAsync();

      const recovered = await recovery;
      expect(recovered).not.toBe(dataSource);
      expect(recovered.isInitialized).toBe(true);
      expect(dataSource.destroy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('recovers via reconnection when the health check query hangs instead of wedging', async () => {
    jest.useFakeTimers();
    const dataSource = await updateDataSourceConfig();
    dataSource.isInitialized = true;
    dataSource.query.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT 1')) {
        return new Promise(() => {});
      }
      if (text.includes('to_regclass')) {
        return Promise.resolve([{ exists: false }]);
      }
      return Promise.resolve([]);
    });

    try {
      const health = checkDatabaseHealth();
      await jest.runAllTimersAsync();

      await expect(health).resolves.toBe(true);
      expect(dataSource.destroy).toHaveBeenCalledTimes(1);
      expect(dataSource.initialize).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['initialize', 'group query', 'internal destroy', 'late rejection'])(
    'bounds a hung %s and isolates its late completion',
    async (stage) => {
      jest.useFakeTimers();
      const dataSource = await updateDataSourceConfig();
      const synchronize = dataSource.options.synchronize;
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (stage === 'initialize' || stage === 'late rejection') {
        dataSource.initialize.mockImplementationOnce(async () => {
          await blocked;
          if (stage === 'late rejection') throw new Error('late connection failure');
          dataSource.isInitialized = true;
          return dataSource;
        });
      } else if (stage === 'group query') {
        dataSource.query.mockImplementationOnce(async () => {
          await blocked;
          return [{ exists: false }];
        });
      } else {
        dataSource.query.mockRejectedValueOnce(new Error('group check failed'));
        dataSource.destroy.mockImplementationOnce(async () => {
          await blocked;
          dataSource.isInitialized = false;
        });
      }
      let settled = false;
      const recovery = reconnectDatabase().then((source) => {
        settled = true;
        return source;
      });
      const waiter = reconnectDatabase();
      try {
        await jest.advanceTimersByTimeAsync(59999);
        expect(settled).toBe(false);
        expect(getDatabaseHealth().reconnecting).toBe(true);
        await expect(checkDatabaseHealth()).resolves.toBe(false);
        await jest.advanceTimersByTimeAsync(1 + 15000 + 3000);
        const recovered = await recovery;
        expect(recovered).not.toBe(dataSource);
        expect(recovered.isInitialized).toBe(true);
        expect(recovered.options.synchronize).toBe(synchronize);
        await expect(waiter).resolves.toBe(recovered);
        expect(getDatabaseHealth().reconnecting).toBe(false);
        release();
        await jest.runAllTimersAsync();
        expect(recovered.isInitialized).toBe(true);
        expect(dataSource.options.synchronize).toBe(synchronize);
        await expect(initializeDatabase()).resolves.toBe(recovered);
        if (stage !== 'late rejection') expect(dataSource.destroy).toHaveBeenCalled();
      } finally {
        release();
        jest.useRealTimers();
      }
    },
  );

  it('clears shared recovery state after all attempts time out and permits a later retry', async () => {
    jest.useFakeTimers();
    const factory = jest.mocked(DataSource).getMockImplementation()!;
    const source = await updateDataSourceConfig();
    source.initialize.mockReturnValueOnce(new Promise(() => {}));
    for (let i = 0; i < 4; i++) {
      jest.mocked(DataSource).mockImplementationOnce((options) => {
        const next = factory(options);
        jest.mocked(next.initialize).mockReturnValueOnce(new Promise(() => {}));
        return next;
      });
    }
    try {
      const recovery = expect(reconnectDatabase()).rejects.toThrow('initialization timed out');
      await jest.advanceTimersByTimeAsync(5 * (60000 + 15000) + 45000);
      await recovery;
      expect(getDatabaseHealth()).toMatchObject({ healthy: false, reconnecting: false });
      await expect(checkDatabaseHealth()).resolves.toBe(true);
      expect(getDatabaseHealth()).toMatchObject({ healthy: true, reconnecting: false });
    } finally {
      jest.useRealTimers();
    }
  });
});
