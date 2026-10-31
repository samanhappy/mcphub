import { DataSource } from 'typeorm';
import { Server } from '../../src/db/entities/Server.js';
import { installReplicaSchema } from '../../src/db/replicaSchema.js';
import express from 'express';
import request from 'supertest';
import { scopedDataSource } from '../../src/db/transactionContext.js';
import { getAppDataSource } from '../../src/db/connection.js';
import { replicaConfiguration } from '../../src/middlewares/replicaConfig.js';
import {
  startReplicaSync,
  stopReplicaSync,
  refreshReplicaConfiguration,
  replicaStatus,
} from '../../src/services/replicaService.js';
import { ServerDaoDbImpl } from '../../src/dao/ServerDaoDbImpl.js';
import { withReplicaLock } from '../../src/services/replicaLock.js';
import { mutateOAuthSettings } from '../../src/services/oauthSettingsStore.js';

let mockSource: DataSource;
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => scopedDataSource(mockSource),
}));
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: () => new ServerDaoDbImpl(),
  getSystemConfigDao: () => ({ get: async () => ({}) }),
}));

const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('replica configuration revisions', () => {
  let source: DataSource;
  let app: express.Application;
  const oldMode = process.env.MCPHUB_REPLICA_MODE;
  beforeAll(async () => {
    source = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      applicationName: 'replica-config-tests',
      entities: [Server],
      synchronize: true,
    });
    await source.initialize();
    mockSource = source;
    await installReplicaSchema(source);
    process.env.MCPHUB_REPLICA_MODE = 'true';
    app = express();
    app.use(express.json(), replicaConfiguration);
    app.get('/servers', async (_req, res) => {
      res.json(await getAppDataSource().getRepository(Server).find());
    });
    app.put('/servers/replica-test', async (req, res) => {
      await getAppDataSource()
        .getRepository(Server)
        .update({ name: 'replica-test' }, { enabled: req.body.enabled });
      res.status(req.body.reject ? 400 : 200).json({ success: !req.body.reject });
    });
    app.post('/servers/broken-transaction', async (_req, res) => {
      await getAppDataSource()
        .query('SELECT 1 / 0')
        .catch(() => undefined);
      res.json({ success: true });
    });
    app.get('/groups/read', (_req, res) => res.json({ name: 'read' }));
  });
  beforeEach(async () => {
    await source.getRepository(Server).delete({ name: 'replica-test' });
  });
  afterAll(async () => {
    await stopReplicaSync();
    await source?.getRepository(Server).delete({ name: 'replica-test' });
    await source?.destroy();
    if (oldMode === undefined) delete process.env.MCPHUB_REPLICA_MODE;
    else process.env.MCPHUB_REPLICA_MODE = oldMode;
  });
  test('commits a revision with configuration and rolls it back with a failed transaction', async () => {
    const [{ exists }] = await source.query(
      "SELECT to_regclass('public.mcphub_revision') IS NOT NULL AS exists",
    );
    expect(exists).toBe(true);
    const revision = async () =>
      (await source.query('SELECT version FROM mcphub_revision WHERE id = 1'))[0].version;
    const initial = await revision();
    await source.getRepository(Server).insert({ name: 'replica-test', enabled: true });
    expect(BigInt(await revision())).toBeGreaterThan(BigInt(initial));
    const committed = await revision();
    await expect(
      source.transaction(async (manager) => {
        await manager.getRepository(Server).update({ name: 'replica-test' }, { enabled: false });
        throw new Error('reject configuration');
      }),
    ).rejects.toThrow('reject configuration');
    expect(await revision()).toBe(committed);
    expect(
      (await source.getRepository(Server).findOneByOrFail({ name: 'replica-test' })).enabled,
    ).toBe(true);
  });

  test('two writes with the same version cannot silently overwrite each other', async () => {
    await source.getRepository(Server).insert({ name: 'replica-test', enabled: true });
    const read = await request(app).get('/servers');
    const version = read.headers['x-mcphub-config-version'];
    const results = await Promise.all(
      [false, true].map((enabled) =>
        request(app).put('/servers/replica-test').set('If-Match', `"${version}"`).send({ enabled }),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([200, 412]);
  });

  test('an unsuccessful API mutation rolls back both data and revision before responding', async () => {
    await source.getRepository(Server).insert({ name: 'replica-test', enabled: true });
    const before = await request(app).get('/servers');
    expect(
      (await request(app).put('/servers/replica-test').send({ enabled: false, reject: true }))
        .status,
    ).toBe(400);
    const after = await request(app).get('/servers');
    expect(after.headers['x-mcphub-config-version']).toBe(
      before.headers['x-mcphub-config-version'],
    );
    expect(after.body[0].enabled).toBe(true);
  });

  test('a failed transaction cannot report success or leave an aborted connection in the pool', async () => {
    expect((await request(app).post('/servers/broken-transaction')).status).toBe(503);
    const [{ count }] = await source.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE application_name = 'replica-config-tests' AND state LIKE 'idle in transaction%'`);
    expect(count).toBe(0);
    expect((await request(app).get('/servers')).status).toBe(200);
  });

  test('resource names do not accidentally opt configuration routes out of versioning', async () => {
    const response = await request(app).get('/groups/read');
    expect(response.status).toBe(200);
    expect(response.headers['x-mcphub-config-version']).toMatch(/^\d+$/);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  test('a replica applies external changes and retries a failed revision without marking it applied', async () => {
    await source.getRepository(Server).insert({ name: 'replica-test', enabled: true });
    const reconcile = jest.fn(async () => {});
    await startReplicaSync(reconcile);
    const applied = replicaStatus().appliedVersion;
    await source.getRepository(Server).update({ name: 'replica-test' }, { enabled: false });
    reconcile.mockRejectedValueOnce(new Error('invalid declaration'));
    await expect(refreshReplicaConfiguration()).rejects.toThrow('invalid declaration');
    expect(replicaStatus().appliedVersion).toBe(applied);
    expect(replicaStatus().lastError).toBe('invalid declaration');
    await refreshReplicaConfiguration();
    expect(replicaStatus().appliedVersion).toBe(replicaStatus().desiredVersion);
    expect(replicaStatus().lastError).toBeNull();
    expect(reconcile).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: 'replica-test', enabled: false }),
    ]);
    await stopReplicaSync();
  });

  test('credential-scoped locks serialize concurrent actions, are reentrant and release after failure', async () => {
    let active = 0;
    let peak = 0;
    const action = () =>
      withReplicaLock('refresh-test', async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await withReplicaLock('refresh-test', async () => {
          expect(active).toBe(1);
        });
        active--;
      });
    await Promise.all([action(), action()]);
    expect(peak).toBe(1);
    await expect(
      withReplicaLock('refresh-test', async () => {
        throw new Error('upstream failed');
      }),
    ).rejects.toThrow('upstream failed');
    await expect(action()).resolves.toBeUndefined();
  });

  test('a concurrent OAuth write cannot replace a newer credential revision', async () => {
    await source
      .getRepository(Server)
      .insert({ name: 'replica-test', oauth: { accessToken: 'old' } });
    const results = await Promise.allSettled(
      ['first', 'second'].map((accessToken) =>
        mutateOAuthSettings('replica-test', ({ oauth }) => {
          oauth.accessToken = accessToken;
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
