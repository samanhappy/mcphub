import crypto from 'node:crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import type { IUser, UserPasskey } from '../../src/types/index.js';

const mockDao = {
  findByUsername: jest.fn<(username: string) => Promise<UserPasskey[]>>(),
  findByCredentialId: jest.fn<(credentialId: string) => Promise<UserPasskey | null>>(),
  save: jest.fn<(passkey: UserPasskey) => Promise<void>>(),
  recordUse: jest.fn<(id: string, use: unknown) => Promise<boolean>>(),
  delete: jest.fn<(id: string) => Promise<void>>(),
};
const findUserByUsernameMock = jest.fn<(username: string) => Promise<IUser | undefined>>();
const isForwardAuthUserMock = jest.fn<(user: IUser) => boolean>();
const verifyRegistrationMock = jest.fn<(options: unknown) => Promise<unknown>>();
const verifyAuthenticationMock = jest.fn<(options: unknown) => Promise<unknown>>();

// Replica-shared spent challenges: a primary key on the hashed challenge.
const mockSpent = new Set<string>();
const mockStates = {
  delete: jest.fn(async () => ({ affected: 0 })),
  insert: jest.fn(async (row: { tokenHash: string }) => {
    if (mockSpent.has(row.tokenHash)) throw new Error('duplicate key value');
    mockSpent.add(row.tokenHash);
  }),
};

jest.mock('../../src/dao/index.js', () => ({
  getPasskeyDao: () => mockDao,
  getUserDao: () => ({ findByUsername: async () => null }),
}));
jest.mock('../../src/models/User.js', () => ({ findUserByUsername: findUserByUsernameMock }));
jest.mock('../../src/services/forwardAuthService.js', () => ({
  isForwardAuthUser: isForwardAuthUserMock,
}));
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => ({ getRepository: () => mockStates }),
}));
jest.mock('@simplewebauthn/server', () => {
  const actual =
    jest.requireActual<typeof import('@simplewebauthn/server')>('@simplewebauthn/server');
  return {
    ...actual,
    verifyRegistrationResponse: verifyRegistrationMock,
    verifyAuthenticationResponse: verifyAuthenticationMock,
  };
});

import {
  consumeChallengeToken,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listActivePasskeys,
  MAX_PASSKEYS_PER_USER,
  normalizePasskeyName,
  resolveRelyingParty,
  startPasskeyAuthentication,
  startPasskeyRegistration,
} from '../../src/services/passkeyService.js';
import {
  getUserSessionVersion,
  resolveJwtUser,
  signDashboardToken,
} from '../../src/utils/userSession.js';

const rp = { rpId: 'hub.example.test', origin: 'https://hub.example.test' };
const alice: IUser = { username: 'alice', password: 'alice-hash' };
const aliceVersion = getUserSessionVersion(alice);

const passkey = (overrides: Partial<UserPasskey> = {}): UserPasskey => ({
  id: crypto.randomUUID(),
  username: 'alice',
  credentialId: 'credential',
  publicKey: 'AQID',
  counter: 0,
  transports: ['internal'],
  userHandle: 'alice-handle',
  rpId: rp.rpId,
  sessionVersion: aliceVersion,
  name: 'Laptop',
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: '2026-11-17T00:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

const registrationResponse = { id: 'credential', rawId: 'credential' } as never;
const assertion = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'credential',
    rawId: 'credential',
    type: 'public-key',
    response: { userHandle: 'alice-handle' },
    ...overrides,
  }) as never;

const verifiedRegistration = {
  verified: true,
  registrationInfo: {
    credential: {
      id: 'credential',
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      transports: ['internal'],
    },
    credentialDeviceType: 'singleDevice',
    credentialBackedUp: false,
  },
};

const verifiedAssertion = {
  verified: true,
  authenticationInfo: { newCounter: 5, credentialBackedUp: true },
};

const requestWith = (headers: Record<string, string>, protocol = 'http'): Request =>
  ({
    protocol,
    get: (name: string) => headers[name.toLowerCase()],
  }) as unknown as Request;

