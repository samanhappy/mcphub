import { loadOriginalSettings } from '../../src/config/index.js';
import { ServerDaoDbImpl } from '../../src/dao/ServerDaoDbImpl.js';
import {
  clearOAuthData,
  persistClientCredentials,
  persistTokens,
} from '../../src/services/oauthSettingsStore.js';
import { logger } from '../../src/utils/logger.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import { Server } from '../../src/db/entities/Server.js';
import { CredentialBinding } from '../../src/db/entities/CredentialBinding.js';
import { Group } from '../../src/db/entities/Group.js';
import { initializeDatabaseMode } from '../../src/utils/migration.js';
import { syncSettingsToDatabase } from '../../src/utils/settingsSync.js';

let settingsPath: string;
const servers = new Map<string, Record<string, unknown>>();
const groups = new Map<string, Record<string, unknown>>();
let failGroupSave = false;
let failDelete = false;
let vectorTableExists = true;
const bindings = new Map<string, Record<string, unknown>>();
const embeddings = new Map<string, Record<string, unknown>>();
const query = jest.fn(async (sql: string, parameters?: string[]) => {
  if (sql.startsWith('SELECT')) return [{ exists: vectorTableExists }];
  const serverName = parameters![0];
  for (const [key, row] of embeddings) {
    if (
      (row.content_type === 'server' && row.content_id === serverName) ||
      (row.content_type === 'tool' && String(row.content_id).startsWith(`${serverName}:`))
    ) {
      embeddings.delete(key);
    }
  }
  return [];
});
const saveDeclaration = jest.fn();
const transaction = jest.fn(async (run: (manager: unknown) => Promise<void>) => {
  const beforeServers = new Map(servers);
  const beforeGroups = new Map(groups);
  const beforeBindings = new Map(bindings);
  const beforeEmbeddings = new Map(embeddings);
  try {
    await run({
      query,
      getRepository: (entity: unknown) => {
        const rows = entity === Server ? servers : entity === Group ? groups : bindings;
        return {
          metadata: {
            columns: getMetadataArgsStorage()
              .columns.filter((column) => column.target === entity)
              .map((column) => ({
                propertyName: column.propertyName,
                isNullable: column.options.nullable,
              })),
          },
          find: async () => [...rows.values()],
          delete: async (criteria: Record<string, unknown>) => {
            if (failDelete && entity === Server) throw new Error('DB delete failed');
            for (const [key, row] of rows) {
              if (Object.entries(criteria).every(([field, value]) => row[field] === value))
                rows.delete(key);
            }
          },
          update: async (criteria: Record<string, unknown>, patch: Record<string, unknown>) => {
            for (const [key, row] of rows) {
              if (Object.entries(criteria).every(([field, value]) => row[field] === value))
                rows.set(key, { ...row, ...patch });
            }
          },
          findOneBy: async ({ name }: { name: string }) => rows.get(name) ?? null,
          create: (value: Record<string, unknown>) => value,
          save: async (value: Record<string, unknown>) => {
            saveDeclaration(entity);
            if (entity === Group && failGroupSave) throw new Error('DB write failed');
            rows.set(value.name as string, { id: value.id ?? `id-${value.name}`, ...value });
          },
        };
      },
    });
  } catch (error) {
    servers.clear();
    groups.clear();
    bindings.clear();
    embeddings.clear();
    beforeBindings.forEach((value, key) => bindings.set(key, value));
    beforeEmbeddings.forEach((value, key) => embeddings.set(key, value));
    beforeServers.forEach((value, key) => servers.set(key, value));
    beforeGroups.forEach((value, key) => groups.set(key, value));
    throw error;
  }
});
const seedServer = jest.fn(async (value: Record<string, unknown>) => {
  servers.set(value.name as string, { id: `id-${value.name}`, ...value });
});
const seedGroup = jest.fn(async (value: Record<string, unknown>) => {
  groups.set(value.name as string, { id: `id-${value.name}`, ...value });
});
const seedUser = jest.fn();
jest.mock('../../src/db/connection.js', () => ({
  initializeDatabase: jest.fn(),
  getAppDataSource: () => ({ transaction }),
}));
jest.mock('../../src/dao/index.js', () => ({
  getServerDao: () => new ServerDaoDbImpl(),
  getUserDao: () => ({ findByUsername: async () => ({ isAdmin: false }) }),
}));
jest.mock('../../src/dao/DaoFactory.js', () => ({ setDaoFactory: jest.fn() }));
jest.mock('../../src/dao/DatabaseDaoFactory.js', () => ({
  DatabaseDaoFactory: { getInstance: () => ({}) },
}));
jest.mock('../../src/dao/CredentialBindingDao.js', () => ({
  CredentialBindingDaoImpl: jest.fn(() => ({ readAll: () => [] })),
}));
jest.mock('../../src/db/repositories/UserRepository.js', () => ({
  UserRepository: jest.fn(() => ({
    count: async () => 0,
    exists: async () => false,
    create: seedUser,
  })),
}));
jest.mock('../../src/db/repositories/ServerRepository.js', () => ({
  ServerRepository: jest.fn(() => ({
    exists: async (name: string) => servers.has(name),
    create: seedServer,
    findByName: async (name: string) => servers.get(name) ?? null,
    update: async (name: string, patch: Record<string, unknown>) => {
      const current = servers.get(name);
      if (!current) return null;
      const updated = { ...current, ...patch };
      servers.set(name, updated);
      return updated;
    },
  })),
}));
jest.mock('../../src/db/repositories/GroupRepository.js', () => ({
  GroupRepository: jest.fn(() => ({
    existsByName: async (name: string) => groups.has(name),
    create: seedGroup,
  })),
}));
jest.mock('../../src/config/index.js', () => ({
  getSettingsPath: () => settingsPath,
  loadOriginalSettings: jest.fn(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8'))),
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
  failDelete = false;
  vectorTableExists = true;
  bindings.clear();
  embeddings.clear();
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
    groups: [{ name: 'team', servers: [{ name: 'remote', alias: 'r', preserveToolNames: true, tools: ['search'] }] }],
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
    servers: [{ name: 'remote', alias: 'r', preserveToolNames: true, tools: ['search'] }],
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

test.each(['upsert', 'prune'])(
  'validates declarations and rolls back failed writes in %s mode',
  async (mode) => {
    process.env.MCPHUB_SETTINGS_SYNC = mode;
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
  },
);

test.each(['upsert', 'prune'])(
  'disabled mode does not read files; invalid mode or missing file fails explicitly (%s)',
  async (mode) => {
    delete process.env.MCPHUB_SETTINGS_SYNC;
    await syncSettingsToDatabase();
    expect(transaction).not.toHaveBeenCalled();
    process.env.MCPHUB_SETTINGS_SYNC = 'unknown';
    await expect(syncSettingsToDatabase()).rejects.toThrow('Unsupported');
    process.env.MCPHUB_SETTINGS_SYNC = mode;
    await expect(syncSettingsToDatabase()).rejects.toThrow();
  },
);

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
  await new ServerDaoDbImpl().update('remote', {
    oauth: { clientId: 'dashboard-client', accessToken: 'dashboard-token' },
  });
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

test('first boot seeds users but imports server OAuth only through sync', async () => {
  write({
    users: [{ username: 'admin', password: 'hashed', isAdmin: true }],
    mcpServers: {
      remote: {
        ...remote,
        oauth: {
          clientId: 'declared',
          accessToken: 'file-token',
          refreshToken: 'file-refresh',
          pendingAuthorization: { state: 'file-state' },
        },
      },
    },
    groups: [{ name: 'team', servers: ['remote'] }],
  });
  await expect(initializeDatabaseMode()).resolves.toBe(true);
  expect(seedUser).toHaveBeenCalled();
  expect(seedServer).not.toHaveBeenCalled();
  expect(seedGroup).not.toHaveBeenCalled();
  expect(servers.get('remote')?.oauth).toEqual({ clientId: 'declared' });
  expect(groups.get('team')?.servers).toEqual(['remote']);
});

test('first boot rejects duplicate groups without persisting servers or groups', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'team' }, { name: 'team' }] });
  await expect(initializeDatabaseMode()).resolves.toBe(false);
  expect(servers.size).toBe(0);
  expect(groups.size).toBe(0);
  expect(transaction).not.toHaveBeenCalled();
});

