import type { Request, Response } from 'express';
import { jest } from '@jest/globals';
import type { IUser, UserPasskey } from '../../src/types/index.js';

const getRuntimeConfigMock = jest.fn<() => Promise<{ disablePasswordLogin: boolean }>>();
const findUserByUsernameMock = jest.fn<(username: string) => Promise<IUser | undefined>>();
const verifyPasswordMock = jest.fn<(plain: string, hash: string) => Promise<boolean>>();
const isForwardAuthUserMock = jest.fn<(user: IUser) => boolean>();
const listActivePasskeysMock = jest.fn<(user: IUser) => Promise<UserPasskey[]>>();
const startRegistrationMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const finishRegistrationMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const startAuthenticationMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const finishAuthenticationMock = jest.fn<(...args: unknown[]) => Promise<IUser | null>>();
const findByIdMock = jest.fn<(id: string) => Promise<UserPasskey | null>>();
const deleteMock = jest.fn<(id: string) => Promise<void>>();

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: getRuntimeConfigMock,
}));
jest.mock('../../src/models/User.js', () => ({
  findUserByUsername: findUserByUsernameMock,
  verifyPassword: verifyPasswordMock,
}));
jest.mock('../../src/services/forwardAuthService.js', () => ({
  isForwardAuthUser: isForwardAuthUserMock,
}));
jest.mock('../../src/services/passkeyService.js', () => {
  const actual = jest.requireActual<typeof import('../../src/services/passkeyService.js')>(
    '../../src/services/passkeyService.js',
  );
  return {
    normalizePasskeyName: actual.normalizePasskeyName,
    resolveRelyingParty: actual.resolveRelyingParty,
    toPasskeySummary: actual.toPasskeySummary,
    listActivePasskeys: listActivePasskeysMock,
    startPasskeyRegistration: startRegistrationMock,
    finishPasskeyRegistration: finishRegistrationMock,
    startPasskeyAuthentication: startAuthenticationMock,
    finishPasskeyAuthentication: finishAuthenticationMock,
  };
});
jest.mock('../../src/dao/index.js', () => ({
  getPasskeyDao: () => ({ findById: findByIdMock, delete: deleteMock }),
}));
jest.mock('../../src/services/services.js', () => ({
  getDataService: () => ({ getPermissions: () => ['servers:read'] }),
}));
jest.mock('../../src/utils/userSession.js', () => ({
  signDashboardToken: (user: IUser) => `token-for-${user.username}`,
}));

import {
  createPasskeyLoginOptions,
  createPasskeyRegistrationOptions,
  deleteMyPasskey,
  listMyPasskeys,
  loginWithPasskey,
  registerMyPasskey,
} from '../../src/controllers/passkeyController.js';

const ORIGIN = 'https://hub.example.test';
const PASSKEY_ID = '4f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const alice: IUser = { username: 'alice', password: 'stored-hash', isAdmin: false };

