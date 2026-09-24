import { initializeWithGroupNameCheck } from './groupSchema.js';

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
