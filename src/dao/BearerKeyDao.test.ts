import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BearerKeyDaoImpl } from './BearerKeyDao.js';
import { clearSettingsCache } from '../config/index.js';
import { hashBearerToken, maskBearerKey } from '../utils/bearerKeyToken.js';

describe('BearerKeyDaoImpl token hashing', () => {
  let settingsPath: string;
  const original = process.env.MCPHUB_SETTING_PATH;
  const read = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const base = { name: 'k', enabled: true, kind: 'system' as const, accessType: 'all' as const };

  beforeEach(() => {
    settingsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bearer-')), 'settings.json');
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: {}, bearerKeys: [] }));
    clearSettingsCache();
  });
  afterAll(() => {
    process.env.MCPHUB_SETTING_PATH = original;
  });

  it('stores only the hash and prefix, returns the raw token once, and finds by token', async () => {
    const dao = new BearerKeyDaoImpl();
    const created = await dao.create({ ...base, token: 'mcphub_secret123' });

    expect(created.token).toBe('mcphub_secret123');
    const stored = read().bearerKeys[0];
    expect(stored.token).toBeUndefined();
    expect(stored.tokenHash).toBe(hashBearerToken('mcphub_secret123'));
    expect(JSON.stringify(read())).not.toContain('secret123');

    expect((await dao.findByToken('mcphub_secret123'))?.id).toBe(created.id);
    expect(await dao.findByToken('mcphub_secret124')).toBeUndefined();
    expect(maskBearerKey((await dao.findById(created.id))!)).toBe('mcphub_s...');
  });

  it('hashes legacy plaintext keys without breaking them', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        mcpServers: {},
        bearerKeys: [{ id: '1', ...base, token: 'legacy-token-value' }],
      }),
    );
    clearSettingsCache();
    const dao = new BearerKeyDaoImpl();

    expect((await dao.findByToken('legacy-token-value'))?.id).toBe('1'); // before migration
    expect(await dao.hashLegacyTokens()).toBe(1);
    expect(await dao.hashLegacyTokens()).toBe(0);
    expect(JSON.stringify(read())).not.toContain('legacy-token-value');
    expect((await dao.findByToken('legacy-token-value'))?.id).toBe('1'); // after migration
  });

  it('does not leave the legacy routing.bearerAuthKey behind', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        mcpServers: {},
        systemConfig: { routing: { enableBearerAuth: true, bearerAuthKey: 'old-routing-key' } },
      }),
    );
    clearSettingsCache();
    const dao = new BearerKeyDaoImpl();

    expect((await dao.findByToken('old-routing-key'))?.name).toBe('default');
    expect(JSON.stringify(read())).not.toContain('old-routing-key');
  });
});
