import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { JsonFileDaoFactory, getPasskeyDao, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { PasskeyDaoImpl } from '../../src/dao/PasskeyDao.js';
import { auth } from '../../src/middlewares/auth.js';
import {
  createPasskeyLoginOptions,
  createPasskeyRegistrationOptions,
  deleteMyPasskey,
  listMyPasskeys,
  loginWithPasskey,
  registerMyPasskey,
} from '../../src/controllers/passkeyController.js';
import { login } from '../../src/controllers/authController.js';
import { deleteUser } from '../../src/services/userService.js';
import { createUser, updateUserPassword } from '../../src/models/User.js';
import * as betterAuthConfig from '../../src/services/betterAuthConfig.js';
import { clearSettingsCache } from '../../src/config/index.js';
import { resolveJwtUser } from '../../src/utils/userSession.js';
import { resetForwardAuthStateForTests } from '../../src/services/forwardAuthService.js';
import type { McpSettings } from '../../src/types/index.js';
import { SoftwareAuthenticator } from '../utils/softwareAuthenticator.js';

jest.mock('../../src/services/mcpService.js', () => ({ updateServerInfoVisibility: jest.fn() }));

const ORIGIN = 'https://hub.example.test';
const SYSTEM_KEY = 'system-key-0123456789abcdef';

let directory: string;
let app: express.Express;
const originalEnv = {
  path: process.env.MCPHUB_SETTING_PATH,
  useDb: process.env.USE_DB,
};

const writeSettings = async () => {
  const settings: McpSettings = {
    mcpServers: {},
    users: [
      { username: 'admin', password: await bcrypt.hash('admin-pass-1!', 4), isAdmin: true },
      { username: 'alice', password: await bcrypt.hash('alice-pass-1!', 4), isAdmin: false },
      { username: 'bob', password: await bcrypt.hash('bob-pass-1!', 4), isAdmin: false },
    ],
    groups: [],
    bearerKeys: [
      {
        id: 'system-key',
        name: 'system',
        token: SYSTEM_KEY,
        enabled: true,
        accessType: 'all',
        kind: 'system',
      },
    ],
    systemConfig: {
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        skipAuth: false,
      },
    },
  };
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH!, JSON.stringify(settings));
  fs.rmSync(`${process.env.MCPHUB_SETTING_PATH}.passkeys.json`, { force: true });
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());
};

const passwordLogin = async (username: string, password: string): Promise<string> => {
  const response = await request(app)
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .send({ username, password });
  expect(response.status).toBe(200);
  return response.body.token;
};

const registerPasskey = async (token: string, password: string, name = 'Laptop') => {
  const authenticator = new SoftwareAuthenticator(ORIGIN);
  const options = await request(app)
    .post('/api/auth/passkeys/registration/options')
    .set('Origin', ORIGIN)
    .set('x-auth-token', token)
    .send({ currentPassword: password });
  expect(options.status).toBe(200);
  const created = await request(app)
    .post('/api/auth/passkeys')
    .set('Origin', ORIGIN)
    .set('x-auth-token', token)
    .send({
      challengeToken: options.body.challengeToken,
      response: authenticator.register(options.body.options),
      name,
    });
  expect(created.status).toBe(201);
  return { authenticator, passkey: created.body.data };
};

const loginOptions = async (origin = ORIGIN) => {
  const response = await request(app).post('/api/auth/passkey/options').set('Origin', origin);
  expect(response.status).toBe(200);
  return response.body as { options: { challenge: string; rpId: string }; challengeToken: string };
};

const passkeyLogin = (challengeToken: string, response: unknown) =>
  request(app)
    .post('/api/auth/passkey/login')
    .set('Origin', ORIGIN)
    .send({ challengeToken, response });

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-passkeys-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  resetForwardAuthStateForTests();

  app = express();
  app.use(express.json());
  // Controllers read translations from the i18n middleware.
  app.use((req, _res, next) => {
    (req as express.Request & { t?: (key: string) => string }).t = (key) => key;
    next();
  });
  app.post('/api/auth/login', login);
  app.post('/api/auth/passkey/options', createPasskeyLoginOptions);
  app.post('/api/auth/passkey/login', loginWithPasskey);
  app.get('/api/auth/passkeys', auth, listMyPasskeys);
  app.post('/api/auth/passkeys/registration/options', auth, createPasskeyRegistrationOptions);
  app.post('/api/auth/passkeys', auth, registerMyPasskey);
  app.delete('/api/auth/passkeys/:id', auth, deleteMyPasskey);
});

beforeEach(async () => {
  jest.restoreAllMocks();
  await writeSettings();
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  if (originalEnv.path === undefined) delete process.env.MCPHUB_SETTING_PATH;
  else process.env.MCPHUB_SETTING_PATH = originalEnv.path;
  if (originalEnv.useDb === undefined) delete process.env.USE_DB;
  else process.env.USE_DB = originalEnv.useDb;
});

