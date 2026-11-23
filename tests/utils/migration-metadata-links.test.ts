import { migrateToDatabase } from '../../src/utils/migration.js';
import { loadOriginalSettings } from '../../src/config/index.js';
import { initializeDatabase } from '../../src/db/connection.js';
import { migrateCredentialBindings } from '../../src/utils/credentialBindingMigration.js';
import { UserRepository } from '../../src/db/repositories/UserRepository.js';
import { ServerRepository } from '../../src/db/repositories/ServerRepository.js';

jest.mock('../../src/db/connection.js', () => ({ initializeDatabase: jest.fn() }));
jest.mock('../../src/utils/credentialBindingMigration.js', () => ({
  migrateCredentialBindings: jest.fn(),
}));
jest.mock('../../src/config/index.js', () => ({
  loadOriginalSettings: jest.fn(),
  getSettingsPath: jest.fn(() => '/tmp/mcp_settings.json'),
}));
jest.mock('../../src/utils/settingsSync.js', () => ({ syncSettingsToDatabase: jest.fn() }));
jest.mock('../../src/dao/DaoFactory.js', () => ({ setDaoFactory: jest.fn() }));
jest.mock('../../src/dao/DatabaseDaoFactory.js', () => ({
  DatabaseDaoFactory: { getInstance: () => ({}) },
}));
jest.mock('../../src/dao/PasskeyDao.js', () => ({ PasskeyDaoImpl: jest.fn() }));
jest.mock('../../src/dao/PasskeyDaoDbImpl.js', () => ({ PasskeyDaoDbImpl: jest.fn() }));

const serverCreate = jest.fn();

jest.mock('../../src/db/repositories/UserRepository.js', () => ({
  UserRepository: jest.fn(() => ({
    exists: jest.fn(async () => true),
    create: jest.fn(async () => undefined),
  })),
}));
jest.mock('../../src/db/repositories/ServerRepository.js', () => ({
  ServerRepository: jest.fn(() => ({
    exists: jest.fn(async () => false),
    create: (...args: unknown[]) => serverCreate(...args),
  })),
}));

// Every remaining repository is unused by a servers-only fixture; give them
// inert instances so construction succeeds.
for (const path of [
  'GroupRepository',
  'SystemConfigRepository',
  'UserConfigRepository',
  'OAuthClientRepository',
  'OAuthTokenRepository',
  'BearerKeyRepository',
  'BuiltinPromptRepository',
  'BuiltinResourceRepository',
]) {
  jest.mock(`../../src/db/repositories/${path}.js`, () => ({
    [path]: jest.fn(() => ({})),
  }));
}

describe('migrateToDatabase metadata links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(initializeDatabase).mockResolvedValue(undefined);
    jest.mocked(migrateCredentialBindings).mockResolvedValue(undefined);
  });

  it('seeds every server even when one carries a hand-edited bad link', async () => {
    jest.mocked(loadOriginalSettings).mockReturnValue({
      users: [{ username: 'admin', password: 'hash', isAdmin: true }],
      mcpServers: {
        broken: {
          command: 'npx',
          args: ['-y', 'broken'],
          repositoryUrl: 'not a url',
        },
        healthy: {
          command: 'npx',
          args: ['-y', 'healthy'],
          repositoryUrl: 'https://github.com/owner/repo',
          documentationUrl: 'https://docs.example.com/guide',
        },
      },
    } as never);

    await expect(migrateToDatabase()).resolves.toBe(true);

    const seeded = serverCreate.mock.calls.map(([row]) => row);
    expect(seeded.map((row) => row.name).sort()).toEqual(['broken', 'healthy']);

    const broken = seeded.find((row) => row.name === 'broken');
    expect(broken.repositoryUrl).toBeUndefined();

    const healthy = seeded.find((row) => row.name === 'healthy');
    expect(healthy.repositoryUrl).toBe('https://github.com/owner/repo');
    expect(healthy.documentationUrl).toBe('https://docs.example.com/guide');
  });
});
