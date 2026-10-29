import fs from 'fs';
import os from 'os';
import path from 'path';

// A settings file saved with a UTF-8 BOM (e.g. PowerShell 5.1 `Out-File -Encoding utf8`)
// that already has `systemConfig.oauthServer` is never rewritten by `loadOriginalSettings()`,
// so the DAOs must read it with the BOM still in place.
describe('JSON settings file with a UTF-8 BOM', () => {
  let directory: string;
  let settingsPath: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-bom-'));
    settingsPath = path.join(directory, 'mcp_settings.json');
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    process.env.USE_DB = 'false';
    process.env.ADMIN_PASSWORD = 'new-admin-password';
    const settings = {
      mcpServers: { notes: { command: 'node' } },
      users: [{ username: 'alice', password: 'hashed', isAdmin: true }],
      systemConfig: { oauthServer: { enabled: false } },
    };
    fs.writeFileSync(settingsPath, '\uFEFF' + JSON.stringify(settings, null, 2), 'utf8');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(directory, { recursive: true, force: true });
    jest.resetModules();
  });

  it('keeps existing users and servers through startup and default-admin creation', async () => {
    const before = fs.readFileSync(settingsPath, 'utf8');
    const { loadOriginalSettings } = await import('../../src/config/index.js');
    const { initializeDefaultUser } = await import('../../src/models/User.js');
    const { UserDaoImpl } = await import('../../src/dao/UserDao.js');
    const { ServerDaoImpl } = await import('../../src/dao/ServerDao.js');

    expect(loadOriginalSettings().users).toHaveLength(1);
    await initializeDefaultUser();

    expect((await new UserDaoImpl().findAll()).map((u) => u.username)).toEqual(['alice']);
    expect((await new ServerDaoImpl().findAll()).map((s) => s.name)).toEqual(['notes']);
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(before);
  });
});