test('first boot rolls back all server and group writes on sync failure', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'team' }] });
  failGroupSave = true;
  await expect(initializeDatabaseMode()).resolves.toBe(false);
  expect(servers.size).toBe(0);
  expect(groups.size).toBe(0);
});

test('first boot without sync retains the original server and group seed', async () => {
  delete process.env.MCPHUB_SETTINGS_SYNC;
  write({
    mcpServers: { remote: { ...remote, oauth: { accessToken: 'seed-token' } } },
    groups: [{ name: 'team', servers: ['remote'] }],
  });
  await expect(initializeDatabaseMode()).resolves.toBe(true);
  expect(seedServer).toHaveBeenCalledTimes(1);
  expect(seedGroup).toHaveBeenCalledTimes(1);
  expect(servers.get('remote')?.oauth).toEqual({ accessToken: 'seed-token' });
  expect(transaction).not.toHaveBeenCalled();
});

test('retains runtime registration scopes and discovered endpoints on unchanged declarations', async () => {
  const config = {
    ...remote,
    oauth: { scopes: ['read', 'write'], dynamicRegistration: { enabled: true } },
  };
  write({ mcpServers: { remote: config } });
  await syncSettingsToDatabase();
  const hash = servers.get('remote')?.settingsSyncHash;
  await persistClientCredentials('remote', {
    clientId: 'registered',
    clientSecret: 'secret',
    scopes: ['read'],
    authorizationEndpoint: 'https://example.com/auth',
    tokenEndpoint: 'https://example.com/token',
  });
  await persistTokens('remote', { accessToken: 'live', refreshToken: 'refresh' });
  const oauth = servers.get('remote')?.oauth;
  expect(servers.get('remote')?.settingsSyncHash).toBe(hash);
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(oauth);
  expect(await new ServerDaoDbImpl().findById('remote')).not.toHaveProperty('settingsSyncHash');
  await new ServerDaoDbImpl().update('remote', {
    oauth: { ...config.oauth, scopes: ['admin'], accessToken: 'dashboard' },
  });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(config.oauth);
});

