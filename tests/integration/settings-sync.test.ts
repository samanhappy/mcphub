import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import { Server } from '../../src/db/entities/Server.js';
import { Group } from '../../src/db/entities/Group.js';
import { syncSettingsToDatabase } from '../../src/utils/settingsSync.js';

let settingsPath: string;
const servers = new Map<string, Record<string, unknown>>();
const groups = new Map<string, Record<string, unknown>>();
let failGroupSave = false;
const transaction = jest.fn(async (run: (manager: unknown) => Promise<void>) => {
  const beforeServers = new Map(servers);
  const beforeGroups = new Map(groups);
  try {
    await run({
      getRepository: (entity: unknown) => {
        const rows = entity === Server ? servers : groups;
        return {
          metadata: {
            columns: getMetadataArgsStorage()
              .columns.filter((column) => column.target === entity)
              .map((column) => ({
                propertyName: column.propertyName,
                isNullable: column.options.nullable,
              })),
          },
          findOneBy: async ({ name }: { name: string }) => rows.get(name) ?? null,
          create: (value: Record<string, unknown>) => value,
          save: async (value: Record<string, unknown>) => {
            if (entity === Group && failGroupSave) throw new Error('DB write failed');
            rows.set(value.name as string, { id: value.id ?? `id-${value.name}`, ...value });
          },
        };
      },
    });
  } catch (error) {
    servers.clear();
    groups.clear();
    beforeServers.forEach((value, key) => servers.set(key, value));
    beforeGroups.forEach((value, key) => groups.set(key, value));
    throw error;
  }
});
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => ({ transaction }) }));
jest.mock('../../src/config/index.js', () => ({
  getSettingsPath: () => settingsPath,
  replaceEnvVars: jest.requireActual('../../src/config/index.js').replaceEnvVars,
}));

const write = (value: unknown) => fs.writeFileSync(settingsPath, JSON.stringify(value));
const remote = { type: 'streamable-http', url: 'https://example.com/mcp' };

beforeEach(() => {
  settingsPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'settings-sync-')),
    'settings.json',
  );
  servers.clear();
  groups.clear();
  failGroupSave = false;
  process.env.MCPHUB_SETTINGS_SYNC = 'upsert';
});
afterEach(() => {
  fs.rmSync(path.dirname(settingsPath), { recursive: true, force: true });
  delete process.env.MCPHUB_SETTINGS_SYNC;
});

test('upserts by name, retains IDs and unrelated entries, clears removed fields on restart', async () => {
  servers.set('ui-only', { id: 'keep', name: 'ui-only' });
  servers.set('remote', {
    id: 'existing-server',
    name: 'remote',
    ...remote,
    headers: { stale: 'value' },
  });
  groups.set('team', { id: 'existing-group', name: 'team', owner: 'old-owner' });
  write({
    mcpServers: { remote, local: { command: 'node', startOnDemand: true, idleTimeoutMs: 1000 } },
    groups: [{ name: 'team', servers: [{ name: 'remote', alias: 'r', tools: ['search'] }] }],
    users: [{ username: 'ignored' }],
    bearerKeys: ['ignored'],
    systemConfig: { routing: {} },
  });
  const before = fs.readFileSync(settingsPath, 'utf8');
  fs.chmodSync(settingsPath, 0o444);
  const writeSpy = jest.spyOn(fs, 'writeFileSync');
  await syncSettingsToDatabase();
  expect(writeSpy).not.toHaveBeenCalled();
  writeSpy.mockRestore();
  expect(servers.get('remote')).toMatchObject({
    id: 'existing-server',
    headers: null,
    enabled: true,
    visibility: 'private',
  });
  expect(servers.get('local')).toMatchObject({
    options: { startOnDemand: true, idleTimeoutMs: 1000 },
  });
  expect(groups.get('team')).toMatchObject({
    id: 'existing-group',
    owner: null,
    servers: [{ name: 'remote', alias: 'r', tools: ['search'] }],
  });
  const snapshot = [...servers.entries()];
  await syncSettingsToDatabase();
  expect([...servers.entries()]).toEqual(snapshot);
  expect(servers.get('ui-only')).toEqual({ id: 'keep', name: 'ui-only' });
  expect(fs.readFileSync(settingsPath, 'utf8')).toBe(before);
});

test('preserves runtime OAuth on unchanged declarations and invalidates it when declarations change', async () => {
  write({ mcpServers: { remote: { ...remote, oauth: { scopes: ['read'] } } } });
  await syncSettingsToDatabase();
  const stored = servers.get('remote')!;
  stored.oauth = {
    scopes: ['read'],
    clientId: 'dynamic-client',
    clientSecret: 'secret',
    accessToken: 'token',
    refreshToken: 'refresh',
    pendingAuthorization: { state: 'state' },
  };
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(stored.oauth);
  write({
    mcpServers: { remote: { ...remote, oauth: { scopes: ['write'], accessToken: 'file-token' } } },
  });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual({ scopes: ['write'] });
  write({ mcpServers: { remote } });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toBeNull();
});

