import fs from 'fs';
import os from 'os';
import path from 'path';

import { BearerKeyDaoImpl } from '../../src/dao/BearerKeyDao.js';
import { hashBearerToken } from '../../src/utils/bearerKeyToken.js';

const writeSettings = (settingsPath: string, settings: unknown): void => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
};

describe('BearerKeyDaoImpl migration + settings caching behavior', () => {
  let tmpDir: string;
  let settingsPath: string;
  let originalSettingsEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-bearer-keys-'));
    settingsPath = path.join(tmpDir, 'mcp_settings.json');

    originalSettingsEnv = process.env.MCPHUB_SETTING_PATH;
    process.env.MCPHUB_SETTING_PATH = settingsPath;
  });

  afterEach(() => {
    if (originalSettingsEnv === undefined) {
      delete process.env.MCPHUB_SETTING_PATH;
    } else {
      process.env.MCPHUB_SETTING_PATH = originalSettingsEnv;
    }

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('does not rewrite settings when bearerKeys exists as an empty array', async () => {
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: {
        routing: {
          enableBearerAuth: false,
          bearerAuthKey: '',
        },
      },
      bearerKeys: [],
    });

    const writeSpy = jest.spyOn(fs, 'writeFileSync');

    const dao = new BearerKeyDaoImpl();
    const enabled1 = await dao.findEnabled();
    const enabled2 = await dao.findEnabled();

    expect(enabled1).toEqual([]);
    expect(enabled2).toEqual([]);

    // The DAO should NOT persist anything because bearerKeys already exists.
    expect(writeSpy).not.toHaveBeenCalled();

    writeSpy.mockRestore();
  });

  it('migrates legacy bearerAuthKey only once', async () => {
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: {
        routing: {
          enableBearerAuth: true,
          bearerAuthKey: 'legacy-token',
        },
      },
      // bearerKeys is intentionally missing to trigger migration
    });

    const writeSpy = jest.spyOn(fs, 'writeFileSync');

    const dao = new BearerKeyDaoImpl();

    const enabled1 = await dao.findEnabled();
    expect(enabled1).toHaveLength(1);
    expect(enabled1[0].tokenHash).toBe(hashBearerToken('legacy-token'));
    expect(enabled1[0].token).toBeUndefined();
    expect(enabled1[0].enabled).toBe(true);

    const enabled2 = await dao.findEnabled();
    expect(enabled2).toHaveLength(1);
    expect(enabled2[0].tokenHash).toBe(hashBearerToken('legacy-token'));

    // One write for the migration, no further writes on subsequent reads.
    expect(writeSpy).toHaveBeenCalledTimes(1);

    writeSpy.mockRestore();
  });

  it('renames a group in allowedGroups without touching other scopes', async () => {
    const key = (id: string, allowedGroups: string[], allowedServers: string[] = []) => ({
      id,
      name: id,
      tokenHash: hashBearerToken(id),
      tokenPrefix: id,
      enabled: true,
      kind: 'system',
      accessType: 'custom',
      allowedGroups,
      allowedServers,
    });
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      bearerKeys: [
        key('scoped', ['team-a', 'other']),
        key('server-only', [], ['team-a']),
        key('unrelated', ['other']),
      ],
    });

    const dao = new BearerKeyDaoImpl();
    expect(await dao.updateGroupName('team-a', 'team-b')).toBe(1);

    const keys = await dao.findAll();
    expect(keys.find((k) => k.id === 'scoped')?.allowedGroups).toEqual(['team-b', 'other']);
    expect(keys.find((k) => k.id === 'server-only')?.allowedServers).toEqual(['team-a']);
    expect(keys.find((k) => k.id === 'unrelated')?.allowedGroups).toEqual(['other']);
  });

  it('keeps allowedGroups entries that are group IDs when renaming', async () => {
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      bearerKeys: [
        {
          id: 'by-id',
          name: 'by-id',
          tokenHash: hashBearerToken('by-id'),
          tokenPrefix: 'by-id',
          enabled: true,
          kind: 'system',
          accessType: 'groups',
          allowedGroups: ['group-a-id'],
          allowedServers: [],
        },
      ],
    });

    const dao = new BearerKeyDaoImpl();
    expect(await dao.updateGroupName('group-a-id', 'renamed', ['group-a-id', 'group-b-id'])).toBe(
      0,
    );
    expect((await dao.findAll())[0].allowedGroups).toEqual(['group-a-id']);
  });
});
