import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CredentialBindingImport } from '../../src/db/entities/CredentialBindingImport.js';
import { migrateCredentialBindings } from '../../src/utils/credentialBindingMigration.js';
import { CredentialBindingDaoImpl } from '../../src/dao/CredentialBindingDao.js';
import {
  encryptCredentialValues,
  decryptCredentialValues,
} from '../../src/services/credentialBindingService.js';
import { CredentialBinding } from '../../src/db/entities/CredentialBinding.js';
import { CredentialBindingDaoDbImpl } from '../../src/dao/CredentialBindingDaoDbImpl.js';
import {
  PersonalOAuthContext,
  resolvePersonalOAuth,
  disconnectPersonalOAuth,
} from '../../src/services/personalOAuthService.js';
import type { ServerConfigWithName } from '../../src/types/index.js';
let mockSource: DataSource;
const mockDefinition: ServerConfigWithName = {
  name: 'gitlab',
  type: 'streamable-http',
  url: 'https://gitlab.example/mcp',
  visibility: 'public',
  oauth: { identityMode: 'personal', clientId: 'client' },
};
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => mockSource }));
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: () =>
    new (jest.requireActual(
      '../../src/dao/CredentialBindingDaoDbImpl.js',
    ).CredentialBindingDaoDbImpl)(),
  getServerDao: () => ({ findById: async () => mockDefinition }),
  getUserDao: () => ({
    findByUsername: async (username: string) => ({ username, isAdmin: false }),
  }),
}));
// This suite runs only against an explicitly supplied disposable local database.
const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('personal OAuth PostgreSQL persistence', () => {
  let directory: string;
  const oldPath = process.env.MCPHUB_SETTING_PATH;
  const oldKey = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-oauth-db-'));
    process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
    process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [CredentialBinding, CredentialBindingImport],
      synchronize: true,
    });
    await mockSource.initialize();
  });
  afterAll(async () => {
    if (mockSource?.isInitialized) {
      await mockSource.getRepository(CredentialBinding).clear();
      await mockSource.getRepository(CredentialBindingImport).clear();
      await mockSource.destroy();
    }
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    if (oldPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = oldPath;
    if (oldKey === undefined) delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = oldKey;
  });
  beforeEach(async () => {
    await mockSource.getRepository(CredentialBinding).clear();
    await mockSource.getRepository(CredentialBindingImport).clear();
    fs.rmSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`, { force: true });
  });
  test('atomic insert/update rejects a concurrent or stale binding write', async () => {
    const dao = new CredentialBindingDaoDbImpl();
    const row = {
      serverName: 'gitlab',
      username: 'alice',
      encryptedValues: 'first',
      updatedAt: new Date().toISOString(),
    };
    expect(
      (
        await Promise.all([
          dao.compareAndSave(row),
          dao.compareAndSave({ ...row, encryptedValues: 'second' }),
        ])
      ).filter(Boolean),
    ).toHaveLength(1);
    const current = (await dao.get('gitlab', 'alice'))!;
    expect(
      (
        await Promise.all([
          dao.compareAndSave({ ...row, encryptedValues: 'third' }, current.encryptedValues),
          dao.compareAndSave({ ...row, encryptedValues: 'fourth' }, current.encryptedValues),
        ])
      ).filter(Boolean),
    ).toHaveLength(1);
  });
  test('encrypted user bindings survive reload and reject a refresh after disconnect', async () => {
    const a = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    const b = await PersonalOAuthContext.load('gitlab', 'bob', mockDefinition);
    await a.persistTokens('gitlab', { accessToken: 'alice-secret', refreshToken: 'alice-refresh' });
    await b.persistTokens('gitlab', { accessToken: 'bob-secret' });
    expect(
      (await resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).config.oauth?.accessToken,
    ).toBe('alice-secret');
    expect(JSON.stringify(await mockSource.getRepository(CredentialBinding).find())).not.toMatch(
      /alice-secret|bob-secret/,
    );
    await disconnectPersonalOAuth('gitlab', 'alice');
    await expect(a.persistTokens('gitlab', { accessToken: 'late' })).rejects.toThrow('changed');
    expect(
      (await resolvePersonalOAuth('gitlab', 'bob', mockDefinition)).config.oauth?.accessToken,
    ).toBe('bob-secret');
  });
  test('concurrent file imports are atomic and retained files cannot resurrect deleted bindings', async () => {
    const alice = {
      serverName: 'gitlab',
      username: 'alice',
      encryptedValues: await encryptCredentialValues('gitlab', 'alice', { token: 'secret' }),
      updatedAt: new Date().toISOString(),
    };
    await new CredentialBindingDaoImpl().save(alice);
    await Promise.all([migrateCredentialBindings(), migrateCredentialBindings()]);
    expect(await mockSource.getRepository(CredentialBinding).find()).toEqual([alice]);
    expect(await decryptCredentialValues(alice)).toEqual({ token: 'secret' });
    expect(await mockSource.getRepository(CredentialBindingImport).count()).toBe(1);
    await mockSource.getRepository(CredentialBinding).clear();
    await migrateCredentialBindings();
    expect(await mockSource.getRepository(CredentialBinding).count()).toBe(0);
  });

  test('a failed database insert rolls back all bindings and receipts', async () => {
    const fileDao = new CredentialBindingDaoImpl();
    for (const username of ['alice', 'x'.repeat(256)]) {
      await fileDao.save({
        serverName: 'gitlab',
        username,
        encryptedValues: await encryptCredentialValues('gitlab', username, { token: 'secret' }),
        updatedAt: new Date().toISOString(),
      });
    }
    await expect(migrateCredentialBindings()).rejects.toThrow();
    expect(await mockSource.getRepository(CredentialBinding).count()).toBe(0);
    expect(await mockSource.getRepository(CredentialBindingImport).count()).toBe(0);
  });
});
