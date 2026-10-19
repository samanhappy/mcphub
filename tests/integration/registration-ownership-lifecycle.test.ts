import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearSettingsCache } from '../../src/config/index.js';
import {
  getDaoFactory,
  setDaoFactory,
  JsonFileDaoFactory,
  getUserDao,
  getServerDao,
} from '../../src/dao/DaoFactory.js';
import { deleteUser } from '../../src/services/userService.js';
import { isRegistrationUsernameReserved } from '../../src/services/registrationService.js';
import { authorizationService } from '../../src/services/authorizationService.js';

it('keeps a deleted private-server owner unavailable to public registration across reloads', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-registration-owner-'));
  const settingsPath = path.join(directory, 'settings.json');
  const originalSettingsPath = process.env.MCPHUB_SETTING_PATH;
  const originalFactory = getDaoFactory();
  try {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        users: [
          { username: 'admin', password: 'stored-hash', isAdmin: true },
          { username: 'alice', password: 'stored-hash', isAdmin: false },
        ],
        mcpServers: {
          private: { owner: 'alice', visibility: 'private', url: 'https://example.test/mcp' },
        },
      }),
    );
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    clearSettingsCache();
    setDaoFactory(JsonFileDaoFactory.getInstance());

    expect(await deleteUser('alice')).toBe(true);
    expect(await getUserDao().findByUsername('alice')).toBeNull();
    const server = await getServerDao().findById('private');
    expect(server).toMatchObject({ owner: 'alice', visibility: 'private' });
    // Reclaiming the name would confer these permissions even without admin rights.
    expect(authorizationService.can('server.manage', server!, { username: 'alice' })).toBe(true);
    expect(authorizationService.can('server.invoke', server!, { username: 'alice' })).toBe(true);
    clearSettingsCache();
    expect(await isRegistrationUsernameReserved('alice')).toBe(true);
    expect(await isRegistrationUsernameReserved('new-user')).toBe(false);
  } finally {
    if (originalSettingsPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = originalSettingsPath;
    clearSettingsCache();
    setDaoFactory(originalFactory);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