/** Signs a token the way the service does, to probe claim validation. */
const signChallenge = (claims: Record<string, unknown>) =>
  jwt.sign(
    claims,
    crypto
      .createHmac('sha256', process.env.JWT_SECRET!)
      .update('mcphub:passkey-challenge')
      .digest(),
    { algorithm: 'HS256', audience: 'mcphub:passkey', expiresIn: 300 },
  );

const registrationToken = async (user: IUser = alice) => {
  mockDao.findByUsername.mockResolvedValueOnce([]);
  const result = await startPasskeyRegistration(user, rp);
  if (result.status !== 'ok') throw new Error('expected options');
  return result.challengeToken;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDao.findByUsername.mockResolvedValue([]);
  mockDao.findByCredentialId.mockResolvedValue(null);
  mockDao.save.mockResolvedValue(undefined);
  mockDao.recordUse.mockResolvedValue(true);
  mockDao.delete.mockResolvedValue(undefined);
  findUserByUsernameMock.mockResolvedValue(alice);
  isForwardAuthUserMock.mockReturnValue(false);
  verifyRegistrationMock.mockResolvedValue(verifiedRegistration);
  verifyAuthenticationMock.mockResolvedValue(verifiedAssertion);
});

describe('resolveRelyingParty', () => {
  it('uses the browser origin, including a dev server port', () => {
    expect(
      resolveRelyingParty(requestWith({ origin: 'http://localhost:5173', host: 'localhost:3000' })),
    ).toEqual({ rpId: 'localhost', origin: 'http://localhost:5173' });
  });

  it('falls back to the forwarded protocol and host without an Origin header', () => {
    expect(resolveRelyingParty(requestWith({ host: 'hub.example.test' }, 'https'))).toEqual(rp);
  });

  it('rejects opaque, malformed or non-web origins', () => {
    expect(resolveRelyingParty(requestWith({ origin: 'null' }))).toBeNull();
    expect(resolveRelyingParty(requestWith({ origin: 'file:///tmp/page.html' }))).toBeNull();
    expect(resolveRelyingParty(requestWith({ origin: 'not a url' }))).toBeNull();
    expect(resolveRelyingParty(requestWith({}))).toBeNull();
  });
});

describe('normalizePasskeyName', () => {
  it('trims, strips control characters and caps the length', () => {
    expect(normalizePasskeyName('  Work\u0000 laptop\n ')).toBe('Work laptop');
    expect(normalizePasskeyName('é'.repeat(80))).toHaveLength(64);
    expect(normalizePasskeyName(42)).toBe('');
  });
});

describe('consumeChallengeToken', () => {
  it('keeps challenge tokens and dashboard session tokens apart', async () => {
    const { challengeToken } = await startPasskeyAuthentication(rp);
    expect(await resolveJwtUser(challengeToken)).toBeNull();
    const sessionToken = signDashboardToken({ username: 'alice', password: 'hash' });
    expect(await consumeChallengeToken(sessionToken, 'authentication')).toBeNull();
    expect(await consumeChallengeToken('not-a-token', 'registration')).toBeNull();
    expect(await consumeChallengeToken(undefined, 'registration')).toBeNull();
  });

  it('accepts a challenge once, and only for the ceremony it was issued for', async () => {
    const { options, challengeToken } = await startPasskeyAuthentication(rp);
    expect(await consumeChallengeToken(challengeToken, 'registration')).toBeNull();
    expect(await consumeChallengeToken(challengeToken, 'authentication')).toMatchObject({
      ...rp,
      challenge: options.challenge,
    });
    expect(await consumeChallengeToken(challengeToken, 'authentication')).toBeNull();
  });

  it('rejects a correctly signed token that lacks the relying-party claims', async () => {
    const base = { ceremony: 'authentication', challenge: 'c', ...rp };
    expect(
      await consumeChallengeToken(signChallenge({ ...base, challenge: 1 }), 'authentication'),
    ).toBeNull();
    expect(
      await consumeChallengeToken(signChallenge({ ...base, rpId: undefined }), 'authentication'),
    ).toBeNull();
    expect(
      await consumeChallengeToken(signChallenge({ ...base, origin: null }), 'authentication'),
    ).toBeNull();
  });

  describe('in replica mode', () => {
    const oldMode = process.env.MCPHUB_REPLICA_MODE;
    beforeEach(() => {
      process.env.MCPHUB_REPLICA_MODE = 'true';
      mockSpent.clear();
    });
    afterEach(() => {
      if (oldMode === undefined) delete process.env.MCPHUB_REPLICA_MODE;
      else process.env.MCPHUB_REPLICA_MODE = oldMode;
    });

    it('records the spent challenge in shared state, hashed, and refuses it again', async () => {
      const { options, challengeToken } = await startPasskeyAuthentication(rp);
      expect(await consumeChallengeToken(challengeToken, 'authentication')).toMatchObject(rp);
      expect(await consumeChallengeToken(challengeToken, 'authentication')).toBeNull();

      const row = mockStates.insert.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(row).toMatchObject({ kind: 'passkey_challenge', payload: {} });
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(options.challenge);
      // Expired rows of this kind are swept on the way in
      expect(mockStates.delete).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'passkey_challenge' }),
      );
    });
  });
});