describe('passkey sign-in', () => {
  it('registers a passkey after re-authentication and signs in with it', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator, passkey } = await registerPasskey(token, 'alice-pass-1!');
    expect(passkey).toEqual({
      id: expect.any(String),
      name: 'Laptop',
      rpId: 'hub.example.test',
      createdAt: expect.any(String),
      lastUsedAt: null,
      deviceType: 'singleDevice',
      backedUp: false,
    });

    // The listing never exposes credential material
    const list = await request(app).get('/api/auth/passkeys').set('x-auth-token', token);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ success: true, data: [passkey], registrationAvailable: true });

    const { options, challengeToken } = await loginOptions();
    expect(options.rpId).toBe('hub.example.test');
    const signedIn = await passkeyLogin(challengeToken, authenticator.authenticate(options));
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user).toMatchObject({ username: 'alice', isAdmin: false });
    expect((await resolveJwtUser(signedIn.body.token))?.username).toBe('alice');

    const stored = await getPasskeyDao().findById(passkey.id);
    expect(stored?.counter).toBe(1);
    expect(stored?.lastUsedAt).toEqual(expect.any(String));
  });

  it('requires the current password before issuing a registration challenge', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const response = await request(app)
      .post('/api/auth/passkeys/registration/options')
      .set('Origin', ORIGIN)
      .set('x-auth-token', token)
      .send({ currentPassword: 'wrong-password' });
    // Not 401: the dashboard would drop the still-valid session
    expect(response.status).toBe(400);
    expect(response.body.challengeToken).toBeUndefined();
  });

  it('accepts each challenge once', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator } = await registerPasskey(token, 'alice-pass-1!');
    const { options, challengeToken } = await loginOptions();
    // Synced passkeys report a zero counter, so only the spent challenge stops a replay
    const assertion = authenticator.authenticate(options, { counter: 0 });
    expect((await passkeyLogin(challengeToken, assertion)).status).toBe(200);
    expect((await passkeyLogin(challengeToken, assertion)).status).toBe(401);
  });

  it('rejects assertions made for another origin or with a cloned counter', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator } = await registerPasskey(token, 'alice-pass-1!');

    let ceremony = await loginOptions();
    const phished = authenticator.authenticate(ceremony.options, {
      origin: 'https://hub.example.test.evil.example',
    });
    expect((await passkeyLogin(ceremony.challengeToken, phished)).status).toBe(401);

    ceremony = await loginOptions();
    expect(
      (await passkeyLogin(ceremony.challengeToken, authenticator.authenticate(ceremony.options)))
        .status,
    ).toBe(200);
    // A copy of the key still at an older signature counter
    ceremony = await loginOptions();
    const cloned = authenticator.authenticate(ceremony.options, { counter: 1 });
    expect((await passkeyLogin(ceremony.challengeToken, cloned)).status).toBe(401);
  });

  it('never moves the counter backwards when sign-ins finish out of order', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator, passkey } = await registerPasskey(token, 'alice-pass-1!');
    let ceremony = await loginOptions();
    expect(
      (
        await passkeyLogin(
          ceremony.challengeToken,
          authenticator.authenticate(ceremony.options, { counter: 10 }),
        )
      ).status,
    ).toBe(200);
    // Both sign-ins read counter 10 before either stored its own
    const snapshot = await getPasskeyDao().findById(passkey.id);
    expect(snapshot?.counter).toBe(10);

    ceremony = await loginOptions();
    const first = authenticator.authenticate(ceremony.options, { counter: 12 });
    expect((await passkeyLogin(ceremony.challengeToken, first)).status).toBe(200);

    ceremony = await loginOptions();
    jest.spyOn(PasskeyDaoImpl.prototype, 'findByCredentialId').mockResolvedValueOnce(snapshot);
    const second = authenticator.authenticate(ceremony.options, { counter: 11 });
    // 11 passes the check against the stale 10, but must not overwrite 12
    expect((await passkeyLogin(ceremony.challengeToken, second)).status).toBe(401);
    expect((await getPasskeyDao().findById(passkey.id))?.counter).toBe(12);
  });

  it('does not accept a credential under a host other than the one it was created for', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator } = await registerPasskey(token, 'alice-pass-1!');
    const { options, challengeToken } = await loginOptions('https://other.example.test');
    expect(options.rpId).toBe('other.example.test');
    const response = await passkeyLogin(
      challengeToken,
      authenticator.authenticate(options, { origin: 'https://other.example.test' }),
    );
    expect(response.status).toBe(401);
  });

  it('binds a registration challenge to the user who requested it', async () => {
    const aliceToken = await passwordLogin('alice', 'alice-pass-1!');
    const bobToken = await passwordLogin('bob', 'bob-pass-1!');
    const options = await request(app)
      .post('/api/auth/passkeys/registration/options')
      .set('Origin', ORIGIN)
      .set('x-auth-token', aliceToken)
      .send({ currentPassword: 'alice-pass-1!' });
    const response = await request(app)
      .post('/api/auth/passkeys')
      .set('Origin', ORIGIN)
      .set('x-auth-token', bobToken)
      .send({
        challengeToken: options.body.challengeToken,
        response: new SoftwareAuthenticator(ORIGIN).register(options.body.options),
      });
    expect(response.status).toBe(400);
    expect(await getPasskeyDao().findByUsername('bob')).toEqual([]);
  });

  it('lets users remove only their own passkeys', async () => {
    const aliceToken = await passwordLogin('alice', 'alice-pass-1!');
    const bobToken = await passwordLogin('bob', 'bob-pass-1!');
    const { authenticator, passkey } = await registerPasskey(aliceToken, 'alice-pass-1!');

    expect(
      (await request(app).delete(`/api/auth/passkeys/${passkey.id}`).set('x-auth-token', bobToken))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/api/auth/passkeys/${passkey.id}`)
          .set('x-auth-token', aliceToken)
      ).status,
    ).toBe(200);

    const { options, challengeToken } = await loginOptions();
    expect((await passkeyLogin(challengeToken, authenticator.authenticate(options))).status).toBe(
      401,
    );
  });

  it('refuses passkey management through a bearer key', async () => {
    const response = await request(app)
      .post('/api/auth/passkeys/registration/options')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${SYSTEM_KEY}`)
      .send({ currentPassword: 'admin-pass-1!' });
    expect(response.status).toBe(403);
  });

  it('removes passkeys with their user so a recreated account cannot inherit them', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator } = await registerPasskey(token, 'alice-pass-1!');
    expect(await deleteUser('alice')).toBe(true);
    expect(await getPasskeyDao().findByUsername('alice')).toEqual([]);

    const { options, challengeToken } = await loginOptions();
    expect((await passkeyLogin(challengeToken, authenticator.authenticate(options))).status).toBe(
      401,
    );
  });

  it('revokes passkeys when the password changes, like other sessions', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator } = await registerPasskey(token, 'alice-pass-1!');
    // For example an administrator resetting a compromised account
    expect(await updateUserPassword('alice', 'alice-pass-2!')).toBe(true);

    const { options, challengeToken } = await loginOptions();
    expect((await passkeyLogin(challengeToken, authenticator.authenticate(options))).status).toBe(
      401,
    );
    const newToken = await passwordLogin('alice', 'alice-pass-2!');
    const list = await request(app).get('/api/auth/passkeys').set('x-auth-token', newToken);
    expect(list.body.data).toEqual([]);
    expect(await getPasskeyDao().findByUsername('alice')).toEqual([]);
  });

  it('never lets a recreated account inherit a leftover passkey', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator, passkey } = await registerPasskey(token, 'alice-pass-1!');
    const leftover = await getPasskeyDao().findById(passkey.id);
    expect(await deleteUser('alice')).toBe(true);
    // A row written back by a racing request, or kept by a hand-edited settings file
    await getPasskeyDao().save(leftover!);
    expect(await createUser({ username: 'alice', password: 'new-owner-pass-1!' })).not.toBeNull();

    const { options, challengeToken } = await loginOptions();
    expect((await passkeyLogin(challengeToken, authenticator.authenticate(options))).status).toBe(
      401,
    );
  });

  it('shows the dashboard a code that identifies a rejected passkey', async () => {
    const { options, challengeToken } = await loginOptions();
    const unknown = new SoftwareAuthenticator(ORIGIN);
    unknown.register({ challenge: 'unused', rp: { id: options.rpId }, user: { id: 'aGFuZGxl' } });
    const response = await passkeyLogin(challengeToken, unknown.authenticate(options));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, code: 'passkey_login_failed' });
  });

  it('follows the SSO-only policy that disables password sign-in', async () => {
    const token = await passwordLogin('alice', 'alice-pass-1!');
    const { authenticator } = await registerPasskey(token, 'alice-pass-1!');
    const { options, challengeToken } = await loginOptions();

    const actual = await betterAuthConfig.getBetterAuthRuntimeConfig();
    jest
      .spyOn(betterAuthConfig, 'getBetterAuthRuntimeConfig')
      .mockResolvedValue({ ...actual, disablePasswordLogin: true });

    expect(
      (await request(app).post('/api/auth/passkey/options').set('Origin', ORIGIN)).status,
    ).toBe(403);
    expect((await passkeyLogin(challengeToken, authenticator.authenticate(options))).status).toBe(
      403,
    );
    const list = await request(app).get('/api/auth/passkeys').set('x-auth-token', token);
    expect(list.body.registrationAvailable).toBe(false);
  });
});
