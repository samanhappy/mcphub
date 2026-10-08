import fs from 'fs';
import os from 'os';
import path from 'path';

import { UserDaoImpl } from '../../src/dao/UserDao.js';
import { clearSettingsCache } from '../../src/config/index.js';

describe('UserDaoImpl (JSON) write atomicity', () => {
  let tmpDir: string;
  let settingsPath: string;
  let originalSettingsEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-users-'));
    settingsPath = path.join(tmpDir, 'mcp_settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: {}, users: [] }), 'utf8');

    originalSettingsEnv = process.env.MCPHUB_SETTING_PATH;
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    clearSettingsCache();
  });

  afterEach(() => {
    if (originalSettingsEnv === undefined) {
      delete process.env.MCPHUB_SETTING_PATH;
    } else {
      process.env.MCPHUB_SETTING_PATH = originalSettingsEnv;
    }
    clearSettingsCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const storedUsers = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).users as any[];

  it('lets only one of several concurrent creates claim a username', async () => {
    const dao = new UserDaoImpl();
    const results = await Promise.allSettled(
      ['sub-a', 'sub-b', 'sub-c'].map((ssoUserId) =>
        dao.createWithHashedPassword('shared-name', 'pw', false, undefined, ssoUserId),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(storedUsers().filter((u) => u.username === 'shared-name')).toHaveLength(1);
  });

  it('enforces unique email and ssoUserId like the database does', async () => {
    const dao = new UserDaoImpl();
    await dao.createWithHashedPassword('first', 'pw', false, 'same@example.test', 'sso-1');

    await expect(
      dao.createWithHashedPassword('second', 'pw', false, 'same@example.test', 'sso-2'),
    ).rejects.toThrow('already exists');
    await expect(
      dao.createWithHashedPassword('third', 'pw', false, 'other@example.test', 'sso-1'),
    ).rejects.toThrow('already exists');
    expect(storedUsers().map((u) => u.username)).toEqual(['first']);
  });

  it('does not lose a create that races an update', async () => {
    const dao = new UserDaoImpl();
    await dao.createWithHashedPassword('existing', 'pw', false);

    await Promise.all([
      dao.update('existing', { isAdmin: true }),
      dao.createWithHashedPassword('newcomer', 'pw', false),
    ]);

    const users = storedUsers();
    expect(users.map((u) => u.username).sort()).toEqual(['existing', 'newcomer']);
    expect(users.find((u) => u.username === 'existing').isAdmin).toBe(true);
  });
});
