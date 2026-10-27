import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger.js';

// Mocks must be defined before importing the module under test.

const initializeDatabaseMock = jest.fn(async () => undefined);
jest.mock('../db/connection.js', () => ({
  initializeDatabase: initializeDatabaseMock,
}));

const setDaoFactoryMock = jest.fn();
jest.mock('../dao/DaoFactory.js', () => ({
  setDaoFactory: setDaoFactoryMock,
}));

jest.mock('../dao/DatabaseDaoFactory.js', () => ({
  DatabaseDaoFactory: {
    getInstance: jest.fn(() => ({
      /* noop */
    })),
  },
}));

let settingsPathMock = '/nonexistent/mcp_settings.json';
const loadOriginalSettingsMock = jest.fn(() => ({ users: [] }));
jest.mock('../config/index.js', () => ({
  loadOriginalSettings: loadOriginalSettingsMock,
  getSettingsPath: () => settingsPathMock,
}));

const userRepoCountMock = jest.fn<() => Promise<number>>();
jest.mock('../db/repositories/UserRepository.js', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    count: userRepoCountMock,
  })),
}));

const bearerKeyCountMock = jest.fn<() => Promise<number>>();
const bearerKeyCreateMock =
  jest.fn<
    (data: {
      name: string;
      token: string;
      enabled: boolean;
      accessType: string;
      allowedGroups: string[];
      allowedServers: string[];
    }) => Promise<unknown>
  >();
jest.mock('../db/repositories/BearerKeyRepository.js', () => ({
  BearerKeyRepository: jest.fn().mockImplementation(() => ({
    count: bearerKeyCountMock,
    create: bearerKeyCreateMock,
  })),
}));

const systemConfigGetMock = jest.fn<() => Promise<any>>();
const systemConfigUpdateSectionMock = jest.fn<() => Promise<any>>();
jest.mock('../db/repositories/SystemConfigRepository.js', () => ({
  SystemConfigRepository: jest.fn().mockImplementation(() => ({
    get: systemConfigGetMock,
    update: jest.fn(),
    updateSection: systemConfigUpdateSectionMock,
  })),
}));

// Repositories not under test: inert stand-ins so migrateToDatabase can run end to end.
for (const repo of [
  'ServerRepository',
  'GroupRepository',
  'UserConfigRepository',
  'OAuthClientRepository',
  'OAuthTokenRepository',
  'BuiltinPromptRepository',
  'BuiltinResourceRepository',
]) {
  jest.mock(`../db/repositories/${repo}.js`, () => ({
    [repo]: jest.fn().mockImplementation(() => ({})),
  }));
}

