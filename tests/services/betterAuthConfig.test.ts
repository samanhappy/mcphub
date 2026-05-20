const loadSettingsMock = jest.fn();

jest.mock('../../src/config/index.js', () => ({
  loadSettings: loadSettingsMock,
}));

describe('betterAuthConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    loadSettingsMock.mockReset();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('enables Better Auth when only the OIDC provider is configured', async () => {
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';

    loadSettingsMock.mockReturnValue({
      systemConfig: {
        auth: {
          betterAuth: {
            enabled: true,
            providers: {
              oidc: {
                enabled: true,
                providerId: 'local-oidc',
                discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
                scopes: ['openid', 'profile', 'email'],
                pkce: true,
              },
            },
          },
        },
      },
    });

    const { getBetterAuthRuntimeConfig } = await import('../../src/services/betterAuthConfig.js');

    expect(getBetterAuthRuntimeConfig()).toEqual({
      enabled: true,
      basePath: '/api/auth/better',
      providers: {
        google: {
          enabled: false,
        },
        github: {
          enabled: false,
        },
        oidc: {
          enabled: true,
          providerId: 'local-oidc',
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          prompt: undefined,
        },
      },
    });
  });

  it('disables the OIDC provider when the discovery URL is missing', async () => {
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';

    loadSettingsMock.mockReturnValue({
      systemConfig: {
        auth: {
          betterAuth: {
            enabled: true,
            providers: {
              oidc: {
                enabled: true,
                providerId: 'local-oidc',
              },
            },
          },
        },
      },
    });

    const { getBetterAuthRuntimeConfig } = await import('../../src/services/betterAuthConfig.js');

    expect(getBetterAuthRuntimeConfig()).toEqual({
      enabled: false,
      basePath: '/api/auth/better',
      providers: {
        google: {
          enabled: false,
        },
        github: {
          enabled: false,
        },
        oidc: {
          enabled: false,
          providerId: 'local-oidc',
          discoveryUrl: undefined,
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          prompt: undefined,
        },
      },
    });
  });
});
