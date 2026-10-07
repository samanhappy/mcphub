import { initializeDatabaseMode } from '../../src/utils/migration.js';
import { syncSettingsToDatabase } from '../../src/utils/settingsSync.js';
import { initializeDatabase } from '../../src/db/connection.js';

jest.mock('../../src/utils/settingsSync.js', () => ({ syncSettingsToDatabase: jest.fn() }));
jest.mock('../../src/db/connection.js', () => ({ initializeDatabase: jest.fn() }));
jest.mock('../../src/dao/DaoFactory.js', () => ({ setDaoFactory: jest.fn() }));
jest.mock('../../src/dao/DatabaseDaoFactory.js', () => ({
  DatabaseDaoFactory: { getInstance: () => ({}) },
}));
jest.mock('../../src/db/repositories/UserRepository.js', () => ({
  UserRepository: jest.fn(() => ({ count: async () => 1 })),
}));
jest.mock('../../src/db/repositories/BearerKeyRepository.js', () => ({
  BearerKeyRepository: jest.fn(() => ({ count: async () => 1 })),
}));

test('reconciles an already initialized database on every startup', async () => {
  await expect(initializeDatabaseMode()).resolves.toBe(true);
  expect(syncSettingsToDatabase).toHaveBeenCalledTimes(1);
  expect(jest.mocked(initializeDatabase).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(syncSettingsToDatabase).mock.invocationCallOrder[0],
  );
});

test('sync failure fails database initialization rather than starting with stale config', async () => {
  jest.mocked(syncSettingsToDatabase).mockRejectedValueOnce(new Error('Invalid declaration'));
  await expect(initializeDatabaseMode()).resolves.toBe(false);
});
