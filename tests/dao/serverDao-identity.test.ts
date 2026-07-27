import fs from 'fs';
import os from 'os';
import path from 'path';

import { ServerDaoImpl } from '../../src/dao/ServerDao.js';
import { clearSettingsCache } from '../../src/config/index.js';

describe('ServerDaoImpl stable server identity', () => {
  let tmpDir: string;
  let settingsPath: string;
  let originalSettingsPath: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-server-identity-'));
    settingsPath = path.join(tmpDir, 'mcp_settings.json');
    originalSettingsPath = process.env.MCPHUB_SETTING_PATH;
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: {}, groups: [] }), 'utf8');
    clearSettingsCache();
  });

  afterEach(() => {
    if (originalSettingsPath === undefined) {
      delete process.env.MCPHUB_SETTING_PATH;
    } else {
      process.env.MCPHUB_SETTING_PATH = originalSettingsPath;
    }
    clearSettingsCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores independent servers with the same name under stable ids', async () => {
    const dao = new ServerDaoImpl();

    const first = await dao.create({
      name: 'notion',
      owner: 'alice',
      type: 'streamable-http',
      url: 'https://team-a.example/mcp',
    });
    const second = await dao.create({
      name: 'notion',
      owner: 'alice',
      type: 'streamable-http',
      url: 'https://team-b.example/mcp',
    });

    expect(first.id).toBeTruthy();
    expect(second.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    await expect(dao.findById(first.id)).resolves.toMatchObject({
      id: first.id,
      name: 'notion',
      url: 'https://team-a.example/mcp',
    });
    await expect(dao.findById(second.id)).resolves.toMatchObject({
      id: second.id,
      name: 'notion',
      url: 'https://team-b.example/mcp',
    });

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(Object.keys(persisted.mcpServers)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
  });

  it('loads legacy name-keyed settings without rewriting them first', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        mcpServers: {
          notion: {
            type: 'streamable-http',
            url: 'https://legacy.example/mcp',
          },
        },
      }),
      'utf8',
    );
    clearSettingsCache();

    const dao = new ServerDaoImpl();

    await expect(dao.findById('notion')).resolves.toMatchObject({
      id: 'notion',
      name: 'notion',
      url: 'https://legacy.example/mcp',
    });
  });
});
