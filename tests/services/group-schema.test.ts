import { initializeWithGroupNameCheck } from '../../src/db/groupSchema.js';
import type { DataSource } from 'typeorm';

const makeSource = (duplicates: unknown[] = [], exists = true) => {
  const source = {
    options: { synchronize: true },
    isInitialized: false,
    setOptions: jest.fn(function (options) {
      Object.assign(source.options, options);
    }),
    initialize: jest.fn(async () => {
      source.isInitialized = true;
    }),
    synchronize: jest.fn(async () => {}),
    destroy: jest.fn(async () => {
      source.isInitialized = false;
    }),
    query: jest.fn().mockResolvedValueOnce([{ exists }]).mockResolvedValueOnce(duplicates),
  };
  return source;
};

test('reports duplicate names before any schema synchronization and closes the connection', async () => {
  const source = makeSource([{ name: 'team', count: '2' }]);
  await expect(initializeWithGroupNameCheck(source as unknown as DataSource)).rejects.toThrow(
    /team/,
  );
  expect(source.synchronize).not.toHaveBeenCalled();
  expect(source.destroy).toHaveBeenCalled();
  expect(source.options.synchronize).toBe(true);
});

test.each([true, false])(
  'synchronizes existing/new groups only after preflight (exists=%s)',
  async (exists) => {
    const source = makeSource([], exists);
    await initializeWithGroupNameCheck(source as unknown as DataSource);
    expect(source.synchronize).toHaveBeenCalledTimes(1);
    expect(source.query.mock.invocationCallOrder[0]).toBeLessThan(
      source.synchronize.mock.invocationCallOrder[0],
    );
  },
);