test('invalidates OAuth when the upstream URL or an expanded secret changes', async () => {
  process.env.SYNC_TEST_SECRET = 'first';
  const config = { ...remote, oauth: { clientSecret: '${SYNC_TEST_SECRET}' } };
  write({ mcpServers: { remote: config } });
  await syncSettingsToDatabase();
  servers.get('remote')!.oauth = { ...config.oauth, accessToken: 'old' };
  process.env.SYNC_TEST_SECRET = 'second';
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(config.oauth);
  servers.get('remote')!.oauth = { ...config.oauth, accessToken: 'old' };
  write({ mcpServers: { remote: { ...config, url: 'https://other.example/mcp' } } });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(config.oauth);
  delete process.env.SYNC_TEST_SECRET;
});

test('validates all declarations before writing and rolls back failed database writes', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'duplicate' }, { name: 'duplicate' }] });
  await expect(syncSettingsToDatabase()).rejects.toThrow('Duplicate');
  expect(transaction).not.toHaveBeenCalled();
  write({ mcpServers: { remote, invalid: { type: 'stdio' } } });
  await expect(syncSettingsToDatabase()).rejects.toThrow('connection configuration');
  expect(transaction).not.toHaveBeenCalled();
  write({ mcpServers: { remote }, groups: [{ name: 'team' }] });
  failGroupSave = true;
  await expect(syncSettingsToDatabase()).rejects.toThrow('DB write failed');
  expect(servers.size).toBe(0);
});

test('disabled mode does not read the file; invalid mode or missing file fails explicitly', async () => {
  delete process.env.MCPHUB_SETTINGS_SYNC;
  await syncSettingsToDatabase();
  expect(transaction).not.toHaveBeenCalled();
  process.env.MCPHUB_SETTINGS_SYNC = 'prune';
  await expect(syncSettingsToDatabase()).rejects.toThrow('Unsupported');
  process.env.MCPHUB_SETTINGS_SYNC = 'upsert';
  await expect(syncSettingsToDatabase()).rejects.toThrow();
});

test('adopts matching UI-created OAuth state and ignores formatting-only changes', async () => {
  const state = {
    clientId: 'client',
    scopes: ['read'],
    accessToken: 'live',
    refreshToken: 'refresh',
  };
  servers.set('remote', { id: 'ui', name: 'remote', ...remote, oauth: state });
  write({ mcpServers: { remote: { ...remote, oauth: { scopes: ['read'], clientId: 'client' } } } });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(state);
  write({ mcpServers: { remote: { ...remote, oauth: { clientId: 'client', scopes: ['read'] } } } });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(state);
});

test('resolves server env when deciding whether authorization can be reused', async () => {
  const config = {
    ...remote,
    env: { SYNC_SERVER_SECRET: 'first' },
    oauth: { clientSecret: '${SYNC_SERVER_SECRET}' },
  };
  write({ mcpServers: { remote: config } });
  await syncSettingsToDatabase();
  servers.get('remote')!.oauth = { ...config.oauth, accessToken: 'live' };
  write({ mcpServers: { remote: { ...config, env: { SYNC_SERVER_SECRET: 'second' } } } });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(config.oauth);
});

test('discards tokens obtained after a dashboard edit to declared OAuth credentials', async () => {
  const config = { ...remote, oauth: { clientId: 'git-client' } };
  write({ mcpServers: { remote: config } });
  await syncSettingsToDatabase();
  servers.get('remote')!.oauth = { clientId: 'dashboard-client', accessToken: 'dashboard-token' };
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(config.oauth);
});

test('salts persisted fingerprints independently while retaining authorization after restart', async () => {
  const config = { ...remote, oauth: { clientSecret: 'a'.repeat(100) } };
  write({ mcpServers: { alpha: config, beta: config } });
  await syncSettingsToDatabase();
  expect(servers.get('alpha')?.settingsSyncHash).not.toEqual(servers.get('beta')?.settingsSyncHash);
  servers.get('alpha')!.oauth = { ...config.oauth, accessToken: 'live' };
  await syncSettingsToDatabase();
  expect(servers.get('alpha')?.oauth).toEqual({ ...config.oauth, accessToken: 'live' });
  write({ mcpServers: { alpha: { ...config, oauth: { clientSecret: 'a'.repeat(99) + 'b' } } } });
  await syncSettingsToDatabase();
  expect(servers.get('alpha')?.oauth).toEqual({ clientSecret: 'a'.repeat(99) + 'b' });
});
