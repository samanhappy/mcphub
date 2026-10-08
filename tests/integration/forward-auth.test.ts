jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { getUserDao, JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { auth } from '../../src/middlewares/auth.js';
import { getBetterAuthUser } from '../../src/controllers/betterAuthController.js';
import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';
import { handleMcpPostRequest, transports } from '../../src/services/sseService.js';
import { cleanupAllServers, initializeClientsFromSettings } from '../../src/services/mcpService.js';
import { resetForwardAuthStateForTests } from '../../src/services/forwardAuthService.js';
import { clearSettingsCache } from '../../src/config/index.js';
import { createUserToken } from '../utils/testHelpers.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  removeToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));

const ISSUER = 'https://idp.example.test/';
const AUDIENCE = 'mcphub';
const KID = 'test-key-1';

let directory: string;
let jwksServer: HttpServer;
let hubServer: HttpServer;
let hubUrl: string;
let app: express.Express;
let signingKey: CryptoKey;
let attackerKey: CryptoKey;
const clients: Client[] = [];
const originalEnv = {
  path: process.env.MCPHUB_SETTING_PATH,
  useDb: process.env.USE_DB,
};

const listen = (server: express.Express) =>
  new Promise<HttpServer>((resolve) => {
    const listener = server.listen(0, '127.0.0.1', () => resolve(listener));
  });

interface TokenOptions {
  sub?: string;
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
  key?: CryptoKey;
}

const signToken = async ({
  sub = 'gateway-sub-1',
  claims = { username: 'gateway.user', email: 'gateway.user@example.test' },
  issuer = ISSUER,
  audience = AUDIENCE,
  expiresIn = '5m',
  key,
}: TokenOptions = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key || signingKey);

const whoami = (headers: Record<string, string>) => {
  let req = request(app).get('/api/whoami');
  for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
  return req;
};

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  attackerKey = (await generateKeyPair('RS256')).privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

  const jwksApp = express();
  jwksApp.get('/jwks', (_req, res) => {
    res.json({ keys: [publicJwk] });
  });
  jwksServer = await listen(jwksApp);
  const jwksPort = (jwksServer.address() as { port: number }).port;

  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-forward-auth-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  const settings: McpSettings = {
    mcpServers: {},
    users: [
      { username: 'admin', password: 'unused', isAdmin: true },
      {
        username: 'local.user',
        password: 'unused',
        isAdmin: false,
        email: 'local.user@example.test',
      },
    ],
    groups: [],
    bearerKeys: [],
    systemConfig: {
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        skipAuth: false,
      },
      oauthServer: { enabled: false },
      auth: {
        forwardAuth: {
          enabled: true,
          mode: 'jwks',
          jwks: {
            uri: `http://127.0.0.1:${jwksPort}/jwks`,
            issuer: ISSUER,
            audience: AUDIENCE,
            algorithms: ['RS256'],
          },
          usernameClaim: 'username',
        },
      },
    },
  };
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH, JSON.stringify(settings));
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());
  resetForwardAuthStateForTests();
  await initializeClientsFromSettings(true);

  app = express();
  app.use(express.json());
  app.get('/api/whoami', auth, (req, res) => {
    res.json({ user: (req as any).user });
  });
  app.get('/api/better-auth/user', auth, getBetterAuthUser);
  app.post('/mcp', sseUserContextMiddleware, handleMcpPostRequest);
  app.post('/:user/mcp', sseUserContextMiddleware, handleMcpPostRequest);
  hubServer = await listen(app);
  hubUrl = `http://127.0.0.1:${(hubServer.address() as { port: number }).port}`;
});