describe('initializeDatabaseMode legacy bearer auth migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips legacy migration when bearerKeys table already has data', async () => {
    userRepoCountMock.mockResolvedValue(1);
    bearerKeyCountMock.mockResolvedValue(2);
    systemConfigGetMock.mockResolvedValue({
      routing: { enableBearerAuth: true, bearerAuthKey: 'db-key' },
    });

    const { initializeDatabaseMode } = await import('./migration.js');
    const ok = await initializeDatabaseMode();

    expect(ok).toBe(true);
    expect(initializeDatabaseMock).toHaveBeenCalled();
    expect(loadOriginalSettingsMock).not.toHaveBeenCalled();
    expect(systemConfigGetMock).not.toHaveBeenCalled();
    expect(bearerKeyCreateMock).not.toHaveBeenCalled();
  });

  it('migrates legacy routing bearerAuthKey into bearerKeys when users exist and keys table is empty', async () => {
    userRepoCountMock.mockResolvedValue(3);
    bearerKeyCountMock.mockResolvedValue(0);
    systemConfigGetMock.mockResolvedValue({
      routing: { enableBearerAuth: true, bearerAuthKey: 'db-key' },
    });

    const { initializeDatabaseMode } = await import('./migration.js');
    const ok = await initializeDatabaseMode();

    expect(ok).toBe(true);
    expect(loadOriginalSettingsMock).not.toHaveBeenCalled();
    expect(systemConfigGetMock).toHaveBeenCalledTimes(1);
    expect(bearerKeyCreateMock).toHaveBeenCalledTimes(1);
    expect(bearerKeyCreateMock).toHaveBeenCalledWith({
      name: 'default',
      token: 'db-key',
      enabled: true,
      kind: 'system',
      accessType: 'all',
      allowedGroups: [],
      allowedServers: [],
    });
    expect(systemConfigUpdateSectionMock).toHaveBeenCalledWith('routing', {
      enableBearerAuth: true,
      bearerAuthKey: '',
    });
  });

  it('does not migrate when routing has no bearerAuthKey', async () => {
    userRepoCountMock.mockResolvedValue(1);
    bearerKeyCountMock.mockResolvedValue(0);
    systemConfigGetMock.mockResolvedValue({
      routing: { enableBearerAuth: true, bearerAuthKey: '   ' },
    });

    const { initializeDatabaseMode } = await import('./migration.js');
    const ok = await initializeDatabaseMode();

    expect(ok).toBe(true);
    expect(loadOriginalSettingsMock).not.toHaveBeenCalled();
    expect(systemConfigGetMock).toHaveBeenCalledTimes(1);
    expect(bearerKeyCreateMock).not.toHaveBeenCalled();
  });

  it('migrates file keys that are already hashed without re-hashing or needing a raw token', async () => {
    loadOriginalSettingsMock.mockReturnValueOnce({
      users: [],
      mcpServers: {},
      bearerKeys: [
        {
          id: 'k1',
          name: 'hashed',
          tokenHash: 'a'.repeat(64),
          tokenPrefix: 'mcphub_a',
          enabled: true,
          accessType: 'all',
        },
      ],
    } as any);

    const { migrateToDatabase } = await import('./migration.js');
    await migrateToDatabase(false);

    const arg = bearerKeyCreateMock.mock.calls[0][0] as any;
    expect(arg.tokenHash).toBe('a'.repeat(64));
    expect(arg.tokenPrefix).toBe('mcphub_a');
    expect(arg).not.toHaveProperty('token');
  });

  describe('source file scrubbing after a successful migration', () => {
    let dir: string;
    let file: string;
    const original = {
      users: [],
      mcpServers: { s: { command: 'x' } },
      systemConfig: { routing: { enableBearerAuth: true, bearerAuthKey: 'legacy-secret' } },
      bearerKeys: [
        { id: 'k1', name: 'a', token: 'plain-token-1234567890', enabled: true, accessType: 'all' },
      ],
    };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
      file = path.join(dir, 'mcp_settings.json');
      fs.writeFileSync(file, JSON.stringify(original));
      settingsPathMock = file;
      loadOriginalSettingsMock.mockReturnValueOnce(JSON.parse(JSON.stringify(original)) as any);
    });

    afterEach(() => {
      fs.chmodSync(dir, 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
      settingsPathMock = '/nonexistent/mcp_settings.json';
    });

    it('rewrites the file with hashed keys and keeps the rest intact', async () => {
      const { migrateToDatabase } = await import('./migration.js');
      expect(await migrateToDatabase(false)).toBe(true);

      const out = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(out.bearerKeys[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(out.bearerKeys[0]).not.toHaveProperty('token');
      expect(out.systemConfig.routing).toEqual({ enableBearerAuth: true, bearerAuthKey: '' });
      expect(out.mcpServers).toEqual(original.mcpServers);
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/plain-token|legacy-secret/);
    });

    it('keeps an explicit empty bearerKeys array empty and clears the stale routing secret', async () => {
      fs.writeFileSync(file, JSON.stringify({ ...original, bearerKeys: [] }));
      const { migrateToDatabase } = await import('./migration.js');
      expect(await migrateToDatabase(false)).toBe(true);

      const out = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(out.bearerKeys).toEqual([]);
      expect(out.systemConfig.routing.bearerAuthKey).toBe('');
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/legacy-secret/);
    });

    it('warns but still succeeds when the file cannot be rewritten', async () => {
      // read-only file: the write fails, the migration must not
      fs.chmodSync(file, 0o444);
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
      const { migrateToDatabase } = await import('./migration.js');
      const ok = await migrateToDatabase(false);

      expect(ok).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('plaintext bearer tokens may remain'));
      expect(fs.readFileSync(file, 'utf8')).toContain('plain-token');
      warn.mockRestore();
    });
  });
});
