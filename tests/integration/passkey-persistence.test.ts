import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { PasskeyDaoImpl, type PasskeyDao } from '../../src/dao/PasskeyDao.js';
import { PasskeyDaoDbImpl } from '../../src/dao/PasskeyDaoDbImpl.js';
import { Passkey } from '../../src/db/entities/Passkey.js';
import { OAuthState } from '../../src/db/entities/OAuthState.js';
import type { UserPasskey } from '../../src/types/index.js';

let mockSource: DataSource;
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => mockSource }));

const passkey = (username = 'alice', overrides: Partial<UserPasskey> = {}): UserPasskey => ({
  id: randomUUID(),
  username,
  credentialId: randomUUID(),
  publicKey: 'cose-public-key',
  counter: 0,
  transports: ['internal', 'hybrid'],
  userHandle: `${username}-handle`,
  rpId: 'hub.example.test',
  sessionVersion: `${username}-version`,
  name: 'Laptop',
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  ...overrides,
});

function persistenceContract(createDao: () => PasskeyDao) {
  it('persists across DAO instances and keeps users isolated', async () => {
    const a = passkey();
    const b = passkey('bob');
    const c = passkey('alice', { name: 'Phone' });
    await createDao().save(a);
    await createDao().save(b);
    await createDao().save(c);
    expect(await createDao().findById(a.id)).toEqual(a);
    expect(await createDao().findByCredentialId(b.credentialId)).toEqual(b);
    expect(await createDao().findByUsername('alice')).toEqual(expect.arrayContaining([a, c]));

    await createDao().delete(a.id);
    expect(await createDao().findById(a.id)).toBeNull();
    await createDao().deleteByUsername('alice');
    expect(await createDao().findByUsername('alice')).toEqual([]);
    expect(await createDao().findById(b.id)).toEqual(b);
  });

  it('round-trips a signature counter above the 32-bit signed range', async () => {
    const row = passkey('alice', { counter: 4_000_000_000 });
    await createDao().save(row);
    await createDao().save({ ...row, counter: 4_000_000_001, lastUsedAt: row.createdAt });
    expect(await createDao().findById(row.id)).toEqual({
      ...row,
      counter: 4_000_000_001,
      lastUsedAt: row.createdAt,
    });
  });

  it('records a sign-in only while the passkey still exists', async () => {
    const row = passkey();
    await createDao().save(row);
    const use = { counter: 7, backedUp: false, lastUsedAt: new Date().toISOString() };
    expect(await createDao().recordUse(row.id, use)).toBe(true);
    expect(await createDao().findById(row.id)).toEqual({ ...row, ...use });

    // A sign-in finishing after the passkey was removed must not bring it back
    await createDao().delete(row.id);
    expect(await createDao().recordUse(row.id, use)).toBe(false);
    expect(await createDao().findById(row.id)).toBeNull();
  });

  it('only moves the signature counter forward', async () => {
    const use = (counter: number) => ({
      counter,
      backedUp: true,
      lastUsedAt: new Date().toISOString(),
    });
    const row = passkey('alice', { counter: 10 });
    await createDao().save(row);
    // Two sign-ins verified against counter 10 finish out of order
    expect(await createDao().recordUse(row.id, use(12))).toBe(true);
    expect(await createDao().recordUse(row.id, use(11))).toBe(false);
    expect(await createDao().recordUse(row.id, use(12))).toBe(false);
    // An authenticator that counts cannot fall back to 0
    expect(await createDao().recordUse(row.id, use(0))).toBe(false);
    expect((await createDao().findById(row.id))?.counter).toBe(12);

    // The same holds beyond the 32-bit signed range
    const high = passkey('alice', { counter: 4_000_000_000 });
    await createDao().save(high);
    expect(await createDao().recordUse(high.id, use(4_000_000_002))).toBe(true);
    expect(await createDao().recordUse(high.id, use(4_000_000_001))).toBe(false);
    expect((await createDao().findById(high.id))?.counter).toBe(4_000_000_002);
  });

  it('keeps accepting authenticators that always report a zero counter', async () => {
    const use = (counter: number) => ({ counter, backedUp: true, lastUsedAt: null });
    const row = passkey('alice', { counter: 0 });
    await createDao().save(row);
    expect(await createDao().recordUse(row.id, use(0))).toBe(true);
    expect(await createDao().recordUse(row.id, use(0))).toBe(true);
    expect(await createDao().recordUse(row.id, use(3))).toBe(true);
    expect((await createDao().findById(row.id))?.counter).toBe(3);
  });

  it('refuses to register one credential twice', async () => {
    const row = passkey();
    await createDao().save(row);
    await expect(
      createDao().save({ ...passkey('bob'), credentialId: row.credentialId }),
    ).rejects.toThrow();
    expect(await createDao().findByUsername('bob')).toEqual([]);
  });
}

