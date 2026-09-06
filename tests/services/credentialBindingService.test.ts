import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { CredentialBindingDaoImpl } from '../../src/dao/CredentialBindingDao.js';
import {
  getCredentialBindingStatus,
  saveCredentialBinding,
  resolveCredentialBinding,
  deleteCredentialBindings,
  missingCredentialError,
} from '../../src/services/credentialBindingService.js';
import { validateCredentialTemplate } from '../../src/utils/credentialTemplate.js';
import { presentServerForPrincipal } from '../../src/services/serverConfigPresenter.js';
import { RequestContextService } from '../../src/services/requestContextService.js';
import { initI18n } from '../../src/utils/i18n.js';
import type { ServerConfig } from '../../src/types/index.js';

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: () => new CredentialBindingDaoImpl(),
}));
const stdio: ServerConfig = {
  type: 'stdio',
  command: 'node',
  owner: 'admin',
  visibility: 'public',
  env: { PERSONAL_KEY: 'org-secret' },
  credentialTemplate: [{ target: 'env', name: 'PERSONAL_KEY', label: 'Personal key' }],
};
let directory: string;
const originalPath = process.env.MCPHUB_SETTING_PATH;
const originalKey = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-credentials-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
  else process.env.MCPHUB_SETTING_PATH = originalPath;
  if (originalKey === undefined) delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

test('encrypts at rest, isolates email principals, and returns status only', async () => {
  await Promise.all(
    ['alice@example.com', 'bob@example.com'].map((user) =>
      saveCredentialBinding('shared', user, stdio, { 'env.PERSONAL_KEY': `${user}-sentinel` }),
    ),
  );
  const file = `${process.env.MCPHUB_SETTING_PATH}.credentials.json`;
  expect(fs.readFileSync(file, 'utf8')).not.toContain('-sentinel');
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(
    (await resolveCredentialBinding('shared', 'alice@example.com', stdio)).config.env?.PERSONAL_KEY,
  ).toBe('alice@example.com-sentinel');
  expect(
    (await resolveCredentialBinding('shared', 'bob@example.com', stdio)).config.env?.PERSONAL_KEY,
  ).toBe('bob@example.com-sentinel');
  expect(await getCredentialBindingStatus('shared', 'alice@example.com', stdio)).toEqual({
    configured: true,
    configuredSlots: ['env.PERSONAL_KEY'],
    updatedAt: expect.any(String),
  });
  expect(presentServerForPrincipal(stdio, { username: 'alice@example.com' }).data).toEqual(
    expect.objectContaining({
      credentialTemplate: stdio.credentialTemplate,
      configRestricted: true,
    }),
  );
  expect(
    presentServerForPrincipal(stdio, { username: 'alice@example.com' }).data,
  ).not.toHaveProperty('env');
});

test('requires all declared slots without implicit organization fallback', async () => {
  await expect(resolveCredentialBinding('shared', 'alice', stdio)).rejects.toThrow(
    'Credentials',
  );
  for (const values of [
    {},
    { 'env.PERSONAL_KEY': '' },
    { 'env.PERSONAL_KEY': 'value', 'env.EXTRA': 'bad' },
  ]) {
    await expect(saveCredentialBinding('shared', 'alice', stdio, values)).rejects.toThrow();
  }
  await saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'first' });
  await saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'second' });
  expect((await resolveCredentialBinding('shared', 'alice', stdio)).config.env?.PERSONAL_KEY).toBe(
    'second',
  );
  await deleteCredentialBindings({ serverName: 'shared', username: 'alice' });
  await expect(resolveCredentialBinding('shared', 'alice', stdio)).rejects.toThrow(
    'Credentials',
  );
});

test('localizes missing credential guidance from the request language', async () => {
  const context = RequestContextService.getInstance();
  await context.runWithCustomRequestContext(
    { headers: { 'accept-language': 'zh-CN,zh;q=0.9' } },
    async () => {
      expect(missingCredentialError('amap').message).toBe(
        '服务器“amap”需要个人凭据。请在控制台 → 凭据中绑定所有必需字段。',
      );
    },
  );
});

test('authenticates ciphertext against both server and principal', async () => {
  const dao = new CredentialBindingDaoImpl();
  await saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' });
  const binding = (await dao.get('shared', 'alice'))!;
  await dao.save({ ...binding, username: 'bob' });
  await expect(resolveCredentialBinding('shared', 'bob', stdio)).rejects.toThrow(
    'Unable to unlock',
  );
  await dao.save({ ...binding, serverName: 'other' });
  await expect(resolveCredentialBinding('other', 'alice', stdio)).rejects.toThrow(
    'Unable to unlock',
  );
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  await expect(resolveCredentialBinding('shared', 'alice', stdio)).rejects.toThrow(
    'Unable to unlock',
  );
});

test('generates one private persistent key and reuses it after loading a fresh service', async () => {
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  await Promise.all(
    ['alice', 'bob'].map((username) =>
      saveCredentialBinding('shared', username, stdio, {
        'env.PERSONAL_KEY': `${username}-secret`,
      }),
    ),
  );
  const keyFile = `${process.env.MCPHUB_SETTING_PATH}.credentials.key`;
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  expect(Buffer.from(key, 'base64')).toHaveLength(32);
  expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
  expect(process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY).toBeUndefined();
  await jest.isolateModulesAsync(async () => {
    const fresh = await import('../../src/services/credentialBindingService.js');
    expect(
      (await fresh.resolveCredentialBinding('shared', 'alice', stdio)).config.env?.PERSONAL_KEY,
    ).toBe('alice-secret');
    await fresh.saveCredentialBinding('shared', 'bob', stdio, { 'env.PERSONAL_KEY': 'bob-new' });
  });
  expect(fs.readFileSync(keyFile, 'utf8').trim()).toBe(key);
  expect((await resolveCredentialBinding('shared', 'bob', stdio)).config.env?.PERSONAL_KEY).toBe(
    'bob-new',
  );
  expect(fs.readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false);
});

