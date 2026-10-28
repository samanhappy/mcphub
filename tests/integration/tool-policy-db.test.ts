import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { Server } from '../../src/db/entities/Server.js';
import { Group } from '../../src/db/entities/Group.js';
import { CredentialBinding } from '../../src/db/entities/CredentialBinding.js';
import { syncSettingsToDatabase } from '../../src/utils/settingsSync.js';
import { evaluateToolPolicy, findMissingToolPolicyReferences } from '../../src/utils/toolPolicy.js';
import { logger } from '../../src/utils/logger.js';
import { SystemConfig } from '../../src/db/entities/SystemConfig.js';
import { SystemConfigDaoDbImpl } from '../../src/dao/SystemConfigDaoDbImpl.js';
import { getToolPolicy } from '../../src/services/toolPolicyService.js';

let mockSource: DataSource;
let mockSettingsPath: string;
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => mockSource }));
jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: () => new SystemConfigDaoDbImpl(),
  getServerDao: () => ({ findAll: async () => [{ id: 'server-id', name: 'demo' }] }),
}));
jest.mock('../../src/config/index.js', () => ({
  getNameSeparator: () => '-',
  getSettingsPath: () => mockSettingsPath,
  replaceEnvVars: jest.requireActual('../../src/config/index.js').replaceEnvVars,
}));

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
      entities: [SystemConfig, Server, Group, CredentialBinding],
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
  test('declarative renames require a pinned ID to preserve deny policies', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-policy-sync-'));
    mockSettingsPath = path.join(directory, 'settings.json');
    const previousMode = process.env.MCPHUB_SETTINGS_SYNC;
    process.env.MCPHUB_SETTINGS_SYNC = 'prune';
    const repo = mockSource.getRepository(Server);
    const write = (name: string, id?: string) =>
      fs.writeFileSync(
        mockSettingsPath,
        JSON.stringify({
          mcpServers: { [name]: { type: 'streamable-http', url: 'https://example.com/mcp', id } },
        }),
      );
    const warn = jest.spyOn(logger, 'warn');
    try {
      await repo.clear();
      write('time');
      await syncSettingsToDatabase();
      const original = await repo.findOneByOrFail({ name: 'time' });
      const policies = [{ id: 'deny-time', effect: 'deny' as const, serverId: original.id }];
      await dao.update({ toolPolicies: policies });
      write('clock');
      await syncSettingsToDatabase();
      const renamed = await repo.findOneByOrFail({ name: 'clock' });
      expect(renamed.id).not.toBe(original.id);
      expect(await repo.findOneBy({ name: 'time' })).toBeNull();
      expect(
        evaluateToolPolicy((await dao.get()).toolPolicies!, {}, { serverId: renamed.id }).decision,
      ).toBe('allow');
      expect(
        findMissingToolPolicyReferences(policies, {
          serverId: [renamed.id],
          keyId: [],
          groupId: [],
        }),
      ).toEqual([{ policyId: 'deny-time', selector: 'serverId', value: original.id }]);
      await repo.clear();
      write('time', original.id);
      await syncSettingsToDatabase();
      write('clock', original.id);
      await syncSettingsToDatabase();
      expect((await repo.findOneByOrFail({ name: 'clock' })).id).toBe(original.id);
      expect(await repo.count()).toBe(1);
      expect(evaluateToolPolicy(policies, {}, { serverId: original.id }).decision).toBe('deny');
      write('clock', renamed.id);
      await syncSettingsToDatabase();
      expect((await repo.findOneByOrFail({ name: 'clock' })).id).toBe(original.id);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ignoring declared ID'),
        expect.objectContaining({
          serverName: 'clock',
          declaredId: renamed.id,
          retainedId: original.id,
        }),
      );
    } finally {
      warn.mockRestore();
      await repo.clear();
      fs.rmSync(directory, { recursive: true, force: true });
      if (previousMode === undefined) delete process.env.MCPHUB_SETTINGS_SYNC;
      else process.env.MCPHUB_SETTINGS_SYNC = previousMode;
    }
  });
});
