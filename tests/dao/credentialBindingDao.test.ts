import fs from 'fs';
import os from 'os';
import path from 'path';

import { CredentialBindingDaoImpl } from '../../src/dao/CredentialBindingDao.js';

const binding = (serverName: string, username: string) => ({
  serverName,
  username,
  encryptedValues: `ciphertext-${username}`,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('CredentialBindingDaoImpl.listUsernames', () => {
  let tmpDir: string;
  let settingsPath: string;
  let originalSettingsEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-credential-bindings-'));
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeBindings = (bindings: unknown): void => {
    fs.writeFileSync(`${settingsPath}.credentials.json`, JSON.stringify(bindings), 'utf8');
  };

  it('returns only the usernames bound to the requested server', async () => {
    writeBindings([
      binding('private-api', 'alice'),
      binding('private-api', 'bob'),
      binding('other-server', 'carol'),
    ]);

    await expect(new CredentialBindingDaoImpl().listUsernames('private-api')).resolves.toEqual([
      'alice',
      'bob',
    ]);
  });

  it('returns an empty list when the binding store does not exist', async () => {
    await expect(new CredentialBindingDaoImpl().listUsernames('private-api')).resolves.toEqual([]);
  });

  it('returns an empty list when no user bound the server', async () => {
    writeBindings([binding('other-server', 'carol')]);
    await expect(new CredentialBindingDaoImpl().listUsernames('private-api')).resolves.toEqual([]);
  });
});
