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
    const query = jest.fn<(...args: unknown[]) => Promise<Array<{ key_id: string }>>>().mockResolvedValue([
      { key_id: '11111111-1111-4111-8111-111111111111' },
    ]);
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
});

// Runs against a disposable local PostgreSQL database when MCPHUB_TEST_PG_PORT is set.
const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('BearerKey expiry, isolated lastUsedAt, and replica revision invariance (PostgreSQL)', () => {
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

  const getRevision = async (): Promise<number> => {
    const [{ version }] = await mockSource.query(
      'SELECT version FROM mcphub_revision WHERE id = 1',
    );
    return Number(version);
  };

  it('persists expiresAt, preserves on omission, clears on null, and leaves replica revision unchanged on recordLastUsed', async () => {
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

    const fetched = await dao.findById(created.id);
    expect(fetched?.lastUsedAt).toBe(t1.toISOString());

    // Older timestamp does not move lastUsedAt backwards
    const older = new Date('2026-11-27T09:00:00.000Z');
    expect(await dao.recordLastUsed(created.id, older)).toBe(false);
    expect((await dao.findById(created.id))?.lastUsedAt).toBe(t1.toISOString());
    expect(await getRevision()).toBe(revBeforeUsage);

    // Explicit clear removes expiresAt (and DOES bump revision as a config change)
    const cleared = await dao.update(created.id, { expiresAt: null });
    expect(cleared?.expiresAt).toBeUndefined();
    expect(cleared?.lastUsedAt).toBe(t1.toISOString());
    expect(await getRevision()).toBeGreaterThan(revBeforeUsage);

    // Deleting the key cleans up usage and subsequent recordLastUsed does not recreate it
    expect(await dao.delete(created.id)).toBe(true);
    expect(await dao.recordLastUsed(created.id, new Date('2026-11-27T11:00:00.000Z'))).toBe(false);
    expect(await dao.findById(created.id)).toBeUndefined();
  });
});