describe('file passkey persistence', () => {
  let directory: string;
  const oldPath = process.env.MCPHUB_SETTING_PATH;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-passkey-store-'));
    process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  });
  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    if (oldPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = oldPath;
  });
  persistenceContract(() => new PasskeyDaoImpl());

  it('keeps passkeys outside configuration and writes owner-only files', async () => {
    await new PasskeyDaoImpl().save(passkey());
    expect(fs.existsSync(process.env.MCPHUB_SETTING_PATH!)).toBe(false);
    if (process.platform !== 'win32') {
      // Windows has no POSIX permission bits; Node reports 0o666 for every regular file.
      expect(fs.statSync(`${process.env.MCPHUB_SETTING_PATH}.passkeys.json`).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it('fails closed on corrupt storage instead of overwriting it', async () => {
    const file = `${process.env.MCPHUB_SETTING_PATH}.passkeys.json`;
    fs.writeFileSync(file, '{}');
    await expect(new PasskeyDaoImpl().findByCredentialId('any')).rejects.toThrow(
      'Invalid passkey store',
    );
    await expect(new PasskeyDaoImpl().save(passkey())).rejects.toThrow('Invalid passkey store');
    expect(fs.readFileSync(file, 'utf8')).toBe('{}');
  });
});

const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('PostgreSQL passkey persistence', () => {
  beforeAll(async () => {
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [Passkey],
      synchronize: true,
    });
    await mockSource.initialize();
  });
  beforeEach(async () => {
    await mockSource.getRepository(Passkey).clear();
  });
  afterAll(async () => {
    if (mockSource?.isInitialized) {
      await mockSource.getRepository(Passkey).clear();
      await mockSource.destroy();
    }
  });
  persistenceContract(() => new PasskeyDaoDbImpl());

  it('lets the higher counter win when concurrent sign-ins race', async () => {
    const row = passkey('alice', { counter: 10 });
    await new PasskeyDaoDbImpl().save(row);
    for (let base = 10; base < 100; base += 10) {
      const use = (counter: number) => ({ counter, backedUp: true, lastUsedAt: null });
      // Both sign-ins were verified against `base`; either may commit first
      const [higher] = await Promise.all([
        new PasskeyDaoDbImpl().recordUse(row.id, use(base + 2)),
        new PasskeyDaoDbImpl().recordUse(row.id, use(base + 1)),
      ]);
      expect(higher).toBe(true);
      expect((await new PasskeyDaoDbImpl().findById(row.id))?.counter).toBe(base + 2);
      await new PasskeyDaoDbImpl().save({ ...row, counter: base + 10 });
    }
  });

  it('matches the schema in docs/migrations/0008-passkeys.sql', async () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'docs/migrations/0008-passkeys.sql'),
      'utf8',
    );
    await mockSource.query('DROP TABLE IF EXISTS "user_passkeys"');
    await mockSource.query(migration);
    // Idempotent, as the file promises
    await mockSource.query(migration);
    const row = passkey('alice', { counter: 4_000_000_000 });
    await new PasskeyDaoDbImpl().save(row);
    expect(await new PasskeyDaoDbImpl().findById(row.id)).toEqual(row);
    await expect(
      new PasskeyDaoDbImpl().save({ ...passkey('bob'), credentialId: row.credentialId }),
    ).rejects.toThrow();
  });
});

dbSuite('passkey challenges across independent replicas', () => {
  let first: typeof import('../../src/services/passkeyService.js');
  let second: typeof first;
  const oldMode = process.env.MCPHUB_REPLICA_MODE;
  const rp = { rpId: 'hub.example.test', origin: 'https://hub.example.test' };

  beforeAll(async () => {
    process.env.MCPHUB_REPLICA_MODE = 'true';
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [OAuthState],
      synchronize: true,
    });
    await mockSource.initialize();
    await jest.isolateModulesAsync(async () => {
      first = await import('../../src/services/passkeyService.js');
    });
    await jest.isolateModulesAsync(async () => {
      second = await import('../../src/services/passkeyService.js');
    });
  });
  afterAll(async () => {
    await mockSource?.getRepository(OAuthState).delete({ kind: 'passkey_challenge' });
    await mockSource?.destroy();
    if (oldMode === undefined) delete process.env.MCPHUB_REPLICA_MODE;
    else process.env.MCPHUB_REPLICA_MODE = oldMode;
  });

  it('accepts a challenge on only one replica, even when both race', async () => {
    const { challengeToken } = await first.startPasskeyAuthentication(rp);
    const results = await Promise.all([
      first.consumeChallengeToken(challengeToken, 'authentication'),
      second.consumeChallengeToken(challengeToken, 'authentication'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await second.consumeChallengeToken(challengeToken, 'authentication')).toBeNull();

    // A fresh challenge still works on the other replica
    const next = await first.startPasskeyAuthentication(rp);
    expect(await second.consumeChallengeToken(next.challengeToken, 'authentication')).toMatchObject(
      rp,
    );
  });
});