describe('listActivePasskeys', () => {
  it('keeps passkeys of the current password and removes outdated ones', async () => {
    const current = passkey();
    const beforePasswordChange = passkey({ sessionVersion: 'old-version' });
    const legacy = passkey({ sessionVersion: '' });
    mockDao.findByUsername.mockResolvedValue([current, beforePasswordChange, legacy]);
    expect(await listActivePasskeys(alice)).toEqual([current]);
    expect(mockDao.delete.mock.calls.map(([id]) => id)).toEqual([
      beforePasswordChange.id,
      legacy.id,
    ]);
  });
});

describe('startPasskeyRegistration', () => {
  it('stops at the per-account limit', async () => {
    mockDao.findByUsername.mockResolvedValue(
      Array.from({ length: MAX_PASSKEYS_PER_USER }, () => passkey()),
    );
    expect(await startPasskeyRegistration(alice, rp)).toEqual({ status: 'limit' });
  });

  it('reuses the account user handle and excludes passkeys of the same site only', async () => {
    mockDao.findByUsername.mockResolvedValue([
      passkey({ credentialId: 'here', transports: null }),
      passkey({ credentialId: 'elsewhere', rpId: 'other.example.test' }),
    ]);
    const result = await startPasskeyRegistration(alice, rp);
    if (result.status !== 'ok') throw new Error('expected options');
    expect(result.options.user.id).toBe('alice-handle');
    expect(result.options.excludeCredentials).toEqual([
      expect.objectContaining({ id: 'here', transports: undefined }),
    ]);
    expect(result.options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
  });
});

describe('finishPasskeyRegistration', () => {
  it('refuses a challenge issued to another user', async () => {
    const token = await registrationToken({ username: 'bob', password: 'bob-hash' });
    expect(await finishPasskeyRegistration(alice, token, registrationResponse, 'Key')).toEqual({
      status: 'invalid_challenge',
    });
    expect(verifyRegistrationMock).not.toHaveBeenCalled();
  });

  it('reports a response the library rejects or cannot verify', async () => {
    verifyRegistrationMock.mockRejectedValueOnce(new Error('bad attestation'));
    expect(
      await finishPasskeyRegistration(alice, await registrationToken(), registrationResponse, ''),
    ).toEqual({ status: 'failed' });
    verifyRegistrationMock.mockResolvedValueOnce({ verified: false });
    expect(
      await finishPasskeyRegistration(alice, await registrationToken(), registrationResponse, ''),
    ).toEqual({ status: 'failed' });
  });

  it('reports a credential that is already registered', async () => {
    mockDao.findByCredentialId.mockResolvedValue(passkey());
    expect(
      await finishPasskeyRegistration(alice, await registrationToken(), registrationResponse, ''),
    ).toEqual({ status: 'duplicate' });
    expect(mockDao.save).not.toHaveBeenCalled();
  });

  it('re-checks the limit when the ceremony completes', async () => {
    const token = await registrationToken();
    mockDao.findByUsername.mockResolvedValue(
      Array.from({ length: MAX_PASSKEYS_PER_USER }, () => passkey()),
    );
    expect(await finishPasskeyRegistration(alice, token, registrationResponse, '')).toEqual({
      status: 'limit',
    });
  });

  it('reports a concurrent registration of the same credential as a duplicate', async () => {
    const token = await registrationToken();
    mockDao.save.mockRejectedValueOnce(new Error('duplicate key value'));
    mockDao.findByCredentialId.mockResolvedValueOnce(null).mockResolvedValueOnce(passkey());
    expect(await finishPasskeyRegistration(alice, token, registrationResponse, '')).toEqual({
      status: 'duplicate',
    });
  });

  it('surfaces other storage failures', async () => {
    const token = await registrationToken();
    mockDao.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(finishPasskeyRegistration(alice, token, registrationResponse, '')).rejects.toThrow(
      'disk full',
    );
  });

  it('stores the credential bound to the current password, with a default name', async () => {
    const result = await finishPasskeyRegistration(
      alice,
      await registrationToken(),
      registrationResponse,
      '',
    );
    expect(result).toMatchObject({
      status: 'ok',
      passkey: {
        username: 'alice',
        credentialId: 'credential',
        publicKey: 'AQID',
        rpId: rp.rpId,
        sessionVersion: aliceVersion,
        name: 'Passkey',
        deviceType: 'singleDevice',
        backedUp: false,
        lastUsedAt: null,
      },
    });
    expect(verifyRegistrationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpId,
        requireUserVerification: true,
      }),
    );
  });
});

