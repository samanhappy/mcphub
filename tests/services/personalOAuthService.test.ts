import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { CredentialBindingDaoImpl } from '../../src/dao/CredentialBindingDao.js';
import { getCredentialBindingDao } from '../../src/dao/DaoFactory.js';
import { encryptCredentialValues } from '../../src/services/credentialBindingService.js';
import { expandServerConfig } from '../../src/services/serverConfigEnvironment.js';
import { normalizeServerConfigForPersistence } from '../../src/utils/serverConfigPersistence.js';
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


test('an unpersisted successful refresh expires while concurrent calls share its response', async () => {
  const context = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  const fetch = jest.fn(async () => new Response(JSON.stringify({ invalid: true }), { status: 200 }));
  const wrapped = context.wrapFetch(fetch);
  const init = { body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'refresh' }) };
  jest.useFakeTimers();
  try {
    const responses = await Promise.all([wrapped('https://example.com/token', init), wrapped('https://example.com/token', init)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await responses[0].json()).toEqual({ invalid: true });
    expect(await responses[1].json()).toEqual({ invalid: true });
    jest.advanceTimersByTime(1000);
    await wrapped('https://example.com/token', init);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('unrelated declaration edits keep the personal binding intact (#1362)', async () => {
  const alice = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await alice.persistTokens('gitlab', {
    accessToken: 'alice-secret',
    refreshToken: 'alice-refresh',
  });
  const original = {
    visibility: mockDefinition.visibility,
    sharedWithUsers: mockDefinition.sharedWithUsers,
    description: mockDefinition.description,
    options: mockDefinition.options,
  };
  try {
    // Editing access-control or cosmetic fields must not invalidate the binding:
    // the destination (type/url/OAuth client+endpoints) is unchanged.
    mockDefinition.visibility = 'group';
    mockDefinition.sharedWithUsers = ['alice', 'bob'];
    mockDefinition.description = 'edited note';
    mockDefinition.options = { timeout: 120_000 };
    const restored = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    expect(restored.config.oauth?.accessToken).toBe('alice-secret');
    expect(restored.config.oauth?.refreshToken).toBe('alice-refresh');
    expect(
      (await resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).config.oauth?.accessToken,
    ).toBe('alice-secret');
  } finally {
    mockDefinition.visibility = original.visibility;
    mockDefinition.sharedWithUsers = original.sharedWithUsers;
    mockDefinition.description = original.description;
    mockDefinition.options = original.options;
  }
});

test('changing OAuth client metadata still invalidates the personal binding (#1362)', async () => {
  const alice = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await alice.persistTokens('gitlab', {
    accessToken: 'alice-secret',
    refreshToken: 'alice-refresh',
  });
  const originalClientId = mockDefinition.oauth?.clientId;
  try {
    mockDefinition.oauth = { ...mockDefinition.oauth, clientId: 'other-client' };
    const restored = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    expect(restored.config.oauth?.accessToken).toBeUndefined();
    await expect(resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).rejects.toThrow(
      'Personal authorization required',
    );
  } finally {
    mockDefinition.oauth = { ...mockDefinition.oauth, clientId: originalClientId };
  }
});

test('legacy-format bindings (pre-#1362 fingerprints) restore tokens and pending flow (#1362)', async () => {
  // Simulate a binding persisted before the destination-only fingerprint change: its
  // oauthDeclaration stores the old whole-declaration format.
  const expanded = await expandServerConfig(mockDefinition);
  const { name: _, ...declaration } = mockDefinition;
  const legacyFingerprint = JSON.stringify([declaration, expanded.url, expanded.oauth]);
  const pending = { state: 'personal.legacy', codeVerifier: 'legacy-verifier', createdAt: Date.now() };
  await getCredentialBindingDao().save({
    serverName: 'gitlab',
    username: 'alice',
    encryptedValues: await encryptCredentialValues('gitlab', 'alice', {
      oauthDeclaration: legacyFingerprint,
      oauth: JSON.stringify({
        accessToken: 'legacy-token',
        refreshToken: 'legacy-refresh',
        pendingAuthorization: pending,
      }),
    }),
    updatedAt: new Date().toISOString(),
  });
  try {
    const restored = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    expect(restored.config.oauth?.accessToken).toBe('legacy-token');
    expect(restored.config.oauth?.refreshToken).toBe('legacy-refresh');
    expect(restored.config.oauth?.pendingAuthorization?.state).toBe('personal.legacy');
    expect((await findPersonalOAuthFlow('personal.legacy'))?.username).toBe('alice');
    expect(
      (await resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).config.oauth?.accessToken,
    ).toBe('legacy-token');
  } finally {
    await getCredentialBindingDao().delete({ serverName: 'gitlab', username: 'alice' });
  }
});

test('legacy-format bindings still reject a destination change (#1362)', async () => {
  const expanded = await expandServerConfig(mockDefinition);
  const { name: _, ...declaration } = mockDefinition;
  const legacyFingerprint = JSON.stringify([declaration, expanded.url, expanded.oauth]);
  await getCredentialBindingDao().save({
    serverName: 'gitlab',
    username: 'alice',
    encryptedValues: await encryptCredentialValues('gitlab', 'alice', {
      oauthDeclaration: legacyFingerprint,
      oauth: JSON.stringify({ accessToken: 'legacy-token', refreshToken: 'legacy-refresh' }),
    }),
    updatedAt: new Date().toISOString(),
  });
  const originalUrl = mockDefinition.url;
  try {
    mockDefinition.url = 'https://other.example/mcp';
    const restored = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    expect(restored.config.oauth?.accessToken).toBeUndefined();
    await expect(resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).rejects.toThrow(
      'Personal authorization required',
    );
  } finally {
    mockDefinition.url = originalUrl;
    await getCredentialBindingDao().delete({ serverName: 'gitlab', username: 'alice' });
  }
});

test('OAuth key reordering on save does not invalidate the personal binding (#1362)', async () => {
  const originalOAuth = mockDefinition.oauth;
  try {
    // A file-defined server may declare oauth keys in any order; the dashboard save path
    // (normalizeServerConfigForPersistence -> normalizeOAuth) rewrites them in a fixed
    // order even when the values are unchanged.
    mockDefinition.oauth = { clientId: 'client', identityMode: 'personal', scopes: ['mcp'] };
    const alice = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    await alice.persistTokens('gitlab', {
      accessToken: 'reorder-secret',
      refreshToken: 'reorder-refresh',
    });
    const normalized = normalizeServerConfigForPersistence(mockDefinition);
    // Sanity: the save path actually rewrote the OAuth keys into a different order.
    expect(Object.keys(normalized.oauth || {})).toEqual(['identityMode', 'clientId', 'scopes']);
    const restored = await PersonalOAuthContext.load('gitlab', 'alice', normalized);
    expect(restored.config.oauth?.accessToken).toBe('reorder-secret');
    expect(restored.config.oauth?.refreshToken).toBe('reorder-refresh');
    expect(
      (await resolvePersonalOAuth('gitlab', 'alice', normalized)).config.oauth?.accessToken,
    ).toBe('reorder-secret');
  } finally {
    mockDefinition.oauth = originalOAuth;
    await getCredentialBindingDao().delete({ serverName: 'gitlab', username: 'alice' });
  }
});

test.each(['new', 'legacy', 'destination-only'] as const)(
  '%s bindings survive a dashboard save that makes the default SSE type explicit',
  async (format) => {
    const originalType = mockDefinition.type;
    try {
      delete mockDefinition.type;
      const context = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
      await context.persistTokens('gitlab', { accessToken: 'sse-token' });
      if (format !== 'new') {
        const expanded = await expandServerConfig(mockDefinition);
        const { name: _, ...declaration } = mockDefinition;
        const stored =
          format === 'legacy'
            ? JSON.stringify([declaration, expanded.url, expanded.oauth])
            : `[undefined,${JSON.stringify(expanded.url)},{"clientId":"client","identityMode":"personal"}]`;
        await getCredentialBindingDao().save({
          serverName: 'gitlab',
          username: 'alice',
          encryptedValues: await encryptCredentialValues('gitlab', 'alice', {
            oauthDeclaration: stored,
            oauth: JSON.stringify({ accessToken: 'sse-token' }),
          }),
          updatedAt: new Date().toISOString(),
        });
      }
      Object.assign(mockDefinition, normalizeServerConfigForPersistence(mockDefinition));
      expect(mockDefinition.type).toBe('sse');
      expect(
        (await resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).config.oauth.accessToken,
      ).toBe('sse-token');
      mockDefinition.type = 'streamable-http';
      await expect(resolvePersonalOAuth('gitlab', 'alice', mockDefinition)).rejects.toThrow(
        'required',
      );
    } finally {
      mockDefinition.type = originalType;
    }
  },
);
