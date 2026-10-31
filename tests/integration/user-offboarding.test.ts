import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { IUser, IOAuthToken, IGroup, ServerConfig } from '../../src/types/index.js';

let users: IUser[];
let tokens: IOAuthToken[];
let groups: IGroup[];
let servers: (ServerConfig & { name: string })[];
const client = {
  clientId: 'offboarding-client',
  redirectUris: ['https://client.example/callback'],
  grants: ['authorization_code', 'refresh_token'],
};
const revokeUserTokensMock = jest.fn(async (username: string) => {
  tokens = tokens.filter((token) => token.username !== username);
  return 1;
});

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: () => ({
    findAll: async () => users,
    findByUsername: async (username: string) => users.find((user) => user.username === username),
    delete: async (username: string) => {
      users = users.filter((user) => user.username !== username);
      return true;
    },
    createWithHashedPassword: async (username: string, password: string, isAdmin: boolean) => {
      const user = { username, password: await bcrypt.hash(password, 4), isAdmin };
      users.push(user);
      return user;
    },
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
    revokeToken: async (value: string) => {
      tokens = tokens.filter(
        (token) => token.accessToken !== value && token.refreshToken !== value,
      );
      return true;
    },
    revokeUserTokens: (username: string) => revokeUserTokensMock(username),
  }),
  getGroupDao: () => ({
    findAll: async () => groups,
    update: async (id: string, data: Partial<IGroup>) =>
      Object.assign(groups.find((g) => g.id === id)!, data),
  }),
  getServerDao: () => ({
    findAll: async () => servers,
    update: async (name: string, data: Partial<ServerConfig>) =>
      Object.assign(servers.find((s) => s.name === name)!, data),
  }),
  getSystemConfigDao: () => ({ get: async () => ({ oauthServer: { enabled: true } }) }),
}));
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: () => ({ get: async () => ({ oauthServer: { enabled: true } }) }),
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
jest.mock('../../src/services/mcpService.js', () => ({ updateServerInfoVisibility: jest.fn() }));
jest.mock('../../src/services/credentialBindingService.js', () => ({
  deleteCredentialBindings: jest.fn(),
}));

import { JWT_SECRET } from '../../src/config/jwt.js';
import { auth } from '../../src/middlewares/auth.js';
import { login, register } from '../../src/controllers/authController.js';
import { deleteExistingUser } from '../../src/controllers/userController.js';
import { postAuthorize, postToken } from '../../src/controllers/oauthServerController.js';
import {
  initOAuthServer,
  generateCodeChallenge,
  getOAuthModel,
} from '../../src/services/oauthServerService.js';
import { getAuthorizationCode, getToken } from '../../src/models/OAuth.js';
import { resolveOAuthUserFromToken } from '../../src/utils/oauthBearer.js';
import { getUserSessionVersion } from '../../src/utils/userSession.js';
import { DataService } from '../../src/services/dataService.js';

const userToken = (user: IUser) =>
  jwt.sign(
    {
      user: {
        username: user.username,
        sessionVersion: getUserSessionVersion(user),
        isAdmin: user.isAdmin,
      },
    },
    JWT_SECRET,
  );

