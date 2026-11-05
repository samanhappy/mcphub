import { resolveOAuthUserFromToken } from '../../src/utils/oauthBearer.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { IUser, IOAuthToken, OAuthClientApproval } from '../../src/types/index.js';

let users: IUser[];
let approvals: OAuthClientApproval[];
let allowedScopes = ['read', 'write'];
let requireState = false;
let alwaysShowApprovalScreen: boolean | undefined = false;
let tokens: IOAuthToken[];
const client = {
  clientId: 'offboarding-client',
  redirectUris: ['https://client.example/callback'],
  grants: ['authorization_code', 'refresh_token'],
};
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
  getBearerKeyDao: () => ({ findEnabled: async () => [], deleteByOwner: async () => 0 }),
  getOAuthClientDao: () => ({ findByClientId: async () => client }),
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
      oauthServer: { enabled: true, alwaysShowApprovalScreen, allowedScopes, requireState },
    }),
  }),
}));
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: () => ({
    get: async () => ({
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
jest.mock('../../src/services/forwardAuthService.js', () => ({
  authenticateForwardAuthToken: async () => ({ status: 'unhandled' }),
}));
jest.mock('../../src/services/services.js', () => ({
  getDataService: () => ({ getPermissions: () => [] }),
}));

import {
  listMyOAuthApprovals,
  revokeMyOAuthApproval,
} from '../../src/controllers/oauthApprovalController.js';
import { auth } from '../../src/middlewares/auth.js';
import { getToken } from '../../src/models/OAuth.js';
import { JWT_SECRET } from '../../src/config/jwt.js';
import {
  getAuthorize,
  postAuthorize,
  postToken,
} from '../../src/controllers/oauthServerController.js';
import { initOAuthServer, generateCodeChallenge } from '../../src/services/oauthServerService.js';
import { getUserSessionVersion } from '../../src/utils/userSession.js';

describe('OAuth remembered consent', () => {
  let app: express.Application;
  let userJwt: string;
  const verifier = 'a'.repeat(64);
  const authorization = () => ({
    client_id: client.clientId,
    redirect_uri: client.redirectUris[0],
    response_type: 'code',
    scope: 'read',
    state: 'client-state',
    code_challenge: generateCodeChallenge(verifier),
    code_challenge_method: 'S256',
    resource: 'https://hub.example/mcp/calendar',
    token: userJwt,
  });

  beforeEach(async () => {
    users = [{ username: 'alice', password: await bcrypt.hash('password', 4) }];
    requireState = false;
    allowedScopes = ['read', 'write'];
    tokens = [];
    approvals = [];
    alwaysShowApprovalScreen = false;
    userJwt = jwt.sign(
      { user: { username: 'alice', sessionVersion: getUserSessionVersion(users[0]) } },
      JWT_SECRET,
    );
    await initOAuthServer();
    app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    app.get('/api/oauth/approvals', auth, listMyOAuthApprovals);
    app.delete('/api/oauth/approvals/:approvalId', auth, revokeMyOAuthApproval);
    app.get('/oauth/authorize', getAuthorize);
    app.post('/oauth/authorize', postAuthorize);
    app.post('/oauth/token', postToken);
    app.post('/mcp', async (req, res) => {
      const user = await resolveOAuthUserFromToken(req.headers.authorization?.slice(7));
      res.sendStatus(user ? 200 : 401);
    });
  });

  it('issues a fresh code on a previously approved request and preserves state and PKCE', async () => {
    expect((await request(app).get('/oauth/authorize').query(authorization())).status).toBe(200);
    const first = await request(app)
      .post('/oauth/authorize')
      .send({ ...authorization(), allow: 'true' });
    expect(first.status).toBe(302);
    const second = await request(app).get('/oauth/authorize').query(authorization());
    expect(second.status).toBe(302);
    const callback = new URL(second.headers.location);
    expect(callback.searchParams.get('state')).toBe('client-state');
    expect(callback.searchParams.get('code')).not.toBe(
      new URL(first.headers.location).searchParams.get('code'),
    );
    const exchange = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        redirect_uri: client.redirectUris[0],
        code: callback.searchParams.get('code'),
        code_verifier: verifier,
      });
    expect(exchange.status).toBe(200);
    expect(exchange.body.scope).toBe('read');
  });
  const approve = (overrides = {}) =>
    request(app)
      .post('/oauth/authorize')
      .send({ ...authorization(), ...overrides, allow: 'true' });
  const authorize = (overrides = {}) =>
    request(app)
      .get('/oauth/authorize')
      .query({ ...authorization(), ...overrides });
  const exchange = (response: request.Response, verifierValue = verifier) =>
    request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        redirect_uri: client.redirectUris[0],
        code: new URL(response.headers.location).searchParams.get('code'),
        code_verifier: verifierValue,
      });
  const refresh = (refreshToken: string) =>
    request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      refresh_token: refreshToken,
    });

  it.each([
    ['a new scope', { scope: 'read write' }],
    ['another resource', { resource: 'https://hub.example/mcp' }],
    ['a missing resource', { resource: '' }],
    ['an invalid scope', { scope: 'unknown' }],
  ])('asks again for %s', async (_label, overrides) => {
    await approve();
    expect((await authorize(overrides)).status).toBe(200);
  });

  it('reuses a superset regardless of scope ordering and never extends the deadline', async () => {
    await approve({ scope: 'write read read' });
    const deadline = approvals[0].expiresAt;
    expect((await authorize({ scope: 'read' })).status).toBe(302);
    expect((await authorize({ scope: 'read write' })).status).toBe(302);
    expect(approvals[0].expiresAt).toBe(deadline);
    expect(approvals).toHaveLength(1);
  });

  it('uses configured default scopes for display and consent comparison', async () => {
    allowedScopes = ['custom'];
    const page = await authorize({ scope: '' });
    expect(page.status).toBe(200);
    expect(page.text).toContain('custom');
    await approve({ scope: '' });
    expect((await authorize({ scope: '' })).status).toBe(302);
    allowedScopes = ['custom', 'extra'];
    expect((await authorize({ scope: '' })).status).toBe(200);
  });

  it('retains every-time consent when configured or unspecified', async () => {
    await approve();
    alwaysShowApprovalScreen = true;
    expect((await authorize()).status).toBe(200);
    await approve();
    expect(approvals).toHaveLength(1);
    alwaysShowApprovalScreen = undefined;
    expect((await authorize()).status).toBe(200);
  });

  it('requires authentication and does not share consent between users or recreated accounts', async () => {
    await approve();
    users.push({ username: 'bob', password: await bcrypt.hash('password', 4) });
    const otherJwt = jwt.sign(
      { user: { username: 'bob', sessionVersion: getUserSessionVersion(users[1]) } },
      JWT_SECRET,
    );
    expect((await authorize({ token: otherJwt })).status).toBe(200);
    expect((await authorize({ token: '' })).headers.location).toMatch(/^\/login/);
    users[0].password = await bcrypt.hash('password', 4);
    userJwt = jwt.sign(
      { user: { username: 'alice', sessionVersion: getUserSessionVersion(users[0]) } },
      JWT_SECRET,
    );
    expect((await authorize()).status).toBe(200);
  });

  it('re-prompts after expiry while existing tokens can still rotate', async () => {
    const pair = await exchange(await approve());
    approvals[0].expiresAt = new Date(Date.now() - 1).toISOString();
    expect((await authorize()).status).toBe(200);
    expect((await refresh(pair.body.refresh_token)).status).toBe(200);
    expect(Date.parse(approvals[0].expiresAt)).toBeLessThan(Date.now());
  });

  it('requires a fresh approval when registered callbacks change', async () => {
    await approve();
    client.redirectUris.push('https://client.example/another');
    try {
      expect((await authorize()).status).toBe(200);
      expect((await authorize({ redirect_uri: 'https://attacker.example/' })).status).toBe(400);
    } finally {
      client.redirectUris.pop();
    }
  });

  it('returns OAuth validation errors on the silent path', async () => {
    await approve();
    requireState = true;
    await initOAuthServer();
    const response = await authorize({ state: '' });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.location).searchParams.get('error')).toBe('invalid_request');
  });

  it('validates PKCE on silent authorization and on code exchange', async () => {
    await approve();
    expect((await authorize({ code_challenge: '', code_challenge_method: '' })).status).toBe(400);
    expect((await exchange(await authorize(), 'b'.repeat(64))).status).toBe(400);
  });

  it('lists only the current user grants and revokes tokens and pending codes for the application', async () => {
    const pair = await exchange(await approve());
    const rotated = await refresh(pair.body.refresh_token);
    expect(rotated.status).toBe(200);
    const pending = await authorize();
    const other = { ...approvals[0], id: randomUUID(), username: 'bob' };
    approvals.push(other);
    const listing = await request(app).get('/api/oauth/approvals').set('x-auth-token', userJwt);
    expect(listing.status).toBe(200);
    expect(listing.body.data).toHaveLength(1);
    expect(listing.body.data[0].sessionVersion).toBeUndefined();
    expect(
      (await request(app).delete(`/api/oauth/approvals/${other.id}`).set('x-auth-token', userJwt))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/api/oauth/approvals/${approvals[0].id}`)
          .set('x-auth-token', userJwt)
      ).status,
    ).toBe(200);
    expect(approvals).toEqual([other]);
    expect(await getToken(rotated.body.access_token)).toBeUndefined();
    expect((await refresh(rotated.body.refresh_token)).body.error).toBe('invalid_grant');
    expect((await exchange(pending)).body.error).toBe('invalid_grant');
    expect((await authorize()).status).toBe(200);
    // A later explicit approval must never resurrect an old grant.
    await approve();
    expect(await getToken(rotated.body.access_token)).toBeUndefined();
  });

  it('rejects retained tokens when another instance deletes their grant', async () => {
    const pair = await exchange(await approve());
    const pending = await authorize();
    expect(await getToken(pair.body.access_token)).toBeDefined();
    expect(
      (await request(app).post('/mcp').auth(pair.body.access_token, { type: 'bearer' })).status,
    ).toBe(200);
    approvals = []; // Simulate a remote revocation without local token/code cleanup.
    expect(
      (await request(app).post('/mcp').auth(pair.body.access_token, { type: 'bearer' })).status,
    ).toBe(401);
    expect(await getToken(pair.body.access_token)).toBeUndefined();
    expect((await refresh(pair.body.refresh_token)).body.error).toBe('invalid_grant');
    expect((await exchange(pending)).body.error).toBe('invalid_grant');
  });

  it('protects management APIs with dashboard authentication', async () => {
    const pair = await exchange(await approve());
    expect((await request(app).get('/api/oauth/approvals')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/oauth/approvals')
          .auth(pair.body.access_token, { type: 'bearer' })
      ).status,
    ).toBe(401);
  });
});
