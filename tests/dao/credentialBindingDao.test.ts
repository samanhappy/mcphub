import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CredentialBindingDaoImpl } from '../../src/dao/CredentialBindingDao.js';
import { encryptCredentialValues } from '../../src/services/credentialCrypto.js';

describe('CredentialBindingDaoImpl (#1114)', () => {
  let tmpDir: string;
  let settingsPath: string;
  let originalSettingsPath: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-credential-bindings-'));
    settingsPath = path.join(tmpDir, 'mcp_settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: {}, credentialBindings: [] }));
    originalSettingsPath = process.env.MCPHUB_SETTING_PATH;
    process.env.MCPHUB_SETTING_PATH = settingsPath;
  });

  afterEach(() => {
    if (originalSettingsPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = originalSettingsPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts by server and username while the settings file contains ciphertext only', async () => {
    const dao = new CredentialBindingDaoImpl();
    const context = { username: 'alice@example.com' };
    const encryptedValues = encryptCredentialValues(
      { env: { TAVILY_API_KEY: 'alice-dao-secret' } },
      context,
    );

    const created = await dao.upsert('tavily', 'alice@example.com', encryptedValues);
    const updated = await dao.upsert(
      'tavily',
      'alice@example.com',
      encryptCredentialValues({ env: { TAVILY_API_KEY: 'alice-updated-secret' } }, context),
    );

    expect(updated.id).toBe(created.id);
    expect(await dao.findByServerAndUsername('tavily', 'alice@example.com')).toEqual(updated);
    expect(await dao.findByUsername('alice@example.com')).toEqual([updated]);

    const serialized = fs.readFileSync(settingsPath, 'utf8');
    expect(serialized).not.toContain('alice-dao-secret');
    expect(serialized).not.toContain('alice-updated-secret');
  });

  it('deletes only the exact user binding', async () => {
    const dao = new CredentialBindingDaoImpl();
    const aliceEncrypted = encryptCredentialValues(
      { env: { KEY: 'alice-secret' } },
      { username: 'alice' },
    );
    const bobEncrypted = encryptCredentialValues(
      { env: { KEY: 'bob-secret' } },
      { username: 'bob' },
    );
    await dao.upsert('service', 'alice', aliceEncrypted);
    await dao.upsert('service', 'bob', bobEncrypted);

    expect(await dao.delete('service', 'alice')).toBe(true);
    expect(await dao.findByServerAndUsername('service', 'alice')).toBeNull();
    expect(await dao.findByServerAndUsername('service', 'bob')).not.toBeNull();
  });
});
