import fs from 'node:fs';
import path from 'node:path';
import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import BearerKeyEntity from '../../src/db/entities/BearerKey.js';
import BearerKeyUsageEntity from '../../src/db/entities/BearerKeyUsage.js';
import { installReplicaSchema } from '../../src/db/replicaSchema.js';

let mockSource: DataSource;
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => mockSource,
}));

import { BearerKeyDaoDbImpl } from '../../src/dao/BearerKeyDaoDbImpl.js';
import { BearerKeyRepository } from '../../src/db/repositories/BearerKeyRepository.js';

describe('BearerKey PostgreSQL DAO & Repository (unit)', () => {
  it('executes narrow conditional upsert on bearer_key_usage without touching bearer_keys', async () => {
    const query = jest
      .fn<(...args: unknown[]) => Promise<Array<{ key_id: string }>>>()
      .mockResolvedValue([{ key_id: '11111111-1111-4111-8111-111111111111' }]);
    mockSource = {
      getRepository: () => ({
        manager: { query },
      }),
    } as unknown as DataSource;

    const repo = new BearerKeyRepository();
    const usedAt = new Date('2026-11-27T12:00:00.000Z');
    const updated = await repo.recordLastUsed('11111111-1111-4111-8111-111111111111', usedAt);

    expect(updated).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO "bearer_key_usage"');
    expect(sql).toContain('WHERE EXISTS (SELECT 1 FROM "bearer_keys"');
    expect(sql).toContain('"bearer_key_usage"."last_used_at" < EXCLUDED."last_used_at"');
    expect(sql).not.toMatch(/UPDATE\s+"?bearer_keys"?/i);
    expect(params).toEqual(['11111111-1111-4111-8111-111111111111', usedAt]);
  });

  it('does not query usage metadata on auth-path lookups and tolerates usage read failures in findAll', async () => {
    const sampleEntity = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'auth-key',
      enabled: true,
      kind: 'system',
      accessType: 'all',
      allowedGroups: [],
      allowedServers: [],
      excludedGroups: [],
      excludedServers: [],
    };
    const usageFind = jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error('usage table down'));
    const keyRepo = {
      find: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([sampleEntity]),
      findOne: jest.fn<() => Promise<unknown>>().mockResolvedValue(sampleEntity),
    };
    const usageRepo = {
      find: usageFind,
    };
    mockSource = {
      getRepository: (entity: unknown) => (entity === BearerKeyUsageEntity ? usageRepo : keyRepo),
    } as unknown as DataSource;

    const dao = new BearerKeyDaoDbImpl();

    // Auth-path methods must NEVER touch bearer_key_usage
    const enabled = await dao.findEnabled();
    expect(enabled).toHaveLength(1);
    expect(await dao.findById(sampleEntity.id)).toBeDefined();
    expect(await dao.findByToken('any-token')).toBeDefined();
    expect(usageFind).not.toHaveBeenCalled();

    // Management list gracefully degrades when bearer_key_usage fails
    const all = await dao.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].lastUsedAt).toBeUndefined();
    expect(usageFind).toHaveBeenCalledTimes(1);
  });
});

// Runs against a disposable local PostgreSQL database when MCPHUB_TEST_PG_PORT is set.
const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;

