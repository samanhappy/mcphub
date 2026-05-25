const betterAuthMock = jest.fn(() => ({ handler: jest.fn() }));
const genericOAuthMock = jest.fn((options: unknown) => ({ id: 'generic-oauth', options }));
const poolMock = jest.fn();
const postgresDialectMock = jest.fn();
const loadSettingsMock = jest.fn();
const resolveBetterAuthRuntimeConfigMock = jest.fn();

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

const disabledRuntimeConfig = {
  enabled: false,
  basePath: '/api/auth/better',
  trustedOrigins: [],
  providers: {
    google: { enabled: false },
    github: { enabled: false },
    oidc: {
      enabled: false,
      providerId: 'oidc',
      scopes: ['openid', 'profile', 'email'],
      pkce: true,
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
  betterAuthRuntimeConfig: disabledRuntimeConfig,
  getBetterAuthRuntimeConfig: jest.fn(() => runtimeConfig),
  resolveBetterAuthRuntimeConfig: resolveBetterAuthRuntimeConfigMock,
}));

describe('betterAuth bootstrap', () => {
  beforeEach(() => {
    jest.resetModules();
    betterAuthMock.mockClear();
    genericOAuthMock.mockClear();
    poolMock.mockClear();
    postgresDialectMock.mockClear();
    loadSettingsMock.mockReset();
    resolveBetterAuthRuntimeConfigMock.mockReset();
    resolveBetterAuthRuntimeConfigMock.mockReturnValue(runtimeConfig);
    loadSettingsMock.mockReturnValue({
      systemConfig: {},
    });
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.BETTER_AUTH_URL = 'http://localhost:5173';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';
    process.env.USE_DB = 'true';
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

  it('prefers BETTER_AUTH_URL over install.baseUrl when deriving the Better Auth base URL', async () => {
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
        baseURL: 'http://localhost:5173/api/auth/better',
      }),
    );
  });

  it('builds the auth instance from the current resolved runtime config instead of the stale exported snapshot', async () => {
    await import('../../src/betterAuth.js');

    expect(resolveBetterAuthRuntimeConfigMock).toHaveBeenCalled();
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
        plugins: [
          expect.objectContaining({
            id: 'generic-oauth',
          }),
        ],
      }),
    );
  });
});
