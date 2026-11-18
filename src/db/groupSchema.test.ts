import {
  initializeWithGroupNameCheck,
  serializePostgresQueryRunnerQueries,
} from './groupSchema.js';

type MockDataSource = {
  options: Record<string, unknown>;
  isInitialized: boolean;
  setOptions: jest.Mock;
  initialize: jest.Mock;
  synchronize: jest.Mock;
  query: jest.Mock;
};

const createDataSource = (synchronize = true): MockDataSource => {
  const options: Record<string, unknown> = { synchronize };
  const dataSource: MockDataSource = {
    options,
    isInitialized: false,
    setOptions: jest.fn((updates: Record<string, unknown>) => Object.assign(options, updates)),
    initialize: jest.fn(async function (this: MockDataSource) {
      this.isInitialized = true;
      return this;
    }),
    synchronize: jest.fn(async () => {}),
    query: jest.fn(async (sql: string) =>
      sql.includes('to_regclass') ? [{ exists: false }] : [],
    ),
  };
  return dataSource;
};

describe('initializeWithGroupNameCheck', () => {
  it('runs synchronize by default after initialization', async () => {
    const dataSource = createDataSource(true);
    await initializeWithGroupNameCheck(dataSource as any);
    expect(dataSource.initialize).toHaveBeenCalledTimes(1);
    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);
  });

  it('skips synchronize when skipSynchronize is set (reconnection path)', async () => {
    const dataSource = createDataSource(true);
    await initializeWithGroupNameCheck(dataSource as any, { skipSynchronize: true });
    expect(dataSource.initialize).toHaveBeenCalledTimes(1);
    expect(dataSource.synchronize).not.toHaveBeenCalled();
  });
});

describe('serializePostgresQueryRunnerQueries', () => {
  it('serializes concurrent query() calls on a single postgres QueryRunner', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`start:${sql}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end:${sql}`);
        inFlight -= 1;
        return sql;
      }),
    };

    const dataSource = {
      driver: {
        options: { type: 'postgres' },
        createQueryRunner: jest.fn(() => queryRunner),
      },
    };

    serializePostgresQueryRunnerQueries(dataSource as any);
    // Calling a second time on the same driver must be a no-op
    serializePostgresQueryRunnerQueries(dataSource as any);

    const runner = dataSource.driver.createQueryRunner();
    const results = await Promise.all([runner.query('q1'), runner.query('q2'), runner.query('q3')]);

    expect(results).toEqual(['q1', 'q2', 'q3']);
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(['start:q1', 'end:q1', 'start:q2', 'end:q2', 'start:q3', 'end:q3']);
  });

  it('continues processing queued queries after a query failure', async () => {
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        if (sql === 'fail') {
          throw new Error('boom');
        }
        return sql;
      }),
    };

    const dataSource = {
      driver: {
        options: { type: 'postgres' },
        createQueryRunner: jest.fn(() => queryRunner),
      },
    };

    serializePostgresQueryRunnerQueries(dataSource as any);
    const runner = dataSource.driver.createQueryRunner();

    const first = runner.query('fail');
    const second = runner.query('ok');

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
  });
});
