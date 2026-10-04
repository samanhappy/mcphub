import fs from 'fs';
import os from 'os';
import path from 'path';

// Force every write into the same filesystem clock tick, reproducing #1242
// deterministically without depending on the host filesystem's resolution.
describe('JSON settings cache coherence (#1242)', () => {
  let directory: string;
  let settingsPath: string;
  let originalPath: string | undefined;
  const timestamp = new Date('2020-01-01T00:00:00Z');

  beforeEach(() => {
    jest.resetModules();
    originalPath = process.env.MCPHUB_SETTING_PATH;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-cache-'));
    settingsPath = path.join(directory, 'settings.json');
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        mcpServers: { notes: { command: 'node' } },
        users: [],
        groups: [{ id: 'g', name: 'g', servers: ['notes'] }],
        systemConfig: { oauthServer: { enabled: false } },
      }),
    );
    fs.utimesSync(settingsPath, timestamp, timestamp);
    const write = fs.writeFileSync.bind(fs);
    jest.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
      write(...args);
      if (args[0] === settingsPath) fs.utimesSync(settingsPath, timestamp, timestamp);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = originalPath;
    fs.rmSync(directory, { recursive: true, force: true });
    jest.resetModules();
  });

  it('preserves group updates through rename and the subsequent server save', async () => {
    const { ServerDaoImpl } = await import('../../src/dao/ServerDao.js');
    const { GroupDaoImpl } = await import('../../src/dao/GroupDao.js');
    const servers = new ServerDaoImpl();
    const groups = new GroupDaoImpl();
    await groups.findAll();
    expect(await servers.rename('notes', 'notebook')).toBe(true);
    expect(await groups.updateServerName('notes', 'notebook')).toBe(1);
    await servers.update('notebook', { enabled: true });
    const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(stored.groups[0].servers).toEqual(['notebook']);
    expect(stored.mcpServers.notebook.enabled).toBe(true);
    expect(stored.mcpServers.notes).toBeUndefined();
  });

  it('invalidates DAO snapshots after a configuration-module save', async () => {
    const config = await import('../../src/config/index.js');
    const { ServerDaoImpl } = await import('../../src/dao/ServerDao.js');
    const servers = new ServerDaoImpl();
    await servers.findAll();
    const settings = config.loadOriginalSettings();
    settings.groups![0].servers = ['notebook'];
    expect(config.saveSettings(settings)).toBe(true);
    await servers.update('notes', { enabled: true });
    expect(config.loadOriginalSettings().groups![0].servers).toEqual(['notebook']);
  });
  it('keeps an unchanged DAO snapshot cached but reloads on a backwards external mtime', async () => {
    const { ServerDaoImpl } = await import('../../src/dao/ServerDao.js');
    const servers = new ServerDaoImpl();
    const read = jest.spyOn(fs, 'readFileSync');
    await servers.findAll();
    read.mockClear();
    await servers.findAll();
    expect(read).not.toHaveBeenCalled();
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.mcpServers.notes.enabled = false;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    const earlier = new Date(timestamp.getTime() - 1000);
    fs.utimesSync(settingsPath, earlier, earlier);
    expect((await servers.findById('notes'))?.enabled).toBe(false);
  });

  it('reloads configuration after an external edit older than the wall clock', async () => {
    const config = await import('../../src/config/index.js');
    expect(config.saveSettings(config.loadOriginalSettings())).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.systemConfig.nameSeparator = 'changed';
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    const later = new Date(timestamp.getTime() + 1000);
    fs.utimesSync(settingsPath, later, later);
    expect(config.loadOriginalSettings().systemConfig?.nameSeparator).toBe('changed');
  });
});