const passkey = (overrides: Partial<UserPasskey> = {}): UserPasskey => ({
  id: PASSKEY_ID,
  username: 'alice',
  credentialId: 'credential',
  publicKey: 'public-key',
  counter: 0,
  userHandle: 'handle',
  rpId: 'hub.example.test',
  sessionVersion: 'version',
  name: 'Laptop',
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: '2026-11-17T00:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

const credentialResponse = {
  id: 'credential',
  rawId: 'credential',
  type: 'public-key',
  response: { clientDataJSON: 'data' },
};

interface MockRequest {
  body?: unknown;
  params?: Record<string, string>;
  user?: { username?: string; credentialEligible?: boolean };
  bearerKey?: unknown;
  forwardAuthUser?: unknown;
  headers?: Record<string, string>;
  translate?: boolean;
}

const call = async (
  handler: (req: Request, res: Response) => Promise<void>,
  options: MockRequest = {},
) => {
  const {
    body,
    params = {},
    bearerKey,
    forwardAuthUser,
    headers = { origin: ORIGIN },
    translate = true,
  } = options;
  // An explicit `user: undefined` means no signed-in user
  const user = 'user' in options ? options.user : { username: 'alice' };
  const req = {
    body,
    params,
    user,
    bearerKey,
    forwardAuthUser,
    protocol: 'https',
    get: (name: string) => headers[name.toLowerCase()],
    ...(translate ? { t: (key: string) => `translated:${key}` } : {}),
  } as unknown as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  await handler(req, res as unknown as Response);
  return res as { statusCode: number; body: Record<string, unknown> };
};

const expectFailure = (
  res: { statusCode: number; body: Record<string, unknown> },
  status: number,
  code: string,
) => {
  expect(res.statusCode).toBe(status);
  expect(res.body).toEqual({
    success: false,
    code,
    message: `translated:api.errors.${code}`,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  getRuntimeConfigMock.mockResolvedValue({ disablePasswordLogin: false });
  findUserByUsernameMock.mockResolvedValue(alice);
  verifyPasswordMock.mockResolvedValue(true);
  isForwardAuthUserMock.mockReturnValue(false);
  listActivePasskeysMock.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('passkey management session checks', () => {
  it.each([
    ['no signed-in user', { user: undefined }],
    ['a session without a username', { user: {} }],
    ['a bearer key', { bearerKey: { id: 'key' } }],
    ['a forward-auth identity', { forwardAuthUser: { username: 'alice' } }],
    ['the skip-auth guest', { user: { username: 'guest', credentialEligible: false } }],
  ])('refuses %s', async (_label, request) => {
    expectFailure(await call(listMyPasskeys, request as MockRequest), 403, 'passkey_unavailable');
    expect(findUserByUsernameMock).not.toHaveBeenCalled();
  });

  it('refuses a session whose account no longer exists', async () => {
    findUserByUsernameMock.mockResolvedValue(undefined);
    expectFailure(await call(listMyPasskeys), 403, 'passkey_unavailable');
  });

  it('refuses a stored account bound to a forward-auth identity', async () => {
    isForwardAuthUserMock.mockReturnValue(true);
    expectFailure(await call(listMyPasskeys), 403, 'passkey_unavailable');
  });

  it('falls back to the message key without the i18n middleware', async () => {
    const res = await call(listMyPasskeys, { user: undefined, translate: false });
    expect(res.body.message).toBe('api.errors.passkey_unavailable');
  });
});

describe('listMyPasskeys', () => {
  it('lists summaries and whether new passkeys can be added', async () => {
    listActivePasskeysMock.mockResolvedValue([passkey()]);
    getRuntimeConfigMock.mockResolvedValue({ disablePasswordLogin: true });
    const res = await call(listMyPasskeys);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [
        {
          id: PASSKEY_ID,
          name: 'Laptop',
          rpId: 'hub.example.test',
          createdAt: '2026-11-17T00:00:00.000Z',
          lastUsedAt: null,
          deviceType: 'multiDevice',
          backedUp: true,
        },
      ],
      registrationAvailable: false,
    });
  });

  it('answers 500 when the store fails', async () => {
    listActivePasskeysMock.mockRejectedValue(new Error('store down'));
    expectFailure(await call(listMyPasskeys), 500, 'internalServerError');
  });
});

describe('createPasskeyRegistrationOptions', () => {
  const request = (body: unknown, extra: MockRequest = {}) => ({ body, ...extra });

  it('follows the SSO-only policy before anything else', async () => {
    getRuntimeConfigMock.mockResolvedValue({ disablePasswordLogin: true });
    expectFailure(
      await call(createPasskeyRegistrationOptions, request({ currentPassword: 'secret' })),
      403,
      'password_login_disabled',
    );
    expect(findUserByUsernameMock).not.toHaveBeenCalled();
  });

  it('refuses a non-personal session', async () => {
    expectFailure(
      await call(
        createPasskeyRegistrationOptions,
        request({ currentPassword: 'x' }, { bearerKey: {} }),
      ),
      403,
      'passkey_unavailable',
    );
  });

  it.each([
    ['no body', undefined],
    ['no password', {}],
    ['an empty password', { currentPassword: '' }],
    ['a non-string password', { currentPassword: 42 }],
  ])('answers 400 (never 401) for %s', async (_label, body) => {
    expectFailure(
      await call(createPasskeyRegistrationOptions, request(body)),
      400,
      'passkey_password_invalid',
    );
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it('answers 400 for an account without a stored password', async () => {
    findUserByUsernameMock.mockResolvedValue({ ...alice, password: '' });
    expectFailure(
      await call(createPasskeyRegistrationOptions, request({ currentPassword: 'secret' })),
      400,
      'passkey_password_invalid',
    );
  });

  it('answers 400 for a wrong password', async () => {
    verifyPasswordMock.mockResolvedValue(false);
    expectFailure(
      await call(createPasskeyRegistrationOptions, request({ currentPassword: 'wrong' })),
      400,
      'passkey_password_invalid',
    );
    expect(verifyPasswordMock).toHaveBeenCalledWith('wrong', 'stored-hash');
    expect(startRegistrationMock).not.toHaveBeenCalled();
  });

  it('answers 400 when the site address cannot be determined', async () => {
    expectFailure(
      await call(
        createPasskeyRegistrationOptions,
        request({ currentPassword: 'secret' }, { headers: {} }),
      ),
      400,
      'passkey_origin_invalid',
    );
  });

  it('answers 400 once the account holds the maximum number of passkeys', async () => {
    startRegistrationMock.mockResolvedValue({ status: 'limit' });
    expectFailure(
      await call(createPasskeyRegistrationOptions, request({ currentPassword: 'secret' })),
      400,
      'passkey_limit_reached',
    );
  });

  it('returns the options and challenge for the request origin', async () => {
    startRegistrationMock.mockResolvedValue({
      status: 'ok',
      options: { challenge: 'abc' },
      challengeToken: 'challenge-token',
    });
    const res = await call(
      createPasskeyRegistrationOptions,
      request({ currentPassword: 'secret' }),
    );
    expect(res.body).toEqual({
      success: true,
      options: { challenge: 'abc' },
      challengeToken: 'challenge-token',
    });
    expect(startRegistrationMock).toHaveBeenCalledWith(alice, {
      rpId: 'hub.example.test',
      origin: ORIGIN,
    });
  });

  it('answers 500 when starting the ceremony fails', async () => {
    startRegistrationMock.mockRejectedValue(new Error('boom'));
    expectFailure(
      await call(createPasskeyRegistrationOptions, request({ currentPassword: 'secret' })),
      500,
      'internalServerError',
    );
  });
});

describe('registerMyPasskey', () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    challengeToken: 'challenge-token',
    response: credentialResponse,
    name: '  Work\nlaptop ',
    ...overrides,
  });

  it('follows the SSO-only policy', async () => {
    getRuntimeConfigMock.mockResolvedValue({ disablePasswordLogin: true });
    expectFailure(await call(registerMyPasskey, { body: body() }), 403, 'password_login_disabled');
  });

  it('refuses a non-personal session', async () => {
    expectFailure(
      await call(registerMyPasskey, { body: body(), forwardAuthUser: {} }),
      403,
      'passkey_unavailable',
    );
  });

  it.each([
    ['no body', undefined],
    ['no response', body({ response: undefined })],
    ['a non-object response', body({ response: 'credential' })],
    ['a missing id', body({ response: { ...credentialResponse, id: 1 } })],
    ['a missing rawId', body({ response: { ...credentialResponse, rawId: undefined } })],
    ['another credential type', body({ response: { ...credentialResponse, type: 'password' } })],
    [
      'a missing authenticator response',
      body({ response: { ...credentialResponse, response: null } }),
    ],
    [
      'a non-object authenticator response',
      body({ response: { ...credentialResponse, response: 'x' } }),
    ],
  ])('answers 400 for %s', async (_label, requestBody) => {
    expectFailure(
      await call(registerMyPasskey, { body: requestBody }),
      400,
      'passkey_invalid_request',
    );
    expect(finishRegistrationMock).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_challenge', 400, 'passkey_challenge_invalid'],
    ['duplicate', 409, 'passkey_already_registered'],
    ['limit', 400, 'passkey_limit_reached'],
    ['failed', 400, 'passkey_verification_failed'],
  ])('maps a %s result', async (status, httpStatus, code) => {
    finishRegistrationMock.mockResolvedValue({ status });
    expectFailure(await call(registerMyPasskey, { body: body() }), httpStatus, code);
  });

  it('stores the passkey under a normalized name', async () => {
    finishRegistrationMock.mockResolvedValue({
      status: 'ok',
      passkey: passkey({ name: 'Worklaptop' }),
    });
    const res = await call(registerMyPasskey, { body: body() });
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { id: PASSKEY_ID, name: 'Worklaptop' } });
    expect(finishRegistrationMock).toHaveBeenCalledWith(
      alice,
      'challenge-token',
      credentialResponse,
      'Worklaptop',
    );
  });

  it('answers 500 when storing fails', async () => {
    finishRegistrationMock.mockRejectedValue(new Error('disk full'));
    expectFailure(await call(registerMyPasskey, { body: body() }), 500, 'internalServerError');
  });
});