test('uses an explicit key without creating or overwriting the local key', async () => {
  await saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' });
  const keyFile = `${process.env.MCPHUB_SETTING_PATH}.credentials.key`;
  expect(fs.existsSync(keyFile)).toBe(false);
  fs.writeFileSync(keyFile, 'invalid-local-key');
  expect((await resolveCredentialBinding('shared', 'alice', stdio)).config.env?.PERSONAL_KEY).toBe(
    'secret',
  );
  expect(fs.readFileSync(keyFile, 'utf8')).toBe('invalid-local-key');
});

test('uses the winning key when another process creates the file concurrently', async () => {
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  const winningKey = randomBytes(32).toString('base64');
  const link = jest.spyOn(fs, 'linkSync').mockImplementationOnce((_source, destination) => {
    fs.writeFileSync(destination, winningKey, { mode: 0o600, flag: 'wx' });
    throw Object.assign(new Error('File exists'), { code: 'EEXIST' });
  });
  try {
    await saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' });
  } finally {
    link.mockRestore();
  }
  expect(fs.readFileSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.key`, 'utf8')).toBe(
    winningKey,
  );
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = winningKey;
  expect((await resolveCredentialBinding('shared', 'alice', stdio)).config.env?.PERSONAL_KEY).toBe(
    'secret',
  );
  expect(fs.readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false);
});

test('does not regenerate a missing key when any encrypted bindings already exist', async () => {
  await saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' });
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  const before = fs.readFileSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`, 'utf8');
  await expect(resolveCredentialBinding('shared', 'alice', stdio)).rejects.toThrow('Restore');
  await expect(
    saveCredentialBinding('other-server', 'bob', stdio, { 'env.PERSONAL_KEY': 'new' }),
  ).rejects.toThrow('Restore');
  expect(fs.existsSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.key`)).toBe(false);
  expect(fs.readFileSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`, 'utf8')).toBe(
    before,
  );
});

test('fails closed for an invalid explicit key, an invalid key file, or an unwritable key path', async () => {
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = 'invalid';
  await expect(
    saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' }),
  ).rejects.toThrow('MCPHUB_CREDENTIAL_ENCRYPTION_KEY');
  expect(fs.existsSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`)).toBe(false);
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  const keyFile = `${process.env.MCPHUB_SETTING_PATH}.credentials.key`;
  fs.writeFileSync(keyFile, 'corrupt');
  await expect(
    saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' }),
  ).rejects.toThrow('encryption key');
  expect(fs.readFileSync(keyFile, 'utf8')).toBe('corrupt');
  fs.rmSync(keyFile);
  fs.mkdirSync(keyFile);
  await expect(
    saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' }),
  ).rejects.toThrow('encryption key');
  expect(fs.existsSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`)).toBe(false);
});

test.each(['broken', '{}'])('fails closed on corrupted binding storage: %s', async (content) => {
  fs.writeFileSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`, content);
  await expect(new CredentialBindingDaoImpl().get('shared', 'alice')).rejects.toThrow();
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  await expect(
    saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' }),
  ).rejects.toThrow();
  expect(fs.existsSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.key`)).toBe(false);
});

test('injects literal personal headers and excludes passthrough overrides case-insensitively', async () => {
  const config: ServerConfig = {
    type: 'streamable-http',
    headers: { authorization: 'org' },
    passthroughHeaders: ['AUTHORIZATION', 'x-request-id'],
    credentialTemplate: [{ target: 'headers', name: 'Authorization' }],
  };
  await saveCredentialBinding('http', 'alice', config, {
    'headers.Authorization': 'Bearer ${LITERAL}',
  });
  const resolved = (await resolveCredentialBinding('http', 'alice', config)).config;
  expect(resolved.headers).toEqual({ Authorization: 'Bearer ${LITERAL}' });
  expect(resolved.passthroughHeaders).toEqual(['x-request-id']);
  expect(config.headers).toEqual({ authorization: 'org' });
  await expect(
    saveCredentialBinding('http', 'alice', config, {
      'headers.Authorization': 'bad\r\nx-injected: true',
    }),
  ).rejects.toThrow();
});

test('rejects values embedded in templates, duplicate headers, and wrong transport slots', () => {
  const http = {
    type: 'sse' as const,
    credentialTemplate: [{ target: 'headers' as const, name: 'Authorization' }],
  };
  expect(validateCredentialTemplate({ ...http, oauth: {} })).toEqual(http.credentialTemplate);
  expect(() =>
    validateCredentialTemplate({ ...http, oauth: { clientId: 'shared-client' } }),
  ).toThrow('OAuth');
  expect(() =>
    validateCredentialTemplate({
      ...stdio,
      credentialTemplate: [{ target: 'env', name: 'KEY', value: 'secret' } as never],
    }),
  ).toThrow();
  expect(() =>
    validateCredentialTemplate({
      type: 'sse',
      credentialTemplate: [
        { target: 'headers', name: 'X-Key' },
        { target: 'headers', name: 'x-key' },
      ],
    }),
  ).toThrow('Duplicate');
  expect(() =>
    validateCredentialTemplate({
      ...stdio,
      credentialTemplate: [{ target: 'headers', name: 'key' }],
    }),
  ).toThrow();
});
