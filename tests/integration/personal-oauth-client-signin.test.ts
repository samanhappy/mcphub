import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type {
  IGroup,
  IOAuthClient,
  IOAuthToken,
  IUser,
  OAuthClientApproval,
} from '../../src/types/index.js';
import type { ServerConfigWithName } from '../../src/dao/ServerDao.js';

let users: IUser[] = [];
let servers: ServerConfigWithName[] = [];
let groups: IGroup[] = [];
let clients: IOAuthClient[] = [];
let approvals: OAuthClientApproval[] = [];
let tokens: IOAuthToken[] = [];
let allowedScopes = ['read', 'write'];
let requireState = false;
let alwaysShowApprovalScreen = false;
const publicInstallBaseUrl = 'https://hub.example';

jest.mock('../../src/dao/index.js', () => ({
  getOAuthApprovalDao: () => ({
    findById: async (id: string) => approvals.find((row) => row.id === id) ?? null,
    findByUsername: async (username: string) =>
      approvals.filter((row) => row.username === username),
    save: async (row: OAuthClientApproval) => {
      approvals.push(row);
    },
    deleteByUserAndClient: async (username: string, clientId: string) => {
      approvals = approvals.filter((row) => row.username !== username || row.clientId !== clientId);
    },
    deleteByUsername: async (username: string) => {
      approvals = approvals.filter((row) => row.username !== username);
    },
  }),
  getUserDao: () => ({
    findByUsername: async (username: string) => users.find((user) => user.username === username),
  }),
  getServerDao: () => ({
    findById: async (name: string) => servers.find((server) => server.name === name),
    findAll: async () => servers,
  }),
  getGroupDao: () => ({
    findByName: async (name: string) => groups.find((group) => group.name === name),
  }),
  getOAuthClientDao: () => ({
    findByClientId: async (clientId: string) =>
      clients.find((client) => client.clientId === clientId),
  }),
  getOAuthTokenDao: () => ({
    findByAccessToken: async (value: string) => tokens.find((token) => token.accessToken === value),
    findByRefreshToken: async (value: string) =>
      tokens.find((token) => token.refreshToken === value),
    create: async (token: IOAuthToken) => {
      tokens.push(token);
      return token;
    },
    findByUsername: async (username: string) =>
      tokens.filter((token) => token.username === username),
    revokeToken: async (value: string) => {
      tokens = tokens.filter(
        (token) => token.accessToken !== value && token.refreshToken !== value,
      );
      return true;
    },
  }),
  getSystemConfigDao: () => ({
    get: async () => ({
      install: { baseUrl: publicInstallBaseUrl },
      oauthServer: { enabled: true, alwaysShowApprovalScreen, allowedScopes, requireState },
    }),
  }),
}));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: () =>
    new (jest.requireActual('../../src/dao/CredentialBindingDao.js').CredentialBindingDaoImpl)(),
  getServerDao: () => ({
    findById: async (name: string) => servers.find((server) => server.name === name),
    findAll: async () => servers,
  }),
  getUserDao: () => ({
    findByUsername: async (username: string) => users.find((user) => user.username === username),
  }),
  getSystemConfigDao: () => ({
    get: async () => ({
      install: { baseUrl: publicInstallBaseUrl },
      oauthServer: { enabled: true, alwaysShowApprovalScreen, allowedScopes, requireState },
    }),
  }),
}));

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: async () => ({ enabled: false }),
}));
jest.mock('../../src/services/betterAuthSession.js', () => ({
  resolveBetterAuthUser: async () => null,
}));
jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: jest.fn(),
  getServerByOAuthState: jest.fn(),
  getServerByPendingOAuthState: jest.fn(),
  connectClientWithDiagnostics: jest.fn(),
  createTransportFromConfig: jest.fn(),
  updateServerToolsCache: jest.fn(),
}));
jest.mock('openid-client', () => ({}));

let upstreamFetchFn: typeof fetch;
jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  getRegisteredClient: jest.fn(),
  removeRegisteredClient: jest.fn(),
  createOAuthFetch: jest.fn(async () => upstreamFetchFn),
}));

