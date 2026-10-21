import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { auth, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import {
  PersonalOAuthContext,
  personalOAuthContexts,
  findPersonalOAuthFlow,
  disconnectPersonalOAuth,
} from '../../src/services/personalOAuthService.js';
import { CredentialBindingDaoImpl } from '../../src/dao/CredentialBindingDao.js';
import { getServerDao } from '../../src/dao/index.js';
import { logger } from '../../src/utils/logger.js';
import { normalizeServerConfigForPersistence } from '../../src/utils/serverConfigPersistence.js';
import type { ServerConfigWithName } from '../../src/types/index.js';

jest.mock('../../src/dao/index.js', () => ({ getServerDao: jest.fn() }));
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
jest.mock('../../src/services/mcpService.js', () => ({ getServerByName: jest.fn() }));
jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  getRegisteredClient: jest.fn(),
  removeRegisteredClient: jest.fn(),
}));
const issuer = 'http://gitlab.internal.example';
const mockDefinition: ServerConfigWithName = {
  name: 'gitlab',
  type: 'streamable-http',
  url: 'https://gitlab.example/mcp',
  visibility: 'public',
  oauth: {
    identityMode: 'personal',
    allowInsecureTokenEndpoint: true,
    clientId: 'client',
    scopes: ['mcp'],
  },
};
let tokenRequests: URLSearchParams[];
const fetchFn: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === `${issuer}/token`) {
    const body = new URLSearchParams(String(init?.body));
    tokenRequests.push(body);
    const identity =
      body.get('code') || body.get('refresh_token')?.replace('refresh-', '') || 'unknown';
    return Response.json({
      access_token: `token-${identity}`,
      refresh_token: `refresh-${identity}`,
      token_type: 'Bearer',
    });
  }
  if (url.includes('oauth-protected-resource'))
    return Response.json({ resource: mockDefinition.url, authorization_servers: [issuer] });
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  });
};
let directory: string;
const originalEnv = {
  path: process.env.MCPHUB_SETTING_PATH,
  key: process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY,
};
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-oauth-sdk-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  tokenRequests = [];
  jest.mocked(getServerDao).mockReturnValue({ findById: async () => mockDefinition } as any);
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
  if (originalEnv.path === undefined) delete process.env.MCPHUB_SETTING_PATH;
  else process.env.MCPHUB_SETTING_PATH = originalEnv.path;
  if (originalEnv.key === undefined) delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = originalEnv.key;
});
const provider = async (username: string) => {
  const context = await PersonalOAuthContext.load('gitlab', username, mockDefinition);
  return { context, provider: new MCPHubOAuthProvider('gitlab', context.config) };
};

test('two SDK authorization flows retain separate PKCE and tokens through restart and refresh', async () => {
  const a = await provider('alice');
  const b = await provider('bob');
  await Promise.all(
    [a, b].map((p) =>
      expect(auth(p.provider, { serverUrl: mockDefinition.url!, fetchFn })).rejects.toThrow(
        'OAuth authorization required',
      ),
    ),
  );
  const aPending = a.context.config.oauth.pendingAuthorization!;
  const bPending = b.context.config.oauth.pendingAuthorization!;
  expect(aPending.state).not.toBe(bPending.state);
  expect(aPending.codeVerifier).not.toBe(bPending.codeVerifier);
  expect((await findPersonalOAuthFlow(aPending.state!))?.username).toBe('alice');
  expect(JSON.stringify(jest.mocked(logger.log).mock.calls)).not.toContain(
    aPending.authorizationUrl,
  );
  const restartedA = await provider('alice');
  for (const [user, p] of [
    ['alice', restartedA],
    ['bob', b],
  ] as const) {
    await new StreamableHTTPClientTransport(new URL(mockDefinition.url!), {
      authProvider: p.provider,
      fetch: fetchFn,
    }).finishAuth(user);
    expect(p.provider.tokens()?.access_token).toBe(`token-${user}`);
  }
  expect(tokenRequests[0].get('code_verifier')).toBe(aPending.codeVerifier);
  expect(tokenRequests[1].get('code_verifier')).toBe(bPending.codeVerifier);
  expect(await findPersonalOAuthFlow(aPending.state!)).toBeUndefined();
  await expect(
    auth(restartedA.provider, { serverUrl: mockDefinition.url!, fetchFn }),
  ).resolves.toBe('AUTHORIZED');
  expect(tokenRequests[2].get('refresh_token')).toBe('refresh-alice');
  expect((await provider('bob')).provider.tokens()?.access_token).toBe('token-bob');
  expect(mockDefinition.oauth).not.toHaveProperty('accessToken');
  const persisted = fs.readFileSync(`${process.env.MCPHUB_SETTING_PATH}.credentials.json`, 'utf8');
  expect(persisted).not.toMatch(/token-alice|refresh-bob|codeVerifier/);
});

test('disconnection rejects a late SDK token save and never restores the old binding', async () => {
  const a = await provider('alice');
  await a.provider.saveTokens({ access_token: 'old', token_type: 'Bearer' });
  await disconnectPersonalOAuth('gitlab', 'alice');
  await expect(
    a.provider.saveTokens({ access_token: 'late', token_type: 'Bearer' }),
  ).rejects.toThrow('changed');
  expect((await provider('alice')).provider.tokens()).toBeUndefined();
});

test('coalesces concurrent refresh requests for the same user binding', async () => {
  const a = await provider('alice');
  await a.provider.saveTokens({
    access_token: 'old',
    refresh_token: 'refresh-alice',
    token_type: 'Bearer',
  });
  const wrapped = a.context.wrapFetch(fetchFn);
  await Promise.all(
    [1, 2].map(() => auth(a.provider, { serverUrl: mockDefinition.url!, fetchFn: wrapped })),
  );
  expect(tokenRequests).toHaveLength(1);
  expect((await provider('alice')).provider.tokens()?.access_token).toBe('token-alice');
});

test('a failed refresh response does not poison subsequent refresh attempts', async () => {
  const a = await provider('alice');
  let calls = 0;
  const wrapped = a.context.wrapFetch(async () => {
    calls++;
    return new Response('', { status: calls === 1 ? 503 : 200 });
  });
  const request = {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'same-token' }),
  };
  expect((await wrapped(`${issuer}/token`, request)).status).toBe(503);
  expect((await wrapped(`${issuer}/token`, request)).status).toBe(200);
});

test('an active personal OAuth flow survives normalization of the default SSE type', async () => {
  const originalType = mockDefinition.type;
  try {
    delete mockDefinition.type;
    const a = await provider('alice');
    await a.provider.saveTokens({
      access_token: 'old',
      refresh_token: 'refresh-alice',
      token_type: 'Bearer',
    });
    Object.assign(mockDefinition, normalizeServerConfigForPersistence(mockDefinition));
    expect(mockDefinition.type).toBe('sse');
    await expect(auth(a.provider, { serverUrl: mockDefinition.url!, fetchFn })).resolves.toBe(
      'AUTHORIZED',
    );
    expect((await provider('alice')).provider.tokens()?.access_token).toBe('token-alice');
    expect(tokenRequests[0].get('refresh_token')).toBe('refresh-alice');
    mockDefinition.type = 'streamable-http';
    await expect(
      a.provider.saveTokens({ access_token: 'late', token_type: 'Bearer' }),
    ).rejects.toThrow('changed');
    expect((await provider('alice')).provider.tokens()).toBeUndefined();
  } finally {
    mockDefinition.type = originalType;
  }
});
