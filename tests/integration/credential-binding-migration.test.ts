import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { StoredCredentialBinding } from '../../src/types/index.js';
import {
  encryptCredentialValues,
  decryptCredentialValues,
} from '../../src/services/credentialBindingService.js';
import { initializeDatabaseMode, migrateToDatabase } from '../../src/utils/migration.js';

let mockSettingsPath: string;
let mockRows: StoredCredentialBinding[];
let mockReceipts: Set<string>;
let mockFailInsert: boolean;
const mockCreateUser = jest.fn();
const mockUserCount = jest.fn();
const mockLoadSettings = jest.fn();
const mockSync = jest.fn();
const mockQuery = jest.fn();
const mockTransaction = jest.fn(async (run: (manager: EntityManager) => Promise<void>) => {
  const rows = [...mockRows];
  const receipts = new Set(mockReceipts);
  const manager = {
    query: mockQuery,
    getRepository: (entity: { name: string }) => {
      if (entity.name === 'CredentialBindingImport') {
        return {
          find: async () => [...mockReceipts].map((fingerprint) => ({ fingerprint })),
          insert: async (rows: { fingerprint: string }[]) => {
            for (const row of rows) mockReceipts.add(row.fingerprint);
          },
        };
      }
      return {
        find: async () => [...mockRows],
        createQueryBuilder: () => {
          let values: StoredCredentialBinding[] = [];
          const builder = {
            insert: () => builder,
            values: (input: StoredCredentialBinding[]) => {
              values = input;
              return builder;
            },
            orIgnore: () => builder,
            execute: async () => {
              for (const binding of values) {
                if (
                  !mockRows.some(
                    (row) =>
                      row.serverName === binding.serverName && row.username === binding.username,
                  )
                ) {
                  mockRows.push(binding);
                  if (mockFailInsert) throw new Error('insert failed');
                }
              }
            },
          };
          return builder;
        },
      };
    },
  } as unknown as EntityManager;
  try {
    await run(manager);
  } catch (error) {
    mockRows = rows;
    mockReceipts = receipts;
    throw error;
  }
});
jest.mock('../../src/db/connection.js', () => ({
  initializeDatabase: async () => undefined,
  getAppDataSource: () => ({ transaction: mockTransaction }),
}));
jest.mock('../../src/config/index.js', () => ({
  getSettingsPath: () => mockSettingsPath,
  loadOriginalSettings: () => mockLoadSettings(),
}));
jest.mock('../../src/dao/DaoFactory.js', () => ({ setDaoFactory: jest.fn() }));
jest.mock('../../src/dao/DatabaseDaoFactory.js', () => ({
  DatabaseDaoFactory: { getInstance: () => ({}) },
}));
jest.mock('../../src/utils/settingsSync.js', () => ({ syncSettingsToDatabase: () => mockSync() }));
jest.mock('../../src/db/repositories/UserRepository.js', () => ({
  UserRepository: jest.fn(() => ({
    count: mockUserCount,
    exists: async () => false,
    create: mockCreateUser,
  })),
}));
jest.mock('../../src/db/repositories/BearerKeyRepository.js', () => ({
  BearerKeyRepository: jest.fn(() => ({ count: async () => 1 })),
}));
jest.mock('../../src/utils/logger.js', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const originalEnv = {
  USE_DB: process.env.USE_DB,
  MCPHUB_CREDENTIAL_ENCRYPTION_KEY: process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY,
};
let directory: string;
const source = () => `${mockSettingsPath}.credentials.json`;
const binding = async (username: string, value = 'secret'): Promise<StoredCredentialBinding> => ({
  serverName: 'shared',
  username,
  encryptedValues: await encryptCredentialValues('shared', username, { 'env.KEY': value }),
  updatedAt: new Date().toISOString(),
});
const write = (rows: StoredCredentialBinding[]) => fs.writeFileSync(source(), JSON.stringify(rows));

beforeEach(() => {
  jest.clearAllMocks();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-migration-'));
  mockSettingsPath = path.join(directory, 'settings.json');
  process.env.USE_DB = 'true';
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  mockRows = [];
  mockReceipts = new Set();
  mockFailInsert = false;
  mockUserCount.mockResolvedValue(1);
  mockLoadSettings.mockReturnValue({ users: [] });
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('imports decryptable ciphertext even when database users already exist, without overwriting existing bindings', async () => {
  const alice = await binding('alice');
  const bob = await binding('bob');
  const currentAlice = await binding('alice', 'newer');
  write([alice, bob]);
  mockRows = [currentAlice];
  const before = fs.readFileSync(source(), 'utf8');
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockRows).toEqual([currentAlice, bob]);
  expect(await decryptCredentialValues(mockRows[1])).toEqual({ 'env.KEY': 'secret' });
  expect(fs.readFileSync(source(), 'utf8')).toBe(before);
});

test.each(['missing', 'wrong', 'invalid', 'corrupt ciphertext'])(
  'rejects %s key/data before migrating users or bindings',
  async (mode) => {
    const alice = await binding('alice');
    const bob = await binding('bob');
    if (mode === 'corrupt ciphertext') bob.encryptedValues = 'broken';
    write([alice, bob]);
    if (mode === 'missing') delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
    if (mode === 'wrong')
      process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    if (mode === 'invalid') process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = 'invalid';
    mockLoadSettings.mockReturnValue({ users: [{ username: 'admin', password: 'x' }] });
    expect(await migrateToDatabase(false)).toBe(false);
    expect(mockRows).toEqual([]);
    expect(mockReceipts.size).toBe(0);
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(fs.existsSync(`${mockSettingsPath}.credentials.key`)).toBe(false);
  },
);

test('accepts the original local key file in database mode', async () => {
  const alice = await binding('alice');
  write([alice]);
  fs.writeFileSync(
    `${mockSettingsPath}.credentials.key`,
    process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY!,
    { mode: 0o600 },
  );
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockRows).toEqual([alice]);
});

test('refuses to mix file and database ciphertext encrypted with different keys', async () => {
  mockRows = [await binding('existing')];
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  write([await binding('new')]);
  expect(await initializeDatabaseMode()).toBe(false);
  expect(mockRows).toHaveLength(1);
  expect(mockReceipts.size).toBe(0);
  expect(mockSync).not.toHaveBeenCalled();
});

test('does not resurrect a deleted binding from the unchanged source file after restart', async () => {
  write([await binding('alice')]);
  expect(await initializeDatabaseMode()).toBe(true);
  mockRows = [];
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockRows).toEqual([]);
  expect(mockReceipts.size).toBe(1);
});

