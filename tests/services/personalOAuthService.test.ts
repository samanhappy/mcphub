import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { CredentialBindingDaoImpl } from '../../src/dao/CredentialBindingDao.js';
import {
  PersonalOAuthContext,
  disconnectPersonalOAuth,
  findPersonalOAuthFlow,
  resolvePersonalOAuth,
} from '../../src/services/personalOAuthService.js';
import type { ServerConfigWithName } from '../../src/types/index.js';
const mockDefinition: ServerConfigWithName = {
  name: 'gitlab',
  type: 'streamable-http',
  url: 'https://gitlab.example/mcp',
  visibility: 'public',
  oauth: { identityMode: 'personal', clientId: 'client' },
};
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: () =>
    new (jest.requireActual('../../src/dao/CredentialBindingDao.js').CredentialBindingDaoImpl)(),
  getServerDao: () => ({
    findById: async () => mockDefinition,
    findAll: async () => [mockDefinition],
  }),
  getUserDao: () => ({
    findByUsername: async (username: string) => ({ username, isAdmin: false }),
  }),
}));
let directory: string;
const originalPath = process.env.MCPHUB_SETTING_PATH;
const originalKey = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-personal-oauth-'));
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
test('isolates encrypted tokens and does not fall back to another user', async () => {
  const alice = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await alice.persistTokens('gitlab', {
    accessToken: 'alice-secret',
    refreshToken: 'alice-refresh',
  });
  expect(
    (await resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).config.oauth?.accessToken,
  ).toBe('alice-secret');
  await expect(resolvePersonalOAuth('gitlab', 'bob', mockDefinition)).rejects.toThrow(
    'Personal authorization required',
  );
  expect(
    fs.readFileSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`, 'utf8'),
  ).not.toContain('alice-secret');
  expect(mockDefinition.oauth).not.toHaveProperty('accessToken');
});
test('disconnect prevents a stale refresh or callback from restoring tokens', async () => {
  const alice = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await alice.persistTokens('gitlab', { accessToken: 'old' });
  await disconnectPersonalOAuth('gitlab', 'alice');
  await expect(alice.persistTokens('gitlab', { accessToken: 'late' })).rejects.toThrow('changed');
  await expect(resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).rejects.toThrow('required');
});
test('single-use state survives restart and expires, without exposing another flow', async () => {
  const alice = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await alice.updatePendingAuthorization('gitlab', {
    state: 'personal.alice',
    codeVerifier: 'secret-verifier',
  });
  const restored = await findPersonalOAuthFlow('personal.alice');
  expect(restored?.username).toBe('alice');
  await restored!.mutate(({ oauth }) => {
    delete oauth.pendingAuthorization!.state;
  });
  expect(await findPersonalOAuthFlow('personal.alice')).toBeUndefined();
  await restored!.updatePendingAuthorization('gitlab', {
    state: 'personal.expired',
    createdAt: Date.now() - 600001,
  });
  expect(await findPersonalOAuthFlow('personal.expired')).toBeUndefined();
});
test('a destination change invalidates persisted authorization', async () => {
  const alice = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await alice.persistTokens('gitlab', { accessToken: 'old' });
  const original = mockDefinition.url;
  try {
    mockDefinition.url = 'https://other.example/mcp';
    await expect(alice.persistTokens('gitlab', { accessToken: 'late' })).rejects.toThrow('changed');
    await expect(resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).rejects.toThrow(
      'required',
    );
  } finally {
    mockDefinition.url = original;
  }
});

test('concurrent contexts cannot overwrite an authorization committed by another context', async () => {
  const first = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  const second = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await first.persistTokens('gitlab', { accessToken: 'first' });
  await expect(second.persistTokens('gitlab', { accessToken: 'second' })).rejects.toThrow(
    'changed',
  );
  expect(
    (await resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).config.oauth?.accessToken,
  ).toBe('first');
});

test('changing an environment-expanded destination requires fresh personal authorization', async () => {
  const oldUrl = mockDefinition.url;
  const oldEnv = process.env.MCPHUB_TEST_OAUTH_DESTINATION;
  try {
    mockDefinition.url = '${MCPHUB_TEST_OAUTH_DESTINATION}';
    process.env.MCPHUB_TEST_OAUTH_DESTINATION = 'https://first.example/mcp';
    const a = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    await a.persistTokens('gitlab', { accessToken: 'first-destination-token' });
    process.env.MCPHUB_TEST_OAUTH_DESTINATION = 'https://second.example/mcp';
    await expect(resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).rejects.toThrow(
      'required',
    );
  } finally {
    mockDefinition.url = oldUrl;
    if (oldEnv === undefined) delete process.env.MCPHUB_TEST_OAUTH_DESTINATION;
    else process.env.MCPHUB_TEST_OAUTH_DESTINATION = oldEnv;
  }
});
