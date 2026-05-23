const getSystemConfigMock = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: getSystemConfigMock,
  })),
}));

describe('betterAuthConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    getSystemConfigMock.mockReset();
    getSystemConfigMock.mockResolvedValue({});
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('enables Better Auth when only the OIDC provider is configured', async () => {
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';

    getSystemConfigMock.mockResolvedValue({
      auth: {
        betterAuth: {
          enabled: true,
          trustedOrigins: ['https://mcp.imdevinc.home'],
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
    });

    const { getBetterAuthRuntimeConfig } = await import('../../src/services/betterAuthConfig.js');

    expect(await getBetterAuthRuntimeConfig()).toEqual({
      enabled: true,
      basePath: '/api/auth/better',
      trustedOrigins: ['https://mcp.imdevinc.home'],
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

    getSystemConfigMock.mockResolvedValue({
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
    });

    const { getBetterAuthRuntimeConfig } = await import('../../src/services/betterAuthConfig.js');

    expect(await getBetterAuthRuntimeConfig()).toEqual({
      enabled: false,
      basePath: '/api/auth/better',
      trustedOrigins: [],
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

  it('uses install.baseUrl as a trusted origin when none are configured explicitly', async () => {
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';

    getSystemConfigMock.mockResolvedValue({
      install: {
        baseUrl: 'https://mcp.imdevinc.home/mcphub',
      },
      auth: {
        betterAuth: {
          enabled: true,
          providers: {
            oidc: {
              enabled: true,
              discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
            },
          },
        },
      },
    });

    const { getBetterAuthRuntimeConfig } = await import('../../src/services/betterAuthConfig.js');

    expect(await getBetterAuthRuntimeConfig()).toEqual({
      enabled: true,
      basePath: '/api/auth/better',
      trustedOrigins: ['https://mcp.imdevinc.home'],
      providers: {
        google: {
          enabled: false,
        },
        github: {
          enabled: false,
        },
        oidc: {
          enabled: true,
          providerId: 'oidc',
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          prompt: undefined,
        },
      },
    });
  });

  it('prefers the provided system config override instead of reloading settings from another source', async () => {
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';

    getSystemConfigMock.mockResolvedValue({
      auth: {
        betterAuth: {
          enabled: false,
        },
      },
    });

    const systemConfig = {
      install: {
        baseUrl: 'https://dao-backed.example.com/hub',
      },
      auth: {
        betterAuth: {
          enabled: true,
          basePath: '/custom-auth',
          providers: {
            oidc: {
              enabled: true,
              providerId: 'override-oidc',
              discoveryUrl: 'https://override.example.com/.well-known/openid-configuration',
              scopes: ['openid', 'profile'],
              pkce: false,
              prompt: 'login',
            },
          },
        },
      },
    };

    const { getBetterAuthRuntimeConfig } = await import('../../src/services/betterAuthConfig.js');

    expect(await getBetterAuthRuntimeConfig(systemConfig as any)).toEqual({
      enabled: true,
      basePath: '/custom-auth',
      trustedOrigins: ['https://dao-backed.example.com'],
      providers: {
        google: {
          enabled: false,
        },
        github: {
          enabled: false,
        },
        oidc: {
          enabled: true,
          providerId: 'override-oidc',
          discoveryUrl: 'https://override.example.com/.well-known/openid-configuration',
          scopes: ['openid', 'profile'],
          pkce: false,
          prompt: 'login',
        },
      },
    });

    expect(getSystemConfigMock).not.toHaveBeenCalled();
  });
});