test('an edit to undeclared OAuth fields invalidates authorization instead of triggering adoption', async () => {
  write({
    mcpServers: { remote: { ...remote, oauth: { dynamicRegistration: { enabled: true } } } },
  });
  await syncSettingsToDatabase();
  await persistClientCredentials('remote', { clientId: 'discovered' });
  await persistTokens('remote', { accessToken: 'live' });
  await new ServerDaoDbImpl().update('remote', {
    oauth: { clientId: 'dashboard', accessToken: 'dashboard-token' },
  });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual({ dynamicRegistration: { enabled: true } });
});

test('omitted ownership is cleared on adoption; explicitly declared ownership is retained', async () => {
  servers.set('remote', {
    id: 'owned',
    name: 'remote',
    ...remote,
    owner: 'alice',
    sharedWithUsers: [],
  });
  groups.set('team', { id: 'owned-group', name: 'team', owner: 'alice', sharedWithUsers: [] });
  write({ mcpServers: { remote }, groups: [{ name: 'team' }] });
  await syncSettingsToDatabase();
  expect(servers.get('remote')).toMatchObject({ id: 'owned', owner: null, sharedWithUsers: null });
  expect(groups.get('team')).toMatchObject({
    id: 'owned-group',
    owner: null,
    sharedWithUsers: null,
  });
  write({
    mcpServers: { remote: { ...remote, owner: 'alice' } },
    groups: [{ name: 'team', owner: 'alice' }],
  });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.owner).toBe('alice');
  expect(groups.get('team')?.owner).toBe('alice');
});

test('syncs group instructions and clears them when the key is removed', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'team', instructions: 'Use fetch first.' }] });
  await syncSettingsToDatabase();
  expect(groups.get('team')?.instructions).toBe('Use fetch first.');
  write({ mcpServers: { remote }, groups: [{ name: 'team' }] });
  await syncSettingsToDatabase();
  expect(groups.get('team')?.instructions).toBeNull();
});

test('rejects non-string group instructions', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'team', instructions: 42 }] });
  await expect(syncSettingsToDatabase()).rejects.toThrow();
  expect(groups.size).toBe(0);
});

test('keeps hiddenParams in per-tool server config', async () => {
  const tools = { scrape: { enabled: true, hiddenParams: ['profile'] } };
  write({ mcpServers: { remote: { ...remote, tools } } });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.tools).toEqual(tools);
});

