import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let allowRegistration: boolean | undefined;
let disablePasswordLogin = false;
const createUser = jest.fn();
let servers: Array<{ owner?: string; sharedWithUsers?: string[] }> = [];
let groups: Array<{ owner?: string; sharedWithUsers?: string[] }> = [];
let clients: Array<{ owner?: string }> = [];
let tokens: Array<{ username: string }> = [];
let keys: Array<{ owner?: string }> = [];
let userConfigs: Record<string, object> = {};
const readServers = jest.fn(async () => servers);
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: () => ({ findAll: readServers }),
  getGroupDao: () => ({ findAll: async () => groups }),
  getOAuthClientDao: () => ({ findAll: async () => clients }),
  getOAuthTokenDao: () => ({ findAll: async () => tokens }),
  getBearerKeyDao: () => ({ findAll: async () => keys }),
  getUserConfigDao: () => ({
    exists: async (username: string) => Object.hasOwn(userConfigs, username),
  }),
  getSystemConfigDao: () => ({ get: async () => ({ auth: { allowRegistration } }) }),
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: async () => ({ disablePasswordLogin }),
}));
jest.mock('../../src/models/User.js', () => ({
  createUser: (...args: unknown[]) => createUser(...args),
}));
jest.mock('../../src/services/services.js', () => ({
  getDataService: () => ({ getPermissions: () => [''] }),
}));
jest.mock('../../src/config/jwt.js', () => ({ JWT_SECRET: 'registration-test-secret' }));
import { register } from '../../src/controllers/authController.js';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).t = (key: string) => key;
  next();
});
app.post('/api/auth/register', register);
const submit = (body = {}) =>
  request(app)
    .post('/api/auth/register')
    .send({
      username: 'alice',
      password: 'Strong123!',
      ...body,
    });

beforeEach(() => {
  servers = [];
  groups = [];
  clients = [];
  tokens = [];
  keys = [];
  userConfigs = {};
  readServers.mockReset().mockImplementation(async () => servers);
  allowRegistration = true;
  disablePasswordLogin = false;
  createUser.mockReset().mockResolvedValue({ username: 'alice', isAdmin: false });
});

it.each([undefined, false])('refuses registration when the switch is %s', async (value) => {
  allowRegistration = value;
  expect((await submit()).status).toBe(403);
  expect(createUser).not.toHaveBeenCalled();
});
it('refuses registration while password login is disabled', async () => {
  disablePasswordLogin = true;
  expect((await submit()).status).toBe(403);
  expect(createUser).not.toHaveBeenCalled();
});
it('creates only a regular user and returns a usable token', async () => {
  const response = await submit({ isAdmin: true });
  expect(response.status).toBe(200);
  expect(createUser).toHaveBeenCalledWith({
    username: 'alice',
    password: 'Strong123!',
    isAdmin: false,
  });
  expect(jwt.verify(response.body.token, 'registration-test-secret')).toMatchObject({
    user: { username: 'alice', isAdmin: false },
  });
});
it('rejects weak passwords before creating the user', async () => {
  expect((await submit({ password: 'secret123' })).status).toBe(400);
  expect(createUser).not.toHaveBeenCalled();
});
it('reports a duplicate account without a token', async () => {
  createUser.mockResolvedValue(null);
  const response = await submit();
  expect(response.status).toBe(400);
  expect(response.body.token).toBeUndefined();
});

// No account exists for alice in these cases; only the deleted user's references remain.
it.each([
  [
    'private server owner',
    () => {
      servers = [{ owner: 'alice' }];
    },
  ],
  [
    'normalized server owner',
    () => {
      servers = [{ owner: ' alice ' }];
    },
  ],
  [
    'server sharing recipient',
    () => {
      servers = [{ owner: 'other', sharedWithUsers: ['alice'] }];
    },
  ],
  [
    'group owner',
    () => {
      groups = [{ owner: 'alice' }];
    },
  ],
  [
    'group sharing recipient',
    () => {
      groups = [{ sharedWithUsers: ['alice'] }];
    },
  ],
  [
    'OAuth client owner',
    () => {
      clients = [{ owner: 'alice' }];
    },
  ],
  [
    'OAuth token subject',
    () => {
      tokens = [{ username: 'alice' }];
    },
  ],
  [
    'bearer key owner',
    () => {
      keys = [{ owner: 'alice' }];
    },
  ],
  [
    'user configuration',
    () => {
      userConfigs = { alice: {} };
    },
  ],
] as const)('refuses reuse of a deleted username referenced as %s', async (_name, seed) => {
  seed();
  const response = await submit();
  expect(response.status).toBe(400);
  expect(response.body.token).toBeUndefined();
  expect(createUser).not.toHaveBeenCalled();
});
it('does not reserve unrelated usernames', async () => {
  servers = [{ owner: 'bob', sharedWithUsers: ['carol'] }];
  expect((await submit()).status).toBe(200);
});
it('fails closed when resource references cannot be read', async () => {
  readServers.mockRejectedValue(new Error('Resource store unavailable'));
  const response = await submit();
  expect(response.status).toBe(500);
  expect(createUser).not.toHaveBeenCalled();
});

it('reserves the implicit admin owner even without a user record', async () => {
  expect((await submit({ username: 'admin' })).status).toBe(400);
  expect(createUser).not.toHaveBeenCalled();
});