import { JWT_SECRET } from '../../src/config/jwt.js';
import { getUserSessionVersion } from '../../src/utils/userSession.js';
import {
  getAuthorize,
  postAuthorize,
  postToken,
} from '../../src/controllers/oauthServerController.js';
import { handleOAuthCallback } from '../../src/controllers/oauthCallbackController.js';
import { handleOAuthRelay } from '../../src/controllers/oauthRelayController.js';
import { initOAuthServer, generateCodeChallenge } from '../../src/services/oauthServerService.js';
import { MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import { createTransportFromConfig } from '../../src/services/mcpService.js';
import { PersonalOAuthContext } from '../../src/services/personalOAuthService.js';
import { PERSONAL_OAUTH_NONCE_COOKIE } from '../../src/services/personalOAuthContinuationService.js';
import { logger } from '../../src/utils/logger.js';

const UPSTREAM_ISSUER = 'https://login.microsoftonline.example';
const UPSTREAM_MCP_URL = 'https://graph-mcp.example/mcp';

const extractCookiePair = (setCookieHeader: string | string[] | undefined): string => {
  const list = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const match = list.find((entry) => entry.startsWith(`${PERSONAL_OAUTH_NONCE_COOKIE}=`));
  if (!match) return '';
  return match.split(';')[0];
};

describe('Personal upstream OAuth continuation during client sign-in (#1475)', () => {
  let app: express.Application;
  let tempDir: string;
  let tokenExchangeRequests: URLSearchParams[];
  let failUpstreamTokenExchange = false;
  let aliceJwt: string;
  let bobJwt: string;
  const clientVerifier = 'v'.repeat(64);
  const originalEnv = {
    path: process.env.MCPHUB_SETTING_PATH,
    key: process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY,
  };

  const makeMs365Server = (
    overrides: Partial<ServerConfigWithName> = {},
  ): ServerConfigWithName => ({
    name: 'ms365',
    type: 'streamable-http',
    url: UPSTREAM_MCP_URL,
    visibility: 'public',
    enabled: true,
    oauth: {
      identityMode: 'personal',
      clientId: 'ms365-upstream-client',
      redirectUri: `${publicInstallBaseUrl}/oauth/callback`,
      scopes: ['Mail.Read'],
      authorizationServerMetadata: {
        issuer: UPSTREAM_ISSUER,
        authorization_endpoint: `${UPSTREAM_ISSUER}/authorize`,
        token_endpoint: `${UPSTREAM_ISSUER}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      },
    },
    ...overrides,
  });

  const makeClient = (overrides: Partial<IOAuthClient> = {}): IOAuthClient => ({
    clientId: 'hermes-client',
    name: 'Hermes',
    redirectUris: ['https://hermes.example/callback'],
    grants: ['authorization_code', 'refresh_token'],
    ...overrides,
  });

  const clientAuthPayload = (
    token: string,
    overrides: Record<string, string | undefined> = {},
  ) => ({
    client_id: 'hermes-client',
    redirect_uri: 'https://hermes.example/callback',
    response_type: 'code',
    scope: 'read',
    state: 'hermes-state-1',
    code_challenge: generateCodeChallenge(clientVerifier),
    code_challenge_method: 'S256',
    resource: `${publicInstallBaseUrl}/mcp/ms365`,
    token,
    allow: 'true',
    ...overrides,
  });

  const buildApp = () => {
    const instance = express();
    instance.use(express.urlencoded({ extended: false }));
    instance.use(express.json());
    instance.get('/oauth/authorize', getAuthorize);
    instance.post('/oauth/authorize', postAuthorize);
    instance.post('/oauth/token', postToken);
    instance.get('/oauth/relay/:name', handleOAuthRelay);
    instance.get('/oauth/callback', handleOAuthCallback);
    return instance;
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-oauth-signin-'));
    process.env.MCPHUB_SETTING_PATH = path.join(tempDir, 'settings.json');
    process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');

    const alicePassword = await bcrypt.hash('alice-pass', 4);
    const bobPassword = await bcrypt.hash('bob-pass', 4);
    users = [
      { username: 'alice', password: alicePassword, isAdmin: false },
      { username: 'bob', password: bobPassword, isAdmin: false },
    ];
    aliceJwt = jwt.sign(
      { user: { username: 'alice', sessionVersion: getUserSessionVersion(users[0]) } },
      JWT_SECRET,
    );
    bobJwt = jwt.sign(
      { user: { username: 'bob', sessionVersion: getUserSessionVersion(users[1]) } },
      JWT_SECRET,
    );

    servers = [makeMs365Server()];
    groups = [];
    clients = [makeClient()];
    approvals = [];
    tokens = [];
    allowedScopes = ['read', 'write'];
    requireState = false;
    alwaysShowApprovalScreen = false;
    tokenExchangeRequests = [];
    failUpstreamTokenExchange = false;

    upstreamFetchFn = async (input, init) => {
      const url = String(input);
      if (url === UPSTREAM_MCP_URL) {
        return new Response(null, {
          status: 401,
          headers: {
            'www-authenticate': `Bearer resource_metadata="${UPSTREAM_MCP_URL}/.well-known/oauth-protected-resource"`,
          },
        });
      }
      if (url.includes('oauth-protected-resource')) {
        return Response.json({
          resource: UPSTREAM_MCP_URL,
          authorization_servers: [UPSTREAM_ISSUER],
        });
      }
      if (url === `${UPSTREAM_ISSUER}/token`) {
        const body = new URLSearchParams(String(init?.body));
        tokenExchangeRequests.push(body);
        if (failUpstreamTokenExchange) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        const code = body.get('code') || 'unknown';
        return Response.json({
          access_token: `upstream-token-${code}`,
          refresh_token: `upstream-refresh-${code}`,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      return Response.json({
        issuer: UPSTREAM_ISSUER,
        authorization_endpoint: `${UPSTREAM_ISSUER}/authorize`,
        token_endpoint: `${UPSTREAM_ISSUER}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      });
    };

    jest.mocked(createTransportFromConfig).mockImplementation(async (name, config) => {
      return new StreamableHTTPClientTransport(new URL(config.url!), {
        authProvider: new MCPHubOAuthProvider(name, config),
        fetch: upstreamFetchFn,
      }) as any;
    });

    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    await initOAuthServer();
    app = buildApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv.path === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = originalEnv.path;
    if (originalEnv.key === undefined) delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = originalEnv.key;
  });

  const startClientAuthorize = async (
    token = aliceJwt,
    overrides: Record<string, string | undefined> = {},
  ) => {
    const res = await request(app)
      .post('/oauth/authorize')
      .send(clientAuthPayload(token, overrides));
    return {
      res,
      cookie: extractCookiePair(res.headers['set-cookie']),
      location: res.headers.location ? new URL(res.headers.location) : undefined,
    };
  };

  it('completes personal upstream OAuth before issuing MCPHub code (explicit consent and silent consent)', async () => {
    // 1. Explicit POST consent redirects to upstream OAuth with HttpOnly nonce cookie.
    const started = await startClientAuthorize(aliceJwt);
    expect(started.res.status).toBe(302);
    expect(started.location!.origin).toBe(UPSTREAM_ISSUER);
    expect(started.location!.pathname).toBe('/authorize');
    expect(started.cookie).toMatch(new RegExp(`^${PERSONAL_OAUTH_NONCE_COOKIE}=.+`));
    expect(started.res.headers['set-cookie'].join(';')).toContain('HttpOnly');
    expect(started.res.headers['set-cookie'].join(';')).toContain('SameSite=Lax');

    const upstreamState = started.location!.searchParams.get('state')!;
    expect(upstreamState.startsWith('personal.')).toBe(true);
    // Approval must NOT be saved before upstream authorization finishes.
    expect(approvals).toHaveLength(0);

    // 2. Upstream callback completes on a fresh Express app instance (simulating cross-replica recovery).
    const replicaApp = buildApp();
    const callbackRes = await request(replicaApp)
      .get('/oauth/callback')
      .set('Cookie', started.cookie)
      .query({ code: 'ms-code-alice', state: upstreamState, iss: UPSTREAM_ISSUER });

    expect(callbackRes.status).toBe(302);
    const clientRedirect = new URL(callbackRes.headers.location);
    expect(clientRedirect.origin + clientRedirect.pathname).toBe('https://hermes.example/callback');
    expect(clientRedirect.searchParams.get('state')).toBe('hermes-state-1');
    expect(clientRedirect.searchParams.get('iss')).toBe(publicInstallBaseUrl);
    const mcphubCode = clientRedirect.searchParams.get('code')!;
    expect(mcphubCode).toBeTruthy();
    // Nonce cookie is cleared on completion.
    expect(callbackRes.headers['set-cookie'].join(';')).toContain('Max-Age=0');

    // 3. Client exchanges MCPHub code with its PKCE verifier.
    const tokenRes = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code',
      client_id: 'hermes-client',
      redirect_uri: 'https://hermes.example/callback',
      code: mcphubCode,
      code_verifier: clientVerifier,
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.access_token).toBeTruthy();
    expect(approvals).toHaveLength(1);

    // Personal binding now holds Alice's upstream token with pendingAuthorization cleared.
    const aliceCtx = await PersonalOAuthContext.load('ms365', 'alice', servers[0]);
    expect(aliceCtx.config.oauth.accessToken).toBe('upstream-token-ms-code-alice');
    expect(aliceCtx.config.oauth.pendingAuthorization).toBeUndefined();

    // 4. Subsequent silent GET consent with an existing valid grant skips upstream and preserves tokens.
    const silentRes = await request(app)
      .get('/oauth/authorize')
      .query(clientAuthPayload(aliceJwt, { state: 'hermes-state-2' }));
    expect(silentRes.status).toBe(302);
    const silentRedirect = new URL(silentRes.headers.location);
    expect(silentRedirect.origin + silentRedirect.pathname).toBe('https://hermes.example/callback');
    expect(silentRedirect.searchParams.get('code')).toBeTruthy();
    expect(silentRedirect.searchParams.get('state')).toBe('hermes-state-2');
    expect(tokenExchangeRequests).toHaveLength(1);

    // 5. Silent GET consent when personal grant was later lost (no accessToken) still triggers upstream continuation.
    await aliceCtx.clearOAuthData('ms365', 'tokens');
    const silentNeedsOAuth = await request(app)
      .get('/oauth/authorize')
      .query(clientAuthPayload(aliceJwt, { state: 'hermes-state-3' }));
    expect(silentNeedsOAuth.status).toBe(302);
    expect(new URL(silentNeedsOAuth.headers.location).origin).toBe(UPSTREAM_ISSUER);
    const silentCookie = extractCookiePair(silentNeedsOAuth.headers['set-cookie']);
    const silentState = new URL(silentNeedsOAuth.headers.location).searchParams.get('state')!;

    const silentCallback = await request(app)
      .get('/oauth/callback')
      .set('Cookie', silentCookie)
      .query({ code: 'ms-code-alice-2', state: silentState, iss: UPSTREAM_ISSUER });
    expect(silentCallback.status).toBe(302);
    const silentDone = new URL(silentCallback.headers.location);
    expect(silentDone.origin + silentDone.pathname).toBe('https://hermes.example/callback');
    expect(silentDone.searchParams.get('code')).toBeTruthy();
    expect(silentDone.searchParams.get('state')).toBe('hermes-state-3');
  });

  it('reuses expired access tokens when a refresh token exists, and re-authorizes when no refresh token exists', async () => {
    const ctx = await PersonalOAuthContext.load('ms365', 'alice', servers[0]);
    await ctx.persistTokens('ms365', {
      accessToken: 'expired-but-refreshable',
      accessTokenExpiresAt: Date.now() - 5_000,
      refreshToken: 'refresh-alice',
      clearPendingAuthorization: true,
    });

    const reusable = await startClientAuthorize(aliceJwt, { state: 'reuse-refreshable' });
    expect(reusable.res.status).toBe(302);
    expect(reusable.location!.origin + reusable.location!.pathname).toBe(
      'https://hermes.example/callback',
    );
    expect(reusable.location!.searchParams.get('code')).toBeTruthy();

    // Existing grant must not be cleared.
    const reloaded = await PersonalOAuthContext.load('ms365', 'alice', servers[0]);
    expect(reloaded.config.oauth.accessToken).toBe('expired-but-refreshable');
    expect(reloaded.config.oauth.refreshToken).toBe('refresh-alice');

    // Now store an expired access token WITHOUT a refresh token: must trigger upstream OAuth.
    await reloaded.persistTokens('ms365', {
      accessToken: 'expired-no-refresh',
      accessTokenExpiresAt: Date.now() - 5_000,
      refreshToken: null,
      clearPendingAuthorization: true,
    });
    const needsReauth = await startClientAuthorize(aliceJwt, { state: 'needs-reauth' });
    expect(needsReauth.res.status).toBe(302);
    expect(needsReauth.location!.origin).toBe(UPSTREAM_ISSUER);
  });

  it('enforces user isolation and rejects nonce/state/iss mismatches before exchanging upstream code', async () => {
    // Give Alice an active personal grant; Bob must still go through his own upstream OAuth.
    const aliceCtx = await PersonalOAuthContext.load('ms365', 'alice', servers[0]);
    await aliceCtx.persistTokens('ms365', {
      accessToken: 'alice-private-token',
      clearPendingAuthorization: true,
    });

    const bobStarted = await startClientAuthorize(bobJwt, { state: 'bob-state' });
    expect(bobStarted.res.status).toBe(302);
    expect(bobStarted.location!.origin).toBe(UPSTREAM_ISSUER);
    const bobState = bobStarted.location!.searchParams.get('state')!;

    // Wrong or missing browser cookie must fail BEFORE redeeming upstream code and MUST NOT clear Bob's flow.
    const missingCookieRes = await request(app)
      .get('/oauth/callback')
      .query({ code: 'attacker-code', state: bobState, iss: UPSTREAM_ISSUER });
    expect(missingCookieRes.status).toBe(400);
    expect(tokenExchangeRequests).toHaveLength(0);

    const wrongCookieRes = await request(app)
      .get('/oauth/callback')
      .set('Cookie', `${PERSONAL_OAUTH_NONCE_COOKIE}=wrong-nonce`)
      .query({ code: 'attacker-code', state: bobState, iss: UPSTREAM_ISSUER });
    expect(wrongCookieRes.status).toBe(400);
    expect(tokenExchangeRequests).toHaveLength(0);

    // Forged state must be rejected cleanly.
    const forgedStateRes = await request(app)
      .get('/oauth/callback')
      .set('Cookie', bobStarted.cookie)
      .query({ code: 'attacker-code', state: 'personal.forged', iss: UPSTREAM_ISSUER });
    expect(forgedStateRes.status).toBe(400);
    expect(tokenExchangeRequests).toHaveLength(0);

    // Bob's real browser can still complete the flow cleanly, and Alice's grant stays untouched.
    const bobCallback = await request(app)
      .get('/oauth/callback')
      .set('Cookie', bobStarted.cookie)
      .query({ code: 'ms-code-bob', state: bobState, iss: UPSTREAM_ISSUER });
    expect(bobCallback.status).toBe(302);
    expect(new URL(bobCallback.headers.location).searchParams.get('code')).toBeTruthy();

    const aliceReloaded = await PersonalOAuthContext.load('ms365', 'alice', servers[0]);
    const bobReloaded = await PersonalOAuthContext.load('ms365', 'bob', servers[0]);
    expect(aliceReloaded.config.oauth.accessToken).toBe('alice-private-token');
    expect(bobReloaded.config.oauth.accessToken).toBe('upstream-token-ms-code-bob');

    // Mismatched `iss` with valid nonce fails before upstream code exchange and redirects error.
    await bobReloaded.clearOAuthData('ms365', 'tokens');
    const bobRetry = await startClientAuthorize(bobJwt, { state: 'bob-iss-check' });
    const retryState = bobRetry.location!.searchParams.get('state')!;
    const badIss = await request(app)
      .get('/oauth/callback')
      .set('Cookie', bobRetry.cookie)
      .query({ code: 'ms-code-bob-2', state: retryState, iss: 'https://evil-issuer.example' });
    expect(badIss.status).toBe(302);
    const badIssRedirect = new URL(badIss.headers.location);
    expect(badIssRedirect.searchParams.get('error')).toBe('access_denied');
    expect(badIssRedirect.searchParams.get('code')).toBeNull();
    expect(badIssRedirect.searchParams.get('state')).toBe('bob-iss-check');
    expect(tokenExchangeRequests).toHaveLength(1);
  });

  it('validates browser nonce on the relay path before contacting the private broker', async () => {
    servers = [
      makeMs365Server({
        oauth: {
          ...makeMs365Server().oauth!,
          authorizationRelay: {
            allowedRedirectOrigins: ['https://login.microsoftonline.com'],
          },
        },
      }),
    ];

    const brokerFetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const original = new URL(String(input));
      const dest = new URL('https://login.microsoftonline.com/authorize');
      dest.searchParams.set('state', original.searchParams.get('state')!);
      return new Response(null, { status: 302, headers: { Location: dest.toString() } });
    });

    const started = await startClientAuthorize(aliceJwt, { state: 'relay-state' });
    expect(started.res.status).toBe(302);
    expect(started.location!.pathname).toBe('/oauth/relay/ms365');
    const upstreamState = started.location!.searchParams.get('state')!;

    // Relay without browser nonce cookie is rejected BEFORE contacting broker.
    const unauthRelay = await request(app)
      .get('/oauth/relay/ms365')
      .query({ state: upstreamState });
    expect(unauthRelay.status).toBe(400);
    expect(brokerFetchSpy).not.toHaveBeenCalled();

    // Relay with wrong cookie is rejected BEFORE contacting broker.
    const wrongRelay = await request(app)
      .get('/oauth/relay/ms365')
      .set('Cookie', `${PERSONAL_OAUTH_NONCE_COOKIE}=tampered`)
      .query({ state: upstreamState });
    expect(wrongRelay.status).toBe(400);
    expect(brokerFetchSpy).not.toHaveBeenCalled();

    // Relay with valid browser nonce contacts broker and redirects to allowed origin.
    const validRelay = await request(app)
      .get('/oauth/relay/ms365')
      .set('Cookie', started.cookie)
      .query({ state: upstreamState });
    expect(validRelay.status).toBe(302);
    expect(new URL(validRelay.headers.location).origin).toBe('https://login.microsoftonline.com');
    expect(brokerFetchSpy).toHaveBeenCalledTimes(1);
  });

  it('enforces one-time consumption on replayed and concurrent callbacks', async () => {
    const started = await startClientAuthorize(aliceJwt, { state: 'replay-state' });
    const upstreamState = started.location!.searchParams.get('state')!;

    const [first, second] = await Promise.all([
      request(app)
        .get('/oauth/callback')
        .set('Cookie', started.cookie)
        .query({ code: 'ms-code-once', state: upstreamState, iss: UPSTREAM_ISSUER }),
      request(app)
        .get('/oauth/callback')
        .set('Cookie', started.cookie)
        .query({ code: 'ms-code-once', state: upstreamState, iss: UPSTREAM_ISSUER }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([302, 400]);
    expect(tokenExchangeRequests).toHaveLength(1);

    // Subsequent replay also fails closed.
    const third = await request(app)
      .get('/oauth/callback')
      .set('Cookie', started.cookie)
      .query({ code: 'ms-code-once', state: upstreamState, iss: UPSTREAM_ISSUER });
    expect(third.status).toBe(400);
    expect(tokenExchangeRequests).toHaveLength(1);
  });

  it('handles upstream cancellation and token exchange failure without issuing a code or saving approval', async () => {
    const started = await startClientAuthorize(aliceJwt, { state: 'cancel-state' });
    const upstreamState = started.location!.searchParams.get('state')!;

    // Cancellation without matching nonce must NOT clear flow or redirect to client.
    const unauthCancel = await request(app)
      .get('/oauth/callback')
      .query({ error: 'access_denied', state: upstreamState });
    expect(unauthCancel.status).toBe(400);

    // Cancellation with valid nonce clears pending flow and redirects error=access_denied to client.
    const validCancel = await request(app)
      .get('/oauth/callback')
      .set('Cookie', started.cookie)
      .query({ error: 'access_denied', state: upstreamState });
    expect(validCancel.status).toBe(302);
    const cancelRedirect = new URL(validCancel.headers.location);
    expect(cancelRedirect.origin + cancelRedirect.pathname).toBe('https://hermes.example/callback');
    expect(cancelRedirect.searchParams.get('error')).toBe('access_denied');
    expect(cancelRedirect.searchParams.get('code')).toBeNull();
    expect(cancelRedirect.searchParams.get('state')).toBe('cancel-state');
    expect(approvals).toHaveLength(0);

    const ctxAfterCancel = await PersonalOAuthContext.load('ms365', 'alice', servers[0]);
    expect(ctxAfterCancel.config.oauth.pendingAuthorization).toBeUndefined();

    // Upstream token exchange failure redirects error=access_denied (never success page or code).
    const started2 = await startClientAuthorize(aliceJwt, { state: 'exchange-fail-state' });
    const state2 = started2.location!.searchParams.get('state')!;
    failUpstreamTokenExchange = true;

    const failedExchange = await request(app)
      .get('/oauth/callback')
      .set('Cookie', started2.cookie)
      .query({ code: 'bad-code', state: state2, iss: UPSTREAM_ISSUER });
    expect(failedExchange.status).toBe(302);
    const failRedirect = new URL(failedExchange.headers.location);
    expect(failRedirect.searchParams.get('error')).toBe('access_denied');
    expect(failRedirect.searchParams.get('code')).toBeNull();
    expect(failRedirect.searchParams.get('state')).toBe('exchange-fail-state');
    expect(approvals).toHaveLength(0);
  });

  it('rejects expired continuations before exchanging upstream code and redirects access_denied', async () => {
    const started = await startClientAuthorize(aliceJwt, { state: 'expire-state' });
    const upstreamState = started.location!.searchParams.get('state')!;

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 601_000);

    const expiredRes = await request(app)
      .get('/oauth/callback')
      .set('Cookie', started.cookie)
      .query({ code: 'late-code', state: upstreamState, iss: UPSTREAM_ISSUER });

    expect(expiredRes.status).toBe(302);
    const expiredRedirect = new URL(expiredRes.headers.location);
    expect(expiredRedirect.searchParams.get('error')).toBe('access_denied');
    expect(expiredRedirect.searchParams.get('code')).toBeNull();
    expect(expiredRedirect.searchParams.get('state')).toBe('expire-state');
    expect(tokenExchangeRequests).toHaveLength(0);

    const ctxAfterExpire = await PersonalOAuthContext.load('ms365', 'alice', servers[0]);
    expect(ctxAfterExpire.config.oauth.pendingAuthorization).toBeUndefined();
  });

  it('rejects mid-flow sessionVersion changes, permission revocations, disabled server, and unregistered redirect URIs', async () => {
    // 1. User password changes (sessionVersion changes) mid-flow.
    const flow1 = await startClientAuthorize(aliceJwt, { state: 'pw-change' });
    users[0] = { ...users[0], password: await bcrypt.hash('new-alice-pass', 4) };
    const res1 = await request(app)
      .get('/oauth/callback')
      .set('Cookie', flow1.cookie)
      .query({
        code: 'code-1',
        state: flow1.location!.searchParams.get('state')!,
        iss: UPSTREAM_ISSUER,
      });
    expect(res1.status).toBe(302);
    expect(new URL(res1.headers.location).searchParams.get('error')).toBe('access_denied');
    expect(new URL(res1.headers.location).searchParams.get('code')).toBeNull();
    expect(tokenExchangeRequests).toHaveLength(0);

    // Refresh aliceJwt for the new password.
    aliceJwt = jwt.sign(
      { user: { username: 'alice', sessionVersion: getUserSessionVersion(users[0]) } },
      JWT_SECRET,
    );

    // 2. Server access revoked mid-flow (visibility switched to private owned by another user).
    const flow2 = await startClientAuthorize(aliceJwt, { state: 'access-revoked' });
    servers[0] = makeMs365Server({ visibility: 'private', owner: 'bob' });
    const res2 = await request(app)
      .get('/oauth/callback')
      .set('Cookie', flow2.cookie)
      .query({
        code: 'code-2',
        state: flow2.location!.searchParams.get('state')!,
        iss: UPSTREAM_ISSUER,
      });
    expect(res2.status).toBe(302);
    expect(new URL(res2.headers.location).searchParams.get('error')).toBe('access_denied');
    expect(new URL(res2.headers.location).searchParams.get('code')).toBeNull();
    expect(tokenExchangeRequests).toHaveLength(0);

    // Restore server access.
    servers[0] = makeMs365Server();

    // 3. Server disabled mid-flow.
    const flow3 = await startClientAuthorize(aliceJwt, { state: 'server-disabled' });
    servers[0] = makeMs365Server({ enabled: false });
    const res3 = await request(app)
      .get('/oauth/callback')
      .set('Cookie', flow3.cookie)
      .query({
        code: 'code-3',
        state: flow3.location!.searchParams.get('state')!,
        iss: UPSTREAM_ISSUER,
      });
    expect(res3.status).toBe(302);
    expect(new URL(res3.headers.location).searchParams.get('error')).toBe('access_denied');
    expect(new URL(res3.headers.location).searchParams.get('code')).toBeNull();
    expect(tokenExchangeRequests).toHaveLength(0);

    // Restore server.
    servers[0] = makeMs365Server();

    // 4. Client redirect_uri removed mid-flow: must NOT redirect to unregistered URI.
    const flow4 = await startClientAuthorize(aliceJwt, { state: 'redirect-removed' });
    clients[0] = makeClient({ redirectUris: ['https://other.example/callback'] });
    const res4 = await request(app)
      .get('/oauth/callback')
      .set('Cookie', flow4.cookie)
      .query({
        code: 'code-4',
        state: flow4.location!.searchParams.get('state')!,
        iss: UPSTREAM_ISSUER,
      });
    expect(res4.status).toBe(400);
    expect(res4.headers.location).toBeUndefined();
    expect(tokenExchangeRequests).toHaveLength(0);
  });

  it('validates client request before starting upstream OAuth and scopes handoff to explicit single-server resources', async () => {
    // Public client missing PKCE must fail BEFORE starting upstream OAuth.
    const noPkce = await startClientAuthorize(aliceJwt, {
      code_challenge: '',
      code_challenge_method: '',
      state: 'no-pkce',
    });
    expect(noPkce.res.status).toBe(302);
    expect(noPkce.location!.origin + noPkce.location!.pathname).toBe(
      'https://hermes.example/callback',
    );
    expect(noPkce.location!.searchParams.get('error')).toBe('invalid_request');
    expect(noPkce.location!.searchParams.get('code')).toBeNull();
    expect(
      (await PersonalOAuthContext.load('ms365', 'alice', servers[0])).config.oauth
        .pendingAuthorization,
    ).toBeUndefined();

    // Disallowed scope fails BEFORE starting upstream OAuth.
    const badScope = await startClientAuthorize(aliceJwt, { scope: 'admin', state: 'bad-scope' });
    expect(badScope.res.status).toBe(302);
    expect(badScope.location!.searchParams.get('error')).toBe('invalid_scope');
    expect(
      (await PersonalOAuthContext.load('ms365', 'alice', servers[0])).config.oauth
        .pendingAuthorization,
    ).toBeUndefined();

    // Group resource is out of scope for first iteration and issues MCPHub code directly without upstream handoff.
    groups = [{ id: 'g1', name: 'team-group', servers: ['ms365'] }];
    const groupRes = await startClientAuthorize(aliceJwt, {
      resource: `${publicInstallBaseUrl}/mcp/team-group`,
      state: 'group-state',
    });
    expect(groupRes.res.status).toBe(302);
    expect(groupRes.location!.origin + groupRes.location!.pathname).toBe(
      'https://hermes.example/callback',
    );
    expect(groupRes.location!.searchParams.get('code')).toBeTruthy();

    // Aggregate /mcp resource issues MCPHub code directly without upstream handoff.
    const aggregateRes = await startClientAuthorize(aliceJwt, {
      resource: `${publicInstallBaseUrl}/mcp`,
      state: 'agg-state',
    });
    expect(aggregateRes.res.status).toBe(302);
    expect(aggregateRes.location!.origin + aggregateRes.location!.pathname).toBe(
      'https://hermes.example/callback',
    );
    expect(aggregateRes.location!.searchParams.get('code')).toBeTruthy();
  });
});
