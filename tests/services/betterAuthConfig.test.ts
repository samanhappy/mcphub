const getSystemConfigMock = jest.fn();
const BETTER_AUTH_ENV_KEYS = [
  'BETTER_AUTH_ENABLED',
  'BETTER_AUTH_BASE_PATH',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_GOOGLE_ENABLED',
  'BETTER_AUTH_GITHUB_ENABLED',
  'BETTER_AUTH_OIDC_ENABLED',
  'BETTER_AUTH_OIDC_PROVIDER_ID',
  'BETTER_AUTH_OIDC_DISCOVERY_URL',
  'BETTER_AUTH_OIDC_SCOPES',
  'BETTER_AUTH_OIDC_PKCE',
  'BETTER_AUTH_OIDC_PROMPT',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'OIDC_DISCOVERY_URL',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
];

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
    for (const envKey of BETTER_AUTH_ENV_KEYS) {
      process.env[envKey] = '';
    }
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
      disableAutoCreate: false,
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
      disableAutoCreate: false,
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
      disableAutoCreate: false,
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
      disableAutoCreate: false,
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

  it('prefers Better Auth environment variables over stored settings for runtime config', async () => {
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.BETTER_AUTH_ENABLED = 'true';
    process.env.BETTER_AUTH_BASE_PATH = 'env-auth';
    process.env.BETTER_AUTH_TRUSTED_ORIGINS =
      'https://env-login.example.com, https://dashboard.example.com/app';
    process.env.BETTER_AUTH_URL = 'https://public.example.com/mcphub';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BETTER_AUTH_GOOGLE_ENABLED = 'false';
    process.env.GITHUB_CLIENT_ID = 'github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
    process.env.BETTER_AUTH_GITHUB_ENABLED = 'true';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';
    process.env.BETTER_AUTH_OIDC_ENABLED = 'true';
    process.env.BETTER_AUTH_OIDC_PROVIDER_ID = 'env-oidc';
    process.env.BETTER_AUTH_OIDC_DISCOVERY_URL =
      'https://env-auth.example.com/.well-known/openid-configuration';
    process.env.BETTER_AUTH_OIDC_SCOPES = 'openid, profile, custom';
    process.env.BETTER_AUTH_OIDC_PKCE = 'false';
    process.env.BETTER_AUTH_OIDC_PROMPT = 'select_account';

    getSystemConfigMock.mockResolvedValue({
      auth: {
        betterAuth: {
          enabled: false,
          basePath: '/settings-auth',
          trustedOrigins: ['https://settings.example.com'],
      disableAutoCreate: false,
          providers: {
            google: {
              enabled: true,
            },
            github: {
              enabled: false,
            },
            oidc: {
              enabled: false,
              providerId: 'settings-oidc',
              discoveryUrl: 'https://settings-auth.example.com/.well-known/openid-configuration',
              scopes: ['openid'],
              pkce: true,
              prompt: 'login',
            },
          },
        },
      },
    });

    const { getBetterAuthRuntimeConfig } = await import('../../src/services/betterAuthConfig.js');

    expect(await getBetterAuthRuntimeConfig()).toEqual({
      enabled: true,
      basePath: '/env-auth',
      trustedOrigins: [
        'https://env-login.example.com',
        'https://dashboard.example.com',
        'https://public.example.com',
      ],
      disableAutoCreate: false,
      providers: {
        google: {
          enabled: false,
        },
        github: {
          enabled: true,
        },
        oidc: {
          enabled: true,
          providerId: 'env-oidc',
          discoveryUrl: 'https://env-auth.example.com/.well-known/openid-configuration',
          scopes: ['openid', 'profile', 'custom'],
          pkce: false,
          prompt: 'select_account',
        },
      },
    });
  });

  it('accepts the legacy OIDC_DISCOVERY_URL environment variable for full env-only OIDC setup', async () => {
    process.env.DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';
    process.env.BETTER_AUTH_ENABLED = 'true';
    process.env.BETTER_AUTH_OIDC_ENABLED = 'true';
    process.env.OIDC_DISCOVERY_URL =
      'https://legacy-auth.example.com/.well-known/openid-configuration';
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';

    getSystemConfigMock.mockResolvedValue({
      auth: {
        betterAuth: {
          enabled: false,
          providers: {
            oidc: {
              enabled: false,
            },
          },
        },
      },
    });

    const { getBetterAuthRuntimeConfig } = await import('../../src/services/betterAuthConfig.js');

    expect(await getBetterAuthRuntimeConfig()).toEqual({
      enabled: true,
      basePath: '/api/auth/better',
      trustedOrigins: [],
      disableAutoCreate: false,
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
          discoveryUrl: 'https://legacy-auth.example.com/.well-known/openid-configuration',
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
      disableAutoCreate: false,
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