describe('local user offboarding', () => {
  const verifier = 'a'.repeat(64);
  let app: express.Application;
  let adminJwt: string;
  let victimJwt: string;

  beforeEach(async () => {
    users = [
      { username: 'admin', password: await bcrypt.hash('admin-password', 4), isAdmin: true },
      { username: 'victim', password: await bcrypt.hash('victim-password', 4), isAdmin: false },
    ];
    tokens = [];
    groups = [
      {
        id: 'g1',
        name: 'g1',
        servers: ['s1'],
        visibility: 'group',
        sharedWithUsers: ['victim', 'other'],
      },
    ];
    servers = [{ name: 's1', visibility: 'group', sharedWithUsers: ['victim', 'other'] }];
    adminJwt = userToken(users[0]);
    victimJwt = userToken(users[1]);
    await initOAuthServer();
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use((req, _res, next) => {
      (req as express.Request & { t: (key: string) => string }).t = (key) => key;
      next();
    });
    app.post('/api/auth/login', login);
    app.post('/oauth/authorize', postAuthorize);
    app.post('/oauth/token', postToken);
    app.post('/api/auth/register', register);
    app.delete('/api/users/:username', auth, deleteExistingUser);
    app.get('/api/protected', auth, (req, res) =>
      res.json((req as express.Request & { user: unknown }).user),
    );
    // Exercise the transport's OAuth resolver and shared-resource authorization without spawning an upstream.
    app.post('/mcp/g1', async (req, res) => {
      const user = await resolveOAuthUserFromToken(req.headers.authorization?.slice(7));
      if (!user) {
        res.sendStatus(401);
        return;
      }
      res.status(new DataService().filterData(groups, user).length ? 200 : 403).json({ tools: [] });
    });
  });

  const authorize = (token = victimJwt) =>
    request(app)
      .post('/oauth/authorize')
      .send({
        allow: 'true',
        client_id: client.clientId,
        redirect_uri: client.redirectUris[0],
        response_type: 'code',
        scope: 'read',
        token,
        code_challenge: generateCodeChallenge(verifier),
        code_challenge_method: 'S256',
      });
  const exchange = (code: string) =>
    request(app).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code',
      client_id: client.clientId,
      redirect_uri: client.redirectUris[0],
      code,
      code_verifier: verifier,
    });
  const refresh = (token: string) =>
    request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      refresh_token: token,
    });
  const issue = async (token = victimJwt) => {
    const authorization = await authorize(token);
    expect(authorization.status).toBe(302);
    const code = new URL(authorization.headers.location).searchParams.get('code')!;
    const response = await exchange(code);
    expect(response.status).toBe(200);
    return response.body;
  };

  it('rejects access, refresh, JWT and pending codes after deletion and removes sharing', async () => {
    const pair = await issue();
    const refreshed = await refresh(pair.refresh_token);
    expect(refreshed.status).toBe(200);
    const livePair = refreshed.body;
    const pending = await authorize();
    const code = new URL(pending.headers.location).searchParams.get('code')!;
    expect(
      (await request(app).post('/mcp/g1').auth(livePair.access_token, { type: 'bearer' })).status,
    ).toBe(200);

    expect(
      (await request(app).delete('/api/users/victim').set('x-auth-token', adminJwt)).status,
    ).toBe(200);
    expect(tokens).toHaveLength(0);
    expect(groups[0].sharedWithUsers).toEqual(['other']);
    expect(servers[0].sharedWithUsers).toEqual(['other']);
    expect(await getAuthorizationCode(code)).toBeUndefined();
    expect(
      (await request(app).post('/mcp/g1').auth(livePair.access_token, { type: 'bearer' })).status,
    ).toBe(401);
    expect((await refresh(livePair.refresh_token)).body.error).toBe('invalid_grant');
    expect((await exchange(code)).body.error).toBe('invalid_grant');
    expect((await request(app).get('/api/protected').set('x-auth-token', victimJwt)).status).toBe(
      401,
    );
    expect((await authorize()).status).toBe(401);
  });

  it('rejects orphaned persisted credentials even after same-name recreation', async () => {
    const pair = await issue();
    const oldToken = { ...tokens[0] };
    const pending = await authorize();
    const code = new URL(pending.headers.location).searchParams.get('code')!;
    users = users.filter((user) => user.username !== 'victim');
    expect(await getToken(pair.access_token)).toBeUndefined();
    expect((await refresh(pair.refresh_token)).body.error).toBe('invalid_grant');
    users.push({ username: 'victim', password: await bcrypt.hash('victim-password', 4) });
    expect(tokens).toContainEqual(oldToken);
    expect((await exchange(code)).body.error).toBe('invalid_grant');
    expect(await getToken(pair.access_token)).toBeUndefined();
    expect((await refresh(pair.refresh_token)).body.error).toBe('invalid_grant');
    expect((await authorize()).status).toBe(401);
    expect((await request(app).get('/api/protected').set('x-auth-token', victimJwt)).status).toBe(
      401,
    );
    const freshJwt = userToken(users[1]);
    expect((await request(app).get('/api/protected').set('x-auth-token', freshJwt)).status).toBe(
      200,
    );
  });

  it('keeps registration disabled by default and MCP OAuth credentials out of management APIs', async () => {
    const pair = await issue(adminJwt);
    const registration = { username: 'new-user', password: 'new-password' };
    expect((await request(app).post('/api/auth/register').send(registration)).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .set('x-auth-token', victimJwt)
          .send(registration)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .auth(pair.access_token, { type: 'bearer' })
          .send(registration)
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/protected').auth(pair.access_token, { type: 'bearer' })).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .set('x-auth-token', adminJwt)
          .send(registration)
      ).status,
    ).toBe(403);
  });

  it('loads current roles instead of trusting the administrator claim in a JWT', async () => {
    users[0].isAdmin = false;
    const response = await request(app).get('/api/protected').set('x-auth-token', adminJwt);
    expect(response.status).toBe(200);
    expect(response.body.isAdmin).toBe(false);
    expect(
      (
        await request(app)
          .post('/api/auth/register')
          .set('x-auth-token', adminJwt)
          .send({ username: 'new', password: 'secret123' })
      ).status,
    ).toBe(403);
  });

  it('issues versioned JWTs at login and rejects legacy JWT and OAuth credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'victim', password: 'victim-password' });
    expect(response.status).toBe(200);
    expect(
      (await request(app).get('/api/protected').set('x-auth-token', response.body.token)).status,
    ).toBe(200);
    const legacy = jwt.sign({ user: { username: 'victim', isAdmin: true } }, JWT_SECRET);
    expect((await request(app).get('/api/protected').set('x-auth-token', legacy)).status).toBe(401);
    await issue();
    delete tokens[0].sessionVersion;
    expect(await getToken(tokens[0].accessToken)).toBeUndefined();
  });

  it('keeps the user record when credential cleanup fails', async () => {
    revokeUserTokensMock.mockRejectedValueOnce(new Error('storage unavailable'));
    const response = await request(app).delete('/api/users/victim').set('x-auth-token', adminJwt);
    expect(response.status).toBe(400);
    expect(users.some((user) => user.username === 'victim')).toBe(true);
  });

  it('rejects a grant if the user changes between grant validation and token persistence', async () => {
    const session = { username: 'victim', sessionVersion: getUserSessionVersion(users[1]) };
    users[1].password = await bcrypt.hash('replacement', 4);
    await expect(getOAuthModel().saveToken({}, { id: client.clientId }, session)).rejects.toThrow(
      /session/,
    );
    expect(tokens).toHaveLength(0);
  });
});