describe('finishPasskeyAuthentication', () => {
  const signIn = async (response = assertion()) => {
    const { challengeToken } = await startPasskeyAuthentication(rp);
    return finishPasskeyAuthentication(challengeToken, response);
  };

  beforeEach(() => {
    mockDao.findByCredentialId.mockResolvedValue(passkey());
  });

  it('refuses an invalid challenge or a response without an id', async () => {
    expect(await finishPasskeyAuthentication('not-a-token', assertion())).toBeNull();
    expect(await signIn(assertion({ id: undefined }))).toBeNull();
    expect(mockDao.findByCredentialId).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown credential', () => mockDao.findByCredentialId.mockResolvedValue(null)],
    [
      'a passkey of another site',
      () => mockDao.findByCredentialId.mockResolvedValue(passkey({ rpId: 'other.example.test' })),
    ],
    ['an account that no longer exists', () => findUserByUsernameMock.mockResolvedValue(undefined)],
    ['a forward-auth account', () => isForwardAuthUserMock.mockReturnValue(true)],
    [
      'a passkey from before a password change',
      () => findUserByUsernameMock.mockResolvedValue({ ...alice, password: 'new-hash' }),
    ],
  ])('refuses %s before checking the signature', async (_label, arrange) => {
    arrange();
    expect(await signIn()).toBeNull();
    expect(verifyAuthenticationMock).not.toHaveBeenCalled();
  });

  it('refuses an assertion for another user handle', async () => {
    expect(await signIn(assertion({ response: { userHandle: 'mallory-handle' } }))).toBeNull();
  });

  it('refuses an assertion the library rejects or cannot verify', async () => {
    verifyAuthenticationMock.mockRejectedValueOnce(new Error('counter went backwards'));
    expect(await signIn()).toBeNull();
    verifyAuthenticationMock.mockResolvedValueOnce({ ...verifiedAssertion, verified: false });
    expect(await signIn()).toBeNull();
    expect(mockDao.recordUse).not.toHaveBeenCalled();
  });

  it('fails when the passkey was removed while the sign-in ran', async () => {
    mockDao.recordUse.mockResolvedValue(false);
    expect(await signIn()).toBeNull();
  });

  it('records the use and returns the account', async () => {
    const stored = passkey({ transports: null });
    mockDao.findByCredentialId.mockResolvedValue(stored);
    expect(await signIn(assertion({ response: {} }))).toBe(alice);
    expect(mockDao.recordUse).toHaveBeenCalledWith(stored.id, {
      counter: 5,
      backedUp: true,
      lastUsedAt: expect.any(String),
    });
    expect(verifyAuthenticationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRPID: rp.rpId,
        requireUserVerification: true,
        credential: expect.objectContaining({
          id: 'credential',
          counter: 0,
          transports: undefined,
        }),
      }),
    );
  });
});
