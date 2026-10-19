import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let allowRegistration: boolean | undefined;
let disablePasswordLogin = false;
const createUser = jest.fn();
jest.mock('../../src/dao/DaoFactory.js', () => ({
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
