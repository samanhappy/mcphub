import {
  authenticateForwardAuthToken,
  buildForwardAuthSsoUserId,
  isForwardAuthUser,
  resetForwardAuthStateForTests,
  resolveForwardAuthRuntimeConfig,
} from '../../src/services/forwardAuthService.js';
import type { SystemConfig } from '../../src/types/index.js';

const ENV_KEYS = [
  'FORWARD_AUTH_ENABLED',
  'FORWARD_AUTH_MODE',
  'FORWARD_AUTH_JWKS_URI',
  'FORWARD_AUTH_ISSUER',
  'FORWARD_AUTH_AUDIENCE',
  'FORWARD_AUTH_ALGORITHMS',
  'FORWARD_AUTH_USERNAME_CLAIM',
  'FORWARD_AUTH_EMAIL_CLAIM',
  'FORWARD_AUTH_AUTO_CREATE',
];

const withForwardAuth = (
  forwardAuth: NonNullable<SystemConfig['auth']>['forwardAuth'],
): SystemConfig => ({ auth: { forwardAuth } });

const validSettings = {
  enabled: true,
  jwks: {
    uri: 'https://idp.example.test/.well-known/jwks.json',
    issuer: 'https://idp.example.test/',
    audience: 'mcphub',
  },
};

describe('resolveForwardAuthRuntimeConfig', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    resetForwardAuthStateForTests();
  });

  afterAll(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('is disabled by default', () => {
    expect(resolveForwardAuthRuntimeConfig(null).enabled).toBe(false);
  });

  it('applies defaults to a valid configuration', () => {
    expect(resolveForwardAuthRuntimeConfig(withForwardAuth(validSettings))).toEqual({
      enabled: true,
      mode: 'jwks',
      jwksUri: 'https://idp.example.test/.well-known/jwks.json',
      issuer: 'https://idp.example.test/',
      audience: ['mcphub'],
      algorithms: ['RS256', 'ES256'],
      usernameClaim: 'preferred_username',
      emailClaim: 'email',
      autoCreate: true,
    });
  });

  it('lets env vars override settings', () => {
    process.env.FORWARD_AUTH_ENABLED = 'true';
    process.env.FORWARD_AUTH_JWKS_URI = 'https://env.example.test/jwks';
    process.env.FORWARD_AUTH_ISSUER = 'https://env.example.test/';
    process.env.FORWARD_AUTH_AUDIENCE = 'aud-a,aud-b';
    process.env.FORWARD_AUTH_USERNAME_CLAIM = 'username';
    process.env.FORWARD_AUTH_AUTO_CREATE = 'false';

    const config = resolveForwardAuthRuntimeConfig(
      withForwardAuth({ ...validSettings, enabled: false }),
    );

    expect(config).toMatchObject({
      enabled: true,
      jwksUri: 'https://env.example.test/jwks',
      issuer: 'https://env.example.test/',
      audience: ['aud-a', 'aud-b'],
      usernameClaim: 'username',
      autoCreate: false,
    });
  });

  it.each([
    ['issuer is missing', { ...validSettings, jwks: { ...validSettings.jwks, issuer: '' } }],
    ['audience is missing', { ...validSettings, jwks: { ...validSettings.jwks, audience: [] } }],
    ['the JWKS uri is missing', { ...validSettings, jwks: { ...validSettings.jwks, uri: '' } }],
    [
      'the JWKS uri is plain http on a remote host',
      { ...validSettings, jwks: { ...validSettings.jwks, uri: 'http://idp.example.test/jwks' } },
    ],
    [
      'a symmetric algorithm is listed',
      { ...validSettings, jwks: { ...validSettings.jwks, algorithms: ['RS256', 'HS256'] } },
    ],
    [
      '"none" is listed',
      { ...validSettings, jwks: { ...validSettings.jwks, algorithms: ['none'] } },
    ],
  ])('stays disabled when %s', (_label, settings) => {
    expect(resolveForwardAuthRuntimeConfig(withForwardAuth(settings as any)).enabled).toBe(false);
  });

  it('stays disabled for an unsupported mode', () => {
    process.env.FORWARD_AUTH_MODE = 'header';
    expect(resolveForwardAuthRuntimeConfig(withForwardAuth(validSettings)).enabled).toBe(false);
  });

  it('allows plain http JWKS only on localhost', () => {
    const settings = {
      ...validSettings,
      jwks: { ...validSettings.jwks, uri: 'http://localhost:8080/jwks' },
    };
    expect(resolveForwardAuthRuntimeConfig(withForwardAuth(settings)).enabled).toBe(true);
  });
});

describe('authenticateForwardAuthToken', () => {
  it('skips when forward auth is disabled', async () => {
    await expect(authenticateForwardAuthToken('a.b.c', null)).resolves.toEqual({
      status: 'skipped',
    });
  });

  it('skips tokens that are not JWTs', async () => {
    await expect(
      authenticateForwardAuthToken('static-bearer-key', withForwardAuth(validSettings)),
    ).resolves.toEqual({ status: 'skipped' });
  });
});

describe('forward-auth identity namespace', () => {
  it('derives a stable, issuer-scoped ssoUserId', () => {
    const id = buildForwardAuthSsoUserId('https://a.example.test/', 'sub-1');
    expect(id).toBe(buildForwardAuthSsoUserId('https://a.example.test/', 'sub-1'));
    expect(id).not.toBe(buildForwardAuthSsoUserId('https://b.example.test/', 'sub-1'));
    expect(id.length).toBeLessThanOrEqual(255);
    expect(isForwardAuthUser({ ssoUserId: id })).toBe(true);
    expect(isForwardAuthUser({ ssoUserId: 'better-auth-id' })).toBe(false);
  });
});
