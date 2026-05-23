const betterAuthMock = jest.fn(() => ({ handler: jest.fn() }));
const genericOAuthMock = jest.fn((options) => ({ id: 'generic-oauth', options }));
const poolMock = jest.fn();
const postgresDialectMock = jest.fn();
const loadSettingsMock = jest.fn();

const runtimeConfig = {
  enabled: true,
  basePath: '/api/auth/better',
  trustedOrigins: ['https://mcp.imdevinc.home'],
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
  loadSettings: loadSettingsMock,
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
    loadSettingsMock.mockReset();
    loadSettingsMock.mockReturnValue({
      systemConfig: {},
    });
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.BETTER_AUTH_URL = 'http://localhost:5173';
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
        trustedOrigins: ['https://mcp.imdevinc.home'],
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

  it('prefers install.baseUrl over BETTER_AUTH_URL when deriving the Better Auth base URL', async () => {
    process.env.USE_DB = 'false';
    loadSettingsMock.mockReturnValue({
      systemConfig: {
        install: {
          baseUrl: 'https://mcp.imdevinc.home/mcphub',
        },
      },
    });

    await import('../../src/betterAuth.js');

    expect(betterAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://mcp.imdevinc.home/mcphub/api/auth/better',
      }),
    );
  });
});
