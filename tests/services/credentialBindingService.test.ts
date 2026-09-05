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
} from '../../src/services/credentialBindingService.js';
import { validateCredentialTemplate } from '../../src/utils/credentialTemplate.js';
import { presentServerForPrincipal } from '../../src/services/serverConfigPresenter.js';
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
    'My Credentials',
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
    'My Credentials',
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

test('fails closed without encryption configuration and on corrupted storage', async () => {
  delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  await expect(
    saveCredentialBinding('shared', 'alice', stdio, { 'env.PERSONAL_KEY': 'secret' }),
  ).rejects.toThrow('MCPHUB_CREDENTIAL_ENCRYPTION_KEY');
  expect(fs.existsSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`)).toBe(false);
  fs.writeFileSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`, 'broken');
  await expect(new CredentialBindingDaoImpl().get('shared', 'alice')).rejects.toThrow();
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
