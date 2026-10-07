import type { SsoProviderName } from '../../src/services/betterAuthConfig.js';

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
  'BETTER_AUTH_OIDC_TRUST_EMAIL',
  'BETTER_AUTH_DISABLE_PASSWORD_LOGIN',
  'INSTALL_BASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'OIDC_DISCOVERY_URL',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
];
const TEST_DB_URL = 'postgresql://mcphub:password@localhost:5432/mcphub';

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
    process.env.USE_DB = 'true';
    process.env.DB_URL = TEST_DB_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('disablePasswordLogin', () => {
    const oidcSettings = (disablePasswordLogin?: boolean) => ({
      auth: {
        betterAuth: {
          enabled: true,
          ...(disablePasswordLogin === undefined ? {} : { disablePasswordLogin }),
          providers: {
            oidc: {
              enabled: true,
              discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
            },
          },
        },
      },
    });
    // `mounted`: the providers whose sign-in route was mounted at startup
    const resolve = async (mounted: SsoProviderName[] = ['oidc']) => {
      const { getBetterAuthRuntimeConfig, setMountedSsoProviders } = await import(
        '../../src/services/betterAuthConfig.js'
      );
      setMountedSsoProviders(mounted);
      return (await getBetterAuthRuntimeConfig()).disablePasswordLogin;
    };

    beforeEach(() => {
      process.env.OIDC_CLIENT_ID = 'oidc-client-id';
      process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';
    });

    it('is off by default', async () => {
      getSystemConfigMock.mockResolvedValue(oidcSettings());
      expect(await resolve()).toBe(false);
    });

    it('follows the stored setting while an SSO provider is enabled', async () => {
      getSystemConfigMock.mockResolvedValue(oidcSettings(true));
      expect(await resolve()).toBe(true);
    });

    it('is ignored without an enabled SSO provider, so nobody is locked out', async () => {
      process.env.OIDC_CLIENT_SECRET = '';
      getSystemConfigMock.mockResolvedValue(oidcSettings(true));
      expect(await resolve()).toBe(false);
    });

    it('is ignored while the enabled provider was not mounted at startup', async () => {
      getSystemConfigMock.mockResolvedValue(oidcSettings(true));
      expect(await resolve([])).toBe(false);
    });

    it('is ignored when the mounted provider has been disabled since startup', async () => {
      process.env.GITHUB_CLIENT_ID = 'github-client-id';
      process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
      const settings = oidcSettings(true);
      getSystemConfigMock.mockResolvedValue({
        auth: {
          betterAuth: {
            ...settings.auth.betterAuth,
            providers: { ...settings.auth.betterAuth.providers, github: { enabled: false } },
          },
        },
      });
      expect(await resolve(['github'])).toBe(false);
    });

    it('is ignored outside database mode, where Better Auth cannot run', async () => {
      process.env.USE_DB = 'false';
      process.env.DB_URL = '';
      getSystemConfigMock.mockResolvedValue(oidcSettings(true));
      expect(await resolve()).toBe(false);
    });

    it('lets the environment variable override the stored setting both ways', async () => {
      process.env.BETTER_AUTH_DISABLE_PASSWORD_LOGIN = 'false';
      getSystemConfigMock.mockResolvedValue(oidcSettings(true));
      expect(await resolve()).toBe(false);

      process.env.BETTER_AUTH_DISABLE_PASSWORD_LOGIN = 'true';
      getSystemConfigMock.mockResolvedValue(oidcSettings(false));
      expect(await resolve()).toBe(true);
    });
  });

  it('enables Better Auth when only the OIDC provider is configured', async () => {
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
      disablePasswordLogin: false,
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
          trustEmail: false,
        },
      },
    });
  });

  it('disables the OIDC provider when the discovery URL is missing', async () => {
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
      disablePasswordLogin: false,
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
          trustEmail: false,
        },
      },
    });
  });

  it('uses install.baseUrl as a trusted origin when none are configured explicitly', async () => {
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
      disablePasswordLogin: false,
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
          trustEmail: false,
        },
      },
    });
  });

  it('uses INSTALL_BASE_URL as a trusted origin when install.baseUrl is unset', async () => {
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';
    process.env.INSTALL_BASE_URL = 'https://env.example.com/mcphub';

    getSystemConfigMock.mockResolvedValue({
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

    expect((await getBetterAuthRuntimeConfig()).trustedOrigins).toEqual([
      'https://env.example.com',
    ]);
  });

  it('uses betterAuth.baseUrl as a trusted origin and prefers it over install.baseUrl', async () => {
    process.env.OIDC_CLIENT_ID = 'oidc-client-id';
    process.env.OIDC_CLIENT_SECRET = 'oidc-client-secret';

    const systemConfig = {
      install: {
        baseUrl: 'https://install.example.com/mcphub',
      },
      auth: {
        betterAuth: {
          enabled: true,
          baseUrl: 'https://settings.example.com/mcphub',
          providers: {
            oidc: {
              enabled: true,
              discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
            },
          },
        },
      },
    };

    getSystemConfigMock.mockResolvedValue(systemConfig);

    const { getBetterAuthRuntimeConfig, resolveBetterAuthBaseUrl } = await import(
      '../../src/services/betterAuthConfig.js'
    );

    expect((await getBetterAuthRuntimeConfig()).trustedOrigins).toEqual([
      'https://settings.example.com',
      'https://install.example.com',
    ]);
    expect(resolveBetterAuthBaseUrl(systemConfig)).toBe('https://settings.example.com/mcphub');
  });

  it('prefers BETTER_AUTH_URL over betterAuth.baseUrl for the resolved base URL', async () => {
    process.env.BETTER_AUTH_URL = 'https://env-public.example.com/mcphub';

    const systemConfig = {
      install: {
        baseUrl: 'https://install.example.com/mcphub',
      },
      auth: {
        betterAuth: {
          baseUrl: 'https://settings.example.com/mcphub',
        },
      },
    };

    const { resolveBetterAuthBaseUrl } = await import('../../src/services/betterAuthConfig.js');

    expect(resolveBetterAuthBaseUrl(systemConfig)).toBe('https://env-public.example.com/mcphub');
  });

  it('prefers Better Auth environment variables over stored settings for runtime config', async () => {
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
      disablePasswordLogin: false,
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
          trustEmail: false,
        },
      },
    });
  });

  it('accepts the legacy OIDC_DISCOVERY_URL environment variable for full env-only OIDC setup', async () => {
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
      disablePasswordLogin: false,
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
          trustEmail: false,
        },
      },
    });
  });

  it('prefers the provided system config override instead of reloading settings from another source', async () => {
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
      disablePasswordLogin: false,
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
          trustEmail: false,
        },
      },
    });

    expect(getSystemConfigMock).not.toHaveBeenCalled();
  });

  describe('isApiAuthExemptPath', () => {
    const loadHelper = async () =>
      (await import('../../src/services/betterAuthConfig.js')).isApiAuthExemptPath;

    it('exempts the login endpoint regardless of the better-auth mount point', async () => {
      const isApiAuthExemptPath = await loadHelper();

      expect(isApiAuthExemptPath('/auth/login', { basePath: '/auth' })).toBe(true);
      expect(isApiAuthExemptPath('/auth/login', { basePath: '/api/auth/better' })).toBe(true);
    });

    it('exempts better-auth paths mounted under /api using their base path', async () => {
      const isApiAuthExemptPath = await loadHelper();

      expect(isApiAuthExemptPath('/auth/better/sign-in', { basePath: '/api/auth/better' })).toBe(
        true,
      );
      expect(isApiAuthExemptPath('/auth/better', { basePath: '/api/auth/better' })).toBe(true);
    });

    it('exempts the legacy /better-auth prefix', async () => {
      const isApiAuthExemptPath = await loadHelper();

      expect(isApiAuthExemptPath('/better-auth/session', { basePath: '/auth' })).toBe(true);
    });

    it('does not exempt protected API routes', async () => {
      const isApiAuthExemptPath = await loadHelper();

      expect(isApiAuthExemptPath('/servers', { basePath: '/api/auth/better' })).toBe(false);
      expect(isApiAuthExemptPath('/groups', { basePath: '/auth' })).toBe(false);
      expect(isApiAuthExemptPath('/auth/login2', { basePath: '/auth' })).toBe(false);
    });

    it('does not exempt a better-auth base path that is not under /api', async () => {
      const isApiAuthExemptPath = await loadHelper();

      expect(isApiAuthExemptPath('/custom-auth/sign-in', { basePath: '/custom-auth' })).toBe(false);
    });
  });
});