test('rolls back a failed import and allows retry', async () => {
  const rows = [await binding('alice'), await binding('bob')];
  write(rows);
  mockFailInsert = true;
  expect(await initializeDatabaseMode()).toBe(false);
  expect(mockRows).toEqual([]);
  expect(mockReceipts.size).toBe(0);
  mockFailInsert = false;
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockRows).toEqual(rows);
});

test('does not require a key when there is no source credential file', async () => {
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockTransaction).not.toHaveBeenCalled();
});

test('imports credentials on the first database startup too', async () => {
  const alice = await binding('alice');
  write([alice]);
  mockUserCount.mockResolvedValue(0);
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockRows).toEqual([alice]);
});

test('adding new file bindings does not restore previously deleted imported bindings', async () => {
  const alice = await binding('alice');
  write([alice]);
  expect(await initializeDatabaseMode()).toBe(true);
  mockRows = [];
  const bob = await binding('bob');
  write([alice, bob]);
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockRows).toEqual([bob]);
  expect(mockReceipts.size).toBe(2);
});

test('refuses a corrupt source file without changing the database', async () => {
  fs.writeFileSync(source(), '{broken');
  expect(await initializeDatabaseMode()).toBe(false);
  expect(mockRows).toEqual([]);
  expect(mockSync).not.toHaveBeenCalled();
});

test('checks every destination binding before importing, even if another row decrypts', async () => {
  const key = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  const current = await binding('current');
  const alice = await binding('alice');
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const wrongKey = await binding('other');
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = key;
  mockRows = [current, wrongKey];
  write([alice]);
  expect(await initializeDatabaseMode()).toBe(false);
  expect(mockRows).toEqual([current, wrongKey]);
  expect(mockReceipts.size).toBe(0);
});

test('skips obsolete file ciphertext when the database already owns the binding', async () => {
  write([await binding('alice', 'old')]);
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const current = await binding('alice', 'new');
  mockRows = [current];
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockRows).toEqual([current]);
  mockRows = [];
  expect(await initializeDatabaseMode()).toBe(true);
  expect(mockRows).toEqual([]);
});