const runPgSuiteAssertions = (getSource: () => DataSource, getDao: () => BearerKeyDaoDbImpl) => {
  const getRevision = async (): Promise<number> => {
    const [{ version }] = await getSource().query(
      'SELECT version FROM mcphub_revision WHERE id = 1',
    );
    return Number(version);
  };

  it('enforces FK ON DELETE CASCADE on bearer_key_usage', async () => {
    const rows = (await getSource().query(`
      SELECT confdeltype
      FROM pg_constraint
      WHERE conrelid = 'bearer_key_usage'::regclass
        AND confrelid = 'bearer_keys'::regclass
        AND contype = 'f'
    `)) as Array<{ confdeltype: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // 'c' = ON DELETE CASCADE in pg_constraint
    expect(rows.some((r) => r.confdeltype === 'c')).toBe(true);
  });

  it('persists expiresAt, preserves on omission, clears on null, and leaves replica revision unchanged on recordLastUsed', async () => {
    const dao = getDao();
    const created = await dao.create({
      name: 'pg-key',
      token: 'mcphub_pg_secret_token',
      enabled: true,
      kind: 'system',
      accessType: 'all',
      expiresAt: '2026-12-10T00:00:00.000Z',
    });
    expect(created.expiresAt).toBe('2026-12-10T00:00:00.000Z');
    expect(created.lastUsedAt).toBeUndefined();

    // Omission preserves expiry
    const renamed = await dao.update(created.id, { name: 'pg-key-renamed' });
    expect(renamed?.expiresAt).toBe('2026-12-10T00:00:00.000Z');

    // Recording lastUsedAt MUST NOT bump mcphub_revision
    const revBeforeUsage = await getRevision();
    const t1 = new Date('2026-11-27T10:00:00.000Z');
    expect(await dao.recordLastUsed(created.id, t1)).toBe(true);
    expect(await getRevision()).toBe(revBeforeUsage);

    const listed = (await dao.findAll()).find((k) => k.id === created.id);
    expect(listed?.lastUsedAt).toBe(t1.toISOString());

    // Older timestamp does not move lastUsedAt backwards
    const older = new Date('2026-11-27T09:00:00.000Z');
    expect(await dao.recordLastUsed(created.id, older)).toBe(false);
    expect((await dao.findAll()).find((k) => k.id === created.id)?.lastUsedAt).toBe(
      t1.toISOString(),
    );
    expect(await getRevision()).toBe(revBeforeUsage);

    // Explicit clear removes expiresAt (and DOES bump revision as a config change)
    const cleared = await dao.update(created.id, { expiresAt: null });
    expect(cleared?.expiresAt).toBeUndefined();
    expect(cleared?.lastUsedAt).toBe(t1.toISOString());
    expect(await getRevision()).toBeGreaterThan(revBeforeUsage);

    // Deleting the key cascades usage cleanup and subsequent recordLastUsed never recreates it
    expect(await dao.delete(created.id)).toBe(true);
    expect(await dao.recordLastUsed(created.id, new Date('2026-11-27T11:00:00.000Z'))).toBe(false);
    expect(await dao.findById(created.id)).toBeUndefined();
    const orphanRows = await getSource().query(
      'SELECT key_id FROM "bearer_key_usage" WHERE key_id = $1::uuid',
      [created.id],
    );
    expect(orphanRows).toHaveLength(0);
  });

  it('leaves zero orphaned usage rows under concurrent delete + recordLastUsed upserts', async () => {
    const dao = getDao();
    const created = await dao.create({
      name: 'race-key',
      token: 'mcphub_pg_race_token',
      enabled: true,
      kind: 'system',
      accessType: 'all',
    });

    await dao.recordLastUsed(created.id, new Date('2026-11-27T08:00:00.000Z'));

    // Fire concurrent usage upserts alongside key deletion.
    // Depending on exact transaction serialization, an upsert that wins the EXISTS check
    // right as DELETE commits may observe an FK violation (23503) or return false — either
    // way, no orphaned row may remain after all operations settle.
    const ops: Array<Promise<unknown>> = [dao.delete(created.id)];
    for (let i = 1; i <= 10; i++) {
      ops.push(
        dao
          .recordLastUsed(created.id, new Date(`2026-11-27T08:0${i < 10 ? `0:0${i}` : '1:00'}.000Z`))
          .catch(() => false),
      );
    }
    await Promise.all(ops);

    expect(await dao.findById(created.id)).toBeUndefined();
    const orphanRows = await getSource().query(
      'SELECT key_id FROM "bearer_key_usage" WHERE key_id = $1::uuid',
      [created.id],
    );
    expect(orphanRows).toHaveLength(0);
  });
};

dbSuite('BearerKey PostgreSQL (TypeORM synchronize: true)', () => {
  let dao: BearerKeyDaoDbImpl;

  beforeAll(async () => {
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [BearerKeyEntity, BearerKeyUsageEntity],
      synchronize: true,
    });
    await mockSource.initialize();
    await installReplicaSchema(mockSource);
    dao = new BearerKeyDaoDbImpl();
  });

  beforeEach(async () => {
    await mockSource.query('DELETE FROM "bearer_key_usage"');
    await mockSource.query('DELETE FROM "bearer_keys"');
  });

  afterAll(async () => {
    if (mockSource?.isInitialized) {
      await mockSource.destroy();
    }
  });

  runPgSuiteAssertions(
    () => mockSource,
    () => dao,
  );
});

dbSuite('BearerKey PostgreSQL (SQL migration 0010-bearer-key-expiry.sql, synchronize: false)', () => {
  let dao: BearerKeyDaoDbImpl;

  beforeAll(async () => {
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [BearerKeyEntity, BearerKeyUsageEntity],
      synchronize: false,
    });
    await mockSource.initialize();

    // Recreate legacy pre-migration bearer_keys schema without expires_at or bearer_key_usage
    await mockSource.query('DROP TABLE IF EXISTS "bearer_key_usage"');
    await mockSource.query('DROP TABLE IF EXISTS "bearer_keys"');
    await mockSource.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE TABLE "bearer_keys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        "token" character varying(512),
        "token_hash" character varying(64),
        "token_prefix" character varying(16),
        "enabled" boolean NOT NULL DEFAULT true,
        "kind" character varying(20) NOT NULL DEFAULT 'system',
        "owner" character varying(255),
        "accessType" character varying(20) NOT NULL DEFAULT 'all',
        "allowedGroups" text,
        "allowedServers" text,
        "excludedGroups" text,
        "excludedServers" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bearer_keys" PRIMARY KEY ("id")
      );
    `);

    const migrationSql = fs.readFileSync(
      path.resolve(process.cwd(), 'docs/migrations/0010-bearer-key-expiry.sql'),
      'utf8',
    );
    // Apply twice to verify idempotency.
    await mockSource.query(migrationSql);
    await mockSource.query(migrationSql);
    await installReplicaSchema(mockSource);
    dao = new BearerKeyDaoDbImpl();
  });

  beforeEach(async () => {
    await mockSource.query('DELETE FROM "bearer_key_usage"');
    await mockSource.query('DELETE FROM "bearer_keys"');
  });

  afterAll(async () => {
    if (mockSource?.isInitialized) {
      await mockSource.destroy();
    }
  });

  runPgSuiteAssertions(
    () => mockSource,
    () => dao,
  );
});
