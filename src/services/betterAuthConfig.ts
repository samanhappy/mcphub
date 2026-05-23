import { loadSettings } from '../config/index.js';
import { getSystemConfigDao } from '../dao/DaoFactory.js';
import { BetterAuthConfig, BetterAuthOidcProviderConfig, SystemConfig } from '../types/index.js';
import { getCachedSystemConfig, isDatabaseModeEnabled } from '../utils/systemConfigCache.js';

const DEFAULT_BETTER_AUTH_BASE_PATH = '/api/auth/better';
const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'];
const DEFAULT_OIDC_PROVIDER_ID = 'oidc';

export interface BetterAuthRuntimeConfig {
  enabled: boolean;
  basePath: string;
  trustedOrigins: string[];
  providers: {
    google: {
      enabled: boolean;
    };
    github: {
      enabled: boolean;
    };
    oidc: {
      enabled: boolean;
      providerId: string;
      discoveryUrl?: string;
      scopes: string[];
      pkce: boolean;
      prompt?: BetterAuthOidcProviderConfig['prompt'];
    };
  };
}

const normalizePath = (value: string): string => {
  if (!value) {
    return DEFAULT_BETTER_AUTH_BASE_PATH;
  }
  return value.startsWith('/') ? value : `/${value}`;
};

const normalizeTrustedOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    return new URL(trimmedValue).origin;
  } catch {
    return null;
  }
};

const normalizeStringArray = (value: unknown, fallback: string[] = []): string[] => {
  const values = Array.isArray(value) ? value : fallback;
  const normalized = values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : fallback;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue || undefined;
};

export const resolveBetterAuthRuntimeConfig = (
  systemConfig?: SystemConfig | null,
): BetterAuthRuntimeConfig => {
  const betterAuthSettings: BetterAuthConfig = systemConfig?.auth?.betterAuth || {};
  const databaseModeEnabled = isDatabaseModeEnabled();
  const enabled = Boolean(betterAuthSettings.enabled ?? true) && databaseModeEnabled;
  const basePath = normalizePath(betterAuthSettings.basePath || DEFAULT_BETTER_AUTH_BASE_PATH);
  const providerSettings = betterAuthSettings.providers || {};
  const trustedOrigins = Array.from(
    new Set(
      [
        ...(Array.isArray(betterAuthSettings.trustedOrigins)
          ? betterAuthSettings.trustedOrigins
          : []),
        systemConfig?.install?.baseUrl,
      ]
        .map((value) => normalizeTrustedOrigin(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const googleEnvConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const githubEnvConfigured = Boolean(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
  );
  const oidcEnvConfigured = Boolean(
    process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET,
  );
  const oidcSettings = providerSettings.oidc || {};
  const oidcDiscoveryUrl = normalizeOptionalString(oidcSettings.discoveryUrl);
  const oidcEnabled =
    enabled &&
    Boolean(oidcSettings.enabled) &&
    Boolean(oidcDiscoveryUrl) &&
    oidcEnvConfigured;

  const googleEnabled =
    enabled && Boolean(providerSettings.google?.enabled ?? true) && googleEnvConfigured;
  const githubEnabled =
    enabled && Boolean(providerSettings.github?.enabled ?? true) && githubEnvConfigured;

  const anyProviderEnabled = googleEnabled || githubEnabled || oidcEnabled;

  return {
    enabled: anyProviderEnabled,
    basePath,
    trustedOrigins,
    providers: {
      google: {
        enabled: googleEnabled,
      },
      github: {
        enabled: githubEnabled,
      },
      oidc: {
        enabled: oidcEnabled,
        providerId: normalizeOptionalString(oidcSettings.providerId) || DEFAULT_OIDC_PROVIDER_ID,
        discoveryUrl: oidcDiscoveryUrl,
        scopes: normalizeStringArray(oidcSettings.scopes, DEFAULT_OIDC_SCOPES),
        pkce: oidcSettings.pkce ?? true,
        prompt: normalizeOptionalString(oidcSettings.prompt) as BetterAuthOidcProviderConfig['prompt'],
      },
    },
  };
};

export const getBetterAuthRuntimeConfig = async (
  systemConfigOverride?: SystemConfig | null,
): Promise<BetterAuthRuntimeConfig> => {
  if (systemConfigOverride !== undefined) {
    return resolveBetterAuthRuntimeConfig(systemConfigOverride);
  }

  const systemConfig = await getSystemConfigDao().get();
  return resolveBetterAuthRuntimeConfig(systemConfig);
};

export const betterAuthRuntimeConfig = (() => {
  const cachedSystemConfig = getCachedSystemConfig();
  if (cachedSystemConfig) {
    return resolveBetterAuthRuntimeConfig(cachedSystemConfig);
  }

  if (!isDatabaseModeEnabled()) {
    const settings = loadSettings();
    return resolveBetterAuthRuntimeConfig(settings.systemConfig ?? null);
  }

  return resolveBetterAuthRuntimeConfig(null);
})();