test('reports created, updated and unchanged entries and skips unchanged saves', async () => {
  const log = jest.spyOn(logger, 'log');
  write({ mcpServers: { remote }, groups: [{ name: 'team', servers: ['remote'] }] });
  await syncSettingsToDatabase();
  expect(log).toHaveBeenLastCalledWith(
    'Settings sync completed: servers (1 created, 0 updated, 0 unchanged, 0 deleted); groups (1 created, 0 updated, 0 unchanged, 0 deleted)',
  );
  saveDeclaration.mockClear();
  await syncSettingsToDatabase();
  expect(saveDeclaration).not.toHaveBeenCalled();
  expect(log).toHaveBeenLastCalledWith(
    'Settings sync completed: servers (0 created, 0 updated, 1 unchanged, 0 deleted); groups (0 created, 0 updated, 1 unchanged, 0 deleted)',
  );
  write({
    mcpServers: { remote: { ...remote, description: 'new' } },
    groups: [{ name: 'team', servers: [] }],
  });
  await syncSettingsToDatabase();
  expect(log).toHaveBeenLastCalledWith(
    'Settings sync completed: servers (0 created, 1 updated, 0 unchanged, 0 deleted); groups (0 created, 1 updated, 0 unchanged, 0 deleted)',
  );
  log.mockRestore();
});

test('configuration edits invalidate provenance while unrelated and identical edits retain it', async () => {
  write({ mcpServers: { remote } });
  await syncSettingsToDatabase();
  await persistClientCredentials('remote', { clientId: 'dynamic' });
  await persistTokens('remote', { accessToken: 'live' });
  const dao = new ServerDaoDbImpl();
  const hash = servers.get('remote')?.settingsSyncHash;
  await dao.update('remote', { description: 'dashboard description' });
  await dao.update('remote', { oauth: (await dao.findById('remote'))!.oauth });
  expect(servers.get('remote')?.settingsSyncHash).toBe(hash);
  await syncSettingsToDatabase();
  expect((servers.get('remote')?.oauth as Record<string, unknown>).accessToken).toBe('live');
  await dao.update('remote', { env: { AUTH_TARGET: 'changed' } });
  await persistTokens('remote', { accessToken: 'dashboard-target-token' });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toBeNull();
});

test('restores declared client credentials after runtime clearing without restoring old tokens', async () => {
  const config = {
    ...remote,
    oauth: { clientId: 'static', clientSecret: 'secret', scopes: ['read'] },
  };
  write({ mcpServers: { remote: config } });
  await syncSettingsToDatabase();
  await persistTokens('remote', { accessToken: 'old', refreshToken: 'old-refresh' });
  await clearOAuthData('remote', 'all');
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.oauth).toEqual(config.oauth);
});

test.each(['server', 'group'])(
  'rejects a reserved %s declaration before opening the sync transaction',
  async (kind) => {
    const previous = process.env.SMART_ROUTING_PATH;
    process.env.SMART_ROUTING_PATH = 'my_smart';
    try {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(
          kind === 'server'
            ? {
                mcpServers: {
                  my_smart: { type: 'streamable-http', url: 'http://example.test/mcp' },
                },
              }
            : { groups: [{ name: 'my_smart', servers: [] }] },
        ),
      );
      await expect(syncSettingsToDatabase()).rejects.toThrow('SMART_ROUTING_PATH');
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SMART_ROUTING_PATH;
      else process.env.SMART_ROUTING_PATH = previous;
    }
  },
);

test('prunes only managed entries, including legacy fingerprinted servers, and cleans references and runtime data', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'managed', servers: ['remote'] }] });
  await syncSettingsToDatabase();
  servers.set('legacy', { id: 'legacy', name: 'legacy', settingsSyncHash: 'invalidated' });
  servers.set('ui', { id: 'ui', name: 'ui' });
  groups.set('ui', {
    id: 'ui',
    name: 'ui',
    servers: ['remote', { name: 'legacy', alias: 'old' }, 'ui'],
  });
  bindings.set('remote', { serverName: 'remote', username: 'alice' });
  bindings.set('ui', { serverName: 'ui', username: 'alice' });
  embeddings.set('remote', { content_type: 'server', content_id: 'remote' });
  embeddings.set('tool', { content_type: 'tool', content_id: 'remote:search' });
  embeddings.set('other', { content_type: 'tool', content_id: 'remote-other:search' });
  process.env.MCPHUB_SETTINGS_SYNC = 'prune';
  write({ mcpServers: {}, groups: [] });
  await syncSettingsToDatabase();
  expect([...servers.keys()]).toEqual(['ui']);
  expect([...groups.keys()]).toEqual(['ui']);
  expect(groups.get('ui')?.servers).toEqual(['ui']);
  expect([...bindings.keys()]).toEqual(['ui']);
  expect([...embeddings.keys()]).toEqual(['other']);
  await syncSettingsToDatabase();
  expect([...servers.keys()]).toEqual(['ui']);
});