describe('deleteMyPasskey', () => {
  it('refuses a non-personal session', async () => {
    expectFailure(
      await call(deleteMyPasskey, { params: { id: PASSKEY_ID }, bearerKey: {} }),
      403,
      'passkey_unavailable',
    );
  });

  it('answers 404 without a lookup for an id that is not a UUID', async () => {
    expectFailure(
      await call(deleteMyPasskey, { params: { id: '../passkeys' } }),
      404,
      'passkey_not_found',
    );
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown passkey', async () => {
    findByIdMock.mockResolvedValue(null);
    expectFailure(
      await call(deleteMyPasskey, { params: { id: PASSKEY_ID } }),
      404,
      'passkey_not_found',
    );
  });

  it("answers 404 for another user's passkey and keeps it", async () => {
    findByIdMock.mockResolvedValue(passkey({ username: 'bob' }));
    expectFailure(
      await call(deleteMyPasskey, { params: { id: PASSKEY_ID } }),
      404,
      'passkey_not_found',
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('removes the caller’s passkey', async () => {
    findByIdMock.mockResolvedValue(passkey());
    const res = await call(deleteMyPasskey, { params: { id: PASSKEY_ID.toUpperCase() } });
    expect(res.body).toEqual({ success: true });
    expect(deleteMock).toHaveBeenCalledWith(PASSKEY_ID);
  });

  it('answers 500 when the store fails', async () => {
    findByIdMock.mockRejectedValue(new Error('store down'));
    expectFailure(
      await call(deleteMyPasskey, { params: { id: PASSKEY_ID } }),
      500,
      'internalServerError',
    );
  });
});

describe('createPasskeyLoginOptions', () => {
  it('follows the SSO-only policy', async () => {
    getRuntimeConfigMock.mockResolvedValue({ disablePasswordLogin: true });
    expectFailure(await call(createPasskeyLoginOptions), 403, 'password_login_disabled');
    expect(startAuthenticationMock).not.toHaveBeenCalled();
  });

  it('answers 400 for an opaque origin without a host', async () => {
    expectFailure(
      await call(createPasskeyLoginOptions, { headers: { origin: 'null' } }),
      400,
      'passkey_origin_invalid',
    );
  });

  it('issues a challenge for the request origin', async () => {
    startAuthenticationMock.mockResolvedValue({
      options: { challenge: 'abc' },
      challengeToken: 't',
    });
    const res = await call(createPasskeyLoginOptions, { user: undefined });
    expect(res.body).toEqual({ success: true, options: { challenge: 'abc' }, challengeToken: 't' });
    expect(startAuthenticationMock).toHaveBeenCalledWith({
      rpId: 'hub.example.test',
      origin: ORIGIN,
    });
  });

  it('answers 500 when issuing fails', async () => {
    startAuthenticationMock.mockRejectedValue(new Error('boom'));
    expectFailure(await call(createPasskeyLoginOptions), 500, 'internalServerError');
  });
});

describe('loginWithPasskey', () => {
  const body = { challengeToken: 'challenge-token', response: credentialResponse };

  it('follows the SSO-only policy', async () => {
    getRuntimeConfigMock.mockResolvedValue({ disablePasswordLogin: true });
    expectFailure(await call(loginWithPasskey, { body }), 403, 'password_login_disabled');
    expect(finishAuthenticationMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a malformed assertion', async () => {
    expectFailure(
      await call(loginWithPasskey, { body: { challengeToken: 't', response: { id: 'x' } } }),
      400,
      'passkey_invalid_request',
    );
  });

  it('answers 401 with a stable code for a rejected passkey', async () => {
    finishAuthenticationMock.mockResolvedValue(null);
    expectFailure(await call(loginWithPasskey, { body }), 401, 'passkey_login_failed');
  });

  it('issues a dashboard session for the passkey owner', async () => {
    finishAuthenticationMock.mockResolvedValue({ ...alice, isAdmin: true });
    const res = await call(loginWithPasskey, { body, user: undefined });
    expect(res.body).toEqual({
      success: true,
      token: 'token-for-alice',
      user: { username: 'alice', isAdmin: true, permissions: ['servers:read'] },
    });
    expect(finishAuthenticationMock).toHaveBeenCalledWith('challenge-token', credentialResponse);
  });

  it('answers 500 when verification fails unexpectedly', async () => {
    finishAuthenticationMock.mockRejectedValue(new Error('boom'));
    expectFailure(await call(loginWithPasskey, { body }), 500, 'internalServerError');
  });
});