afterAll(async () => {
  for (const client of clients) await client.close();
  for (const entry of Object.values(transports)) await entry.transport.close();
  cleanupAllServers();
  for (const server of [hubServer, jwksServer]) {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries({
    MCPHUB_SETTING_PATH: originalEnv.path,
    USE_DB: originalEnv.useDb,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  delete process.env.FORWARD_AUTH_AUTO_CREATE;
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

describe('forward auth (JWKS) on the dashboard API', () => {
  it('creates a non-admin user bound to the namespaced identity on first sight', async () => {
    const res = await whoami({ Authorization: `Bearer ${await signToken()}` });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ username: 'gateway.user', isAdmin: false });

    const stored = await getUserDao().findByUsername('gateway.user');
    expect(stored?.isAdmin).toBe(false);
    expect(stored?.email).toBe('gateway.user@example.test');
    expect(stored?.ssoUserId).toMatch(/^forward-auth:[0-9a-f]{64}$/);
  });

  it('resolves the same sub to the same user and keeps the local username', async () => {
    const token = await signToken({ claims: { username: 'renamed.at.idp' } });
    const res = await whoami({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('gateway.user');
    expect(await getUserDao().findByUsername('renamed.at.idp')).toBeNull();
  });

  it.each([
    ['a bad signature', () => signToken({ key: attackerKey })],
    ['an expired token', () => signToken({ expiresIn: Math.floor(Date.now() / 1000) - 3600 })],
    ['a wrong audience', () => signToken({ audience: 'someone-else' })],
  ])('rejects %s from the configured issuer', async (_label, makeToken) => {
    const res = await whoami({ Authorization: `Bearer ${await makeToken()}` });
    expect(res.status).toBe(401);
  });

  it('rejects an HS256 token from the configured issuer', async () => {
    const hsToken = await new SignJWT({ username: 'gateway.user' })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('gateway-sub-1')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-of-sufficient-length'));

    const res = await whoami({ Authorization: `Bearer ${hsToken}` });
    expect(res.status).toBe(401);
  });

  it('does not fall back to another method when a configured-issuer token is invalid', async () => {
    const res = await whoami({
      Authorization: `Bearer ${await signToken({ key: attackerKey })}`,
      'x-auth-token': createUserToken('admin', true),
    });
    expect(res.status).toBe(401);
  });

  it('lets tokens from other issuers fall through to the existing methods', async () => {
    const res = await whoami({
      Authorization: `Bearer ${await signToken({ issuer: 'https://other.example.test/' })}`,
      'x-auth-token': createUserToken('admin', true),
    });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
  });

  it.each([
    ['an admin username', { username: 'admin' }],
    ['an existing local username', { username: 'local.user' }],
    ['an existing email', { username: 'fresh.name', email: 'local.user@example.test' }],
  ])('never links an existing account by %s', async (_label, claims) => {
    const res = await whoami({
      Authorization: `Bearer ${await signToken({ sub: `collide-${claims.username}`, claims })}`,
    });

    expect(res.status).toBe(401);
    expect((await getUserDao().findByUsername('admin'))?.ssoUserId).toBeFalsy();
    expect((await getUserDao().findByUsername('local.user'))?.ssoUserId).toBeFalsy();
    expect(await getUserDao().findByUsername('fresh.name')).toBeNull();
  });

  it('rejects unbound identities when autoCreate is turned off by env override', async () => {
    process.env.FORWARD_AUTH_AUTO_CREATE = 'false';
    try {
      const unbound = await whoami({
        Authorization: `Bearer ${await signToken({ sub: 'new-sub', claims: { username: 'new.user' } })}`,
      });
      expect(unbound.status).toBe(401);
      expect(await getUserDao().findByUsername('new.user')).toBeNull();

      const bound = await whoami({ Authorization: `Bearer ${await signToken()}` });
      expect(bound.status).toBe(200);
      expect(bound.body.user.username).toBe('gateway.user');
    } finally {
      delete process.env.FORWARD_AUTH_AUTO_CREATE;
    }
  });
});

describe('forward auth identity isolation', () => {
  it('binds a contested username to exactly one identity under concurrent first logins', async () => {
    const tokens = await Promise.all(
      ['race-sub-a', 'race-sub-b', 'race-sub-c'].map((sub) =>
        signToken({ sub, claims: { username: 'race.user' } }),
      ),
    );

    const responses = await Promise.all(
      tokens.map((token) => whoami({ Authorization: `Bearer ${token}` })),
    );

    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 401)).toHaveLength(2);
    const users = await getUserDao().findAll();
    expect(users.filter((user) => user.username === 'race.user')).toHaveLength(1);
  });

  it('keeps whitespace-distinct subjects as separate identities', async () => {
    const plain = await whoami({
      Authorization: `Bearer ${await signToken({ sub: 'ws-sub', claims: { username: 'ws.one' } })}`,
    });
    const padded = await whoami({
      Authorization: `Bearer ${await signToken({ sub: ' ws-sub ', claims: { username: 'ws.two' } })}`,
    });

    expect(plain.body.user.username).toBe('ws.one');
    expect(padded.body.user.username).toBe('ws.two');
    const one = await getUserDao().findByUsername('ws.one');
    const two = await getUserDao().findByUsername('ws.two');
    expect(one?.ssoUserId).not.toBe(two?.ssoUserId);
  });

  it('stores username and email claims exactly as issued', async () => {
    const res = await whoami({
      Authorization: `Bearer ${await signToken({
        sub: 'verbatim-sub',
        claims: { username: ' Verbatim.User ', email: ' Verbatim@Example.test ' },
      })}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(' Verbatim.User ');
    const stored = await getUserDao().findByUsername(' Verbatim.User ');
    expect(stored?.email).toBe(' Verbatim@Example.test ');
    expect(await getUserDao().findByUsername('Verbatim.User')).toBeNull();
  });

  it('rejects a blank subject', async () => {
    const res = await whoami({
      Authorization: `Bearer ${await signToken({ sub: '   ', claims: { username: 'blank.sub' } })}`,
    });
    expect(res.status).toBe(401);
    expect(await getUserDao().findByUsername('blank.sub')).toBeNull();
  });
});

describe('forward auth dashboard bootstrap', () => {
  it('returns the gateway-authenticated user from the dashboard bootstrap endpoint', async () => {
    const res = await request(app)
      .get('/api/better-auth/user')
      .set('Authorization', `Bearer ${await signToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'gateway.user', isAdmin: false });
  });

  it('still rejects the bootstrap endpoint without any credentials', async () => {
    const res = await request(app).get('/api/better-auth/user');
    expect(res.status).toBe(401);
  });
});

describe('forward auth (JWKS) on MCP transport routes', () => {
  it('authenticates an MCP client with a valid token', async () => {
    const client = new Client({ name: 'forward-auth-e2e', version: '1' });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${hubUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${await signToken()}` } },
      }),
    );
    expect(client.getServerVersion()).toBeDefined();
  });

  const initialize = (url: string, token: string) =>
    request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'forward-auth-e2e', version: '1' },
        },
      });

  it('rejects an invalid configured-issuer token with a bearer challenge', async () => {
    const res = await initialize('/mcp', await signToken({ key: attackerKey }));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
  });

  it('forbids user-scoped routes for a different user', async () => {
    const res = await initialize('/local.user/mcp', await signToken());
    expect(res.status).toBe(403);
  });
});
