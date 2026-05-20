const betterAuthMock = jest.fn(() => ({ handler: jest.fn() }));
const genericOAuthMock = jest.fn((options) => ({ id: 'generic-oauth', options }));
const poolMock = jest.fn();
const postgresDialectMock = jest.fn();

const runtimeConfig = {
  enabled: true,
  basePath: '/api/auth/better',
  providers: {
    google: { enabled: false },
    github: { enabled: false },
    oidc: {
      enabled: true,
      providerId: 'local-oidc',
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
      scopes: ['openid', 'profile', 'email'],
      pkce: true,
      prompt: 'login',
    },
  },
};

jest.mock('better-auth', () => ({
  betterAuth: betterAuthMock,
}));

jest.mock('better-auth/plugins', () => ({
  genericOAuth: genericOAuthMock,
}));

jest.mock('pg', () => ({
  Pool: poolMock,
}));

jest.mock('kysely', () => ({
  PostgresDialect: postgresDialectMock,
}));

jest.mock('../../src/config/index.js', () => ({
  __esModule: true,
  default: {
    port: 3000,
    basePath: '',
  },
}));

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  __esModule: true,
  betterAuthRuntimeConfig: runtimeConfig,
  getBetterAuthRuntimeConfig: jest.fn(() => runtimeConfig),
}));

describe('betterAuth bootstrap', () => {
  beforeEach(() => {
    jest.resetModules();
    betterAuthMock.mockClear();
    genericOAuthMock.mockClear();
    poolMock.mockClear();
    postgresDialectMock.mockClear();
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';
  });

  it('registers the generic OAuth plugin when the OIDC provider is enabled', async () => {
    await import('../../src/betterAuth.js');

    expect(genericOAuthMock).toHaveBeenCalledWith({
      config: [
        {
          providerId: 'local-oidc',
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
          clientId: 'oidc-client-id',
          clientSecret: 'oidc-client-secret',
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          prompt: 'login',
        },
      ],
    });

    expect(betterAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socialProviders: {},
        plugins: [
          {
            id: 'generic-oauth',
            options: {
              config: [
                {
                  providerId: 'local-oidc',
                  discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
                  clientId: 'oidc-client-id',
                  clientSecret: 'oidc-client-secret',
                  scopes: ['openid', 'profile', 'email'],
                  pkce: true,
                  prompt: 'login',
                },
              ],
            },
          },
        ],
      }),
    );
  });
});
