import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Staged refs bind to a persisted server id (#1056). File-mode entries written
 * by hand have no id, so the DAO materializes a name-derived placeholder on
 * read; it must become a random UUID on the first write and on rename, or a
 * re-created server with the old name could inherit another server's refs.
 */
describe('server id backfill for staging', () => {
  let directory: string;
  let settingsPath: string;
  const originalEnv = { ...process.env };

  const writeSettings = (servers: Record<string, unknown>) =>
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: servers }, null, 2), 'utf8');

  beforeEach(() => {
    jest.resetModules();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-staging-id-'));
    settingsPath = path.join(directory, 'mcp_settings.json');
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    process.env.USE_DB = 'false';
    process.env.ADMIN_PASSWORD = 'new-admin-password';
    writeSettings({ ssh: { command: 'node', args: ['server.js'] } });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(directory, { recursive: true, force: true });
    jest.resetModules();
  });

  it('persists a random uuid on the first write instead of the placeholder', async () => {
    const { ServerDaoImpl } = await import('../../src/dao/ServerDao.js');
    const { isLegacyServerId } = await import('../../src/utils/serverIdentity.js');
    const dao = new ServerDaoImpl();

    const before = await dao.findById('ssh');
    expect(isLegacyServerId(before?.id, 'ssh')).toBe(true);

    await dao.update('ssh', { description: 'uploads over ssh' });

    const after = await dao.findById('ssh');
    expect(after?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(isLegacyServerId(after?.id, 'ssh')).toBe(false);
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).mcpServers.ssh.id).toBe(after?.id);
  });

  it('replaces a legacy id on rename so the old name cannot reclaim it', async () => {
    const { ServerDaoImpl } = await import('../../src/dao/ServerDao.js');
    const { isLegacyServerId, legacyServerId } = await import('../../src/utils/serverIdentity.js');
    const dao = new ServerDaoImpl();
    const legacy = legacyServerId('ssh');

    expect(await dao.rename('ssh', 'ssh-renamed')).toBe(true);

    const renamed = await dao.findById('ssh-renamed');
    expect(renamed?.id).not.toBe(legacy);
    expect(isLegacyServerId(renamed?.id, 'ssh-renamed')).toBe(false);
  });

  it('keeps a persisted uuid across an unrelated rename', async () => {
    const { ServerDaoImpl } = await import('../../src/dao/ServerDao.js');
    const dao = new ServerDaoImpl();
    await dao.update('ssh', { description: 'first write assigns the id' });
    const assigned = (await dao.findById('ssh'))?.id;

    await dao.rename('ssh', 'ssh-renamed');
    expect((await dao.findById('ssh-renamed'))?.id).toBe(assigned);
  });
});
