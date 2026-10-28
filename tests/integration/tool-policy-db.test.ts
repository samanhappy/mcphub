import { DataSource } from 'typeorm';
import { SystemConfig } from '../../src/db/entities/SystemConfig.js';
import { SystemConfigDaoDbImpl } from '../../src/dao/SystemConfigDaoDbImpl.js';
import { getToolPolicy } from '../../src/services/toolPolicyService.js';

let mockSource: DataSource;
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => mockSource }));
jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: () => new SystemConfigDaoDbImpl(),
  getServerDao: () => ({ findAll: async () => [{ id: 'server-id', name: 'demo' }] }),
}));
jest.mock('../../src/config/index.js', () => ({ getNameSeparator: () => '-' }));

// Only run against an explicitly supplied disposable local PostgreSQL database.
const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('tool policy PostgreSQL persistence', () => {
  const dao = new SystemConfigDaoDbImpl();
  const tools = [{ name: 'demo-read', inputSchema: { type: 'object' as const } }];
  const rules = [
    { id: 'block-read', effect: 'deny' as const, serverId: 'server-id', tool: 'read' },
  ];

  beforeAll(async () => {
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [SystemConfig],
      synchronize: true,
    });
    await mockSource.initialize();
  });
  beforeEach(async () => {
    await mockSource.getRepository(SystemConfig).clear();
  });
  afterAll(async () => {
    if (mockSource?.isInitialized) {
      await mockSource.getRepository(SystemConfig).clear();
      await mockSource.destroy();
    }
  });

  test('fresh SQL NULL defaults preserve listing and invocation authorization', async () => {
    expect((await dao.get()).toolPolicies).toEqual([]);
    expect(
      (await mockSource.getRepository(SystemConfig).findOneByOrFail({ id: 'default' }))
        .toolPolicies,
    ).toBeNull();
    const policy = await getToolPolicy();
    expect(policy.filterTools('demo', tools)).toEqual(tools);
    expect(policy.authorize('demo', 'read').decision).toBe('allow');
    expect((await dao.update({ nameSeparator: '_' })).toolPolicies).toEqual([]);
  });

  test('synchronizing an old table adds nullable policies without changing existing settings', async () => {
    await dao.update({ nameSeparator: '_' });
    await mockSource.query('ALTER TABLE system_config DROP COLUMN "toolPolicies"');
    await mockSource.synchronize();
    expect(await dao.get()).toMatchObject({ nameSeparator: '_', toolPolicies: [] });
    expect((await getToolPolicy()).authorize('demo', 'read').decision).toBe('allow');
  });

  test('saved policies survive reconnect and clearing restores default access', async () => {
    await dao.update({ toolPolicies: rules });
    await mockSource.destroy();
    await mockSource.initialize();
    expect((await new SystemConfigDaoDbImpl().get()).toolPolicies).toEqual(rules);
    const policy = await getToolPolicy();
    expect(policy.filterTools('demo', tools)).toEqual([]);
    expect(policy.authorize('demo', 'read')).toMatchObject({
      decision: 'deny',
      policyId: 'block-read',
    });
    await dao.updateSection('toolPolicies', []);
    expect((await dao.get()).toolPolicies).toEqual([]);
    expect((await getToolPolicy()).filterTools('demo', tools)).toEqual(tools);
    await dao.update({ toolPolicies: rules });
    expect((await dao.reset()).toolPolicies).toEqual([]);
  });

  test('malformed writes are rejected without overwriting persisted policies', async () => {
    await dao.update({ toolPolicies: rules });
    await expect(dao.update({ toolPolicies: null as never })).rejects.toThrow();
    await expect(
      dao.updateSection('toolPolicies', [{ id: 'bad', effect: 'typo' }] as never),
    ).rejects.toThrow();
    expect((await dao.get()).toolPolicies).toEqual(rules);
    await mockSource.query('UPDATE system_config SET "toolPolicies" = $1', [
      JSON.stringify({ invalid: true }),
    ]);
    await expect(getToolPolicy()).rejects.toThrow('toolPolicies must be an array');
  });
});