test('omitted sections retain managed entries; empty sections prune only their own type', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'managed' }] });
  await syncSettingsToDatabase();
  process.env.MCPHUB_SETTINGS_SYNC = 'prune';
  write({});
  await syncSettingsToDatabase();
  expect(servers.has('remote')).toBe(true);
  expect(groups.has('managed')).toBe(true);
  write({ groups: [] });
  await syncSettingsToDatabase();
  expect(groups.size).toBe(0);
  expect(servers.has('remote')).toBe(true);
  vectorTableExists = false;
  write({ mcpServers: {} });
  await syncSettingsToDatabase();
  expect(servers.size).toBe(0);
  expect(query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE'), expect.anything());
});

test('upsert retains removed managed entries and dashboard edits retain ownership', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'managed' }] });
  await syncSettingsToDatabase();
  await new ServerDaoDbImpl().update('remote', { description: 'UI edit' });
  write({ mcpServers: {}, groups: [] });
  await syncSettingsToDatabase();
  expect(servers.get('remote')?.settingsSyncManaged).toBe(true);
  expect(groups.get('managed')?.settingsSyncManaged).toBe(true);
  expect(await new ServerDaoDbImpl().findById('remote')).not.toHaveProperty('settingsSyncManaged');
});

test('prune rolls back upserts, deletions, references and credentials on failure', async () => {
  write({ mcpServers: { remote }, groups: [{ name: 'managed' }] });
  await syncSettingsToDatabase();
  groups.set('ui', { id: 'ui', name: 'ui', servers: ['remote'] });
  bindings.set('remote', { serverName: 'remote' });
  embeddings.set('remote', { content_type: 'server', content_id: 'remote' });
  process.env.MCPHUB_SETTINGS_SYNC = 'prune';
  write({ mcpServers: { added: remote }, groups: [] });
  failDelete = true;
  await expect(syncSettingsToDatabase()).rejects.toThrow('DB delete failed');
  expect([...servers.keys()]).toEqual(['remote']);
  expect(groups.has('managed')).toBe(true);
  expect(groups.get('ui')?.servers).toEqual(['remote']);
  expect(bindings.has('remote')).toBe(true);
  expect(embeddings.has('remote')).toBe(true);
});

test('rejects declared groups referencing a pruned server without applying changes', async () => {
  write({ mcpServers: { remote } });
  await syncSettingsToDatabase();
  process.env.MCPHUB_SETTINGS_SYNC = 'prune';
  write({ mcpServers: {}, groups: [{ name: 'team', servers: [{ name: 'remote' }] }] });
  await expect(syncSettingsToDatabase()).rejects.toThrow('references a server being pruned');
  expect(servers.has('remote')).toBe(true);
  expect(groups.size).toBe(0);
});

test('prune first boot skips legacy seeds and never writes to the settings file', async () => {
  process.env.MCPHUB_SETTINGS_SYNC = 'prune';
  write({ mcpServers: { remote }, groups: [{ name: 'team' }] });
  fs.chmodSync(settingsPath, 0o444);
  const writeSpy = jest.spyOn(fs, 'writeFileSync');
  try {
    await expect(initializeDatabaseMode()).resolves.toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(loadOriginalSettings).toHaveBeenLastCalledWith(false);
    expect(seedServer).not.toHaveBeenCalled();
    expect(seedGroup).not.toHaveBeenCalled();
    expect(servers.get('remote')?.settingsSyncManaged).toBe(true);
    expect(groups.get('team')?.settingsSyncManaged).toBe(true);
  } finally {
    writeSpy.mockRestore();
  }
});

it('round-trips the upstream protocol override and clears it back to automatic negotiation', async () => {
  write({ mcpServers: { remote: { ...remote, protocolNegotiation: 'legacy' } } });
  await syncSettingsToDatabase('upsert');
  const dao = new ServerDaoDbImpl();
  expect((await dao.findById('remote'))?.protocolNegotiation).toBe('legacy');
  write({ mcpServers: { remote: { ...remote, protocolNegotiation: 'auto' } } });
  await syncSettingsToDatabase('upsert');
  expect((await dao.findById('remote'))?.protocolNegotiation).toBe('auto');
  write({ mcpServers: { remote } });
  await syncSettingsToDatabase('upsert');
  expect((await dao.findById('remote'))?.protocolNegotiation).toBeUndefined();
});
