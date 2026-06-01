import { expandEnvVars, loadSettings } from '../config/index.js';
import { getSystemConfigDao } from '../dao/DaoFactory.js';
import { BetterAuthConfig, BetterAuthOidcProviderConfig, SystemConfig } from '../types/index.js';
import { getCachedSystemConfig, isDatabaseModeEnabled } from '../utils/systemConfigCache.js';

const DEFAULT_BETTER_AUTH_BASE_PATH = '/api/auth/better';
const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'];
const DEFAULT_OIDC_PROVIDER_ID = 'oidc';
const VALID_OIDC_PROMPTS = new Set<string>([
  'none',
  'login',
  'create',
  'consent',
  'select_account',
  'select_account consent',
  'login consent',
]);

export interface BetterAuthRuntimeConfig {
  enabled: boolean;
  basePath: string;
  trustedOrigins: string[];
  disableAutoCreate: boolean;
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
      trustEmail: boolean;
    };
  };
}

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    return undefined;
  }

  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  return undefined;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = expandEnvVars(value).trim();
  return trimmedValue || undefined;
};

const normalizePath = (value: unknown): string => {
  const normalizedValue = normalizeOptionalString(value);
  if (!normalizedValue) {
    return DEFAULT_BETTER_AUTH_BASE_PATH;
  }
  return normalizedValue.startsWith('/') ? normalizedValue : `/${normalizedValue}`;
};

const normalizeTrustedOrigin = (value: unknown): string | null => {
  const normalizedValue = normalizeOptionalString(value);
  if (!normalizedValue) {
    return null;
  }

  try {
    return new URL(normalizedValue).origin;
  } catch {
    return null;
  }
};

const splitStringArray = (value: string): string[] => {
  const normalizedValue = expandEnvVars(value).trim();
  if (!normalizedValue) {
    return [];
  }

  if (normalizedValue.startsWith('[')) {
    try {
      const parsedValue = JSON.parse(normalizedValue);
      if (Array.isArray(parsedValue)) {
        return parsedValue
          .map((item) => normalizeOptionalString(item))
          .filter((item): item is string => Boolean(item));
      }
    } catch {
      // Fall back to delimiter-based parsing below.
    }
  }

  const delimiter = normalizedValue.includes(',') ? /,/ : /\s+/;
  return normalizedValue
    .split(delimiter)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const normalizeStringArray = (value: unknown, fallback: string[] = []): string[] => {
  const normalized = Array.isArray(value)
    ? value
        .map((item) => normalizeOptionalString(item))
        .filter((item): item is string => Boolean(item))
    : typeof value === 'string'
      ? splitStringArray(value)
      : [];

  return normalized.length > 0 ? normalized : fallback;
};

const normalizePrompt = (
  value: unknown,
): BetterAuthOidcProviderConfig['prompt'] | undefined => {
  const normalizedValue = normalizeOptionalString(value);
  if (!normalizedValue || !VALID_OIDC_PROMPTS.has(normalizedValue)) {
    return undefined;
  }

  return normalizedValue as BetterAuthOidcProviderConfig['prompt'];
};

const resolveBooleanSetting = (
  envValue: string | undefined,
  settingsValue: unknown,
  defaultValue: boolean,
): boolean => {
  const envOverride = parseBoolean(envValue);
  if (envOverride !== undefined) {
    return envOverride;
  }

  const settingsOverride = parseBoolean(settingsValue);
  if (settingsOverride !== undefined) {
    return settingsOverride;
  }

  return defaultValue;
};

const resolveStringSetting = (
  envValue: string | undefined,
  settingsValue: unknown,
  defaultValue?: string,
): string | undefined => {
  const envOverride = normalizeOptionalString(envValue);
  if (envOverride !== undefined) {
    return envOverride;
  }

  const settingsOverride = normalizeOptionalString(settingsValue);
  if (settingsOverride !== undefined) {
    return settingsOverride;
  }

  return defaultValue;
};

const resolveStringArraySetting = (
  envValue: string | undefined,
  settingsValue: unknown,
  defaultValue: string[] = [],
): string[] => {
  if (envValue !== undefined) {
    const envOverride = normalizeStringArray(envValue, []);
    if (envOverride.length > 0) {
      return envOverride;
    }
  }

  const settingsOverride = normalizeStringArray(settingsValue, []);
  if (settingsOverride.length > 0) {
    return settingsOverride;
  }

  return defaultValue;
};

const resolvePromptSetting = (
  envValue: string | undefined,
  settingsValue: unknown,
): BetterAuthOidcProviderConfig['prompt'] | undefined => {
  const envOverride = normalizePrompt(envValue);
  if (envOverride !== undefined) {
    return envOverride;
  }

  return normalizePrompt(settingsValue);
};

export const resolveBetterAuthRuntimeConfig = (
  systemConfig?: SystemConfig | null,
): BetterAuthRuntimeConfig => {
  const betterAuthSettings: BetterAuthConfig = systemConfig?.auth?.betterAuth || {};
  const providerSettings = betterAuthSettings.providers || {};
  const oidcSettings = providerSettings.oidc || {};
  const databaseModeEnabled = isDatabaseModeEnabled();
  const betterAuthEnabled =
    resolveBooleanSetting(process.env.BETTER_AUTH_ENABLED, betterAuthSettings.enabled, true) &&
    databaseModeEnabled;
  const basePath = normalizePath(
    resolveStringSetting(process.env.BETTER_AUTH_BASE_PATH, betterAuthSettings.basePath),
  );
  const trustedOriginSettings = resolveStringArraySetting(
    process.env.BETTER_AUTH_TRUSTED_ORIGINS,
    betterAuthSettings.trustedOrigins,
    [],
  );
  const trustedOrigins = Array.from(
    new Set(
      [
        ...trustedOriginSettings,
        process.env.BETTER_AUTH_URL,
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
  const oidcDiscoveryUrl = resolveStringSetting(
    process.env.BETTER_AUTH_OIDC_DISCOVERY_URL,
    resolveStringSetting(process.env.OIDC_DISCOVERY_URL, oidcSettings.discoveryUrl),
  );
  const oidcProviderId =
    resolveStringSetting(
      process.env.BETTER_AUTH_OIDC_PROVIDER_ID,
      oidcSettings.providerId,
      DEFAULT_OIDC_PROVIDER_ID,
    ) || DEFAULT_OIDC_PROVIDER_ID;
  const oidcScopes = resolveStringArraySetting(
    process.env.BETTER_AUTH_OIDC_SCOPES,
    oidcSettings.scopes,
    DEFAULT_OIDC_SCOPES,
  );
  const oidcPkce = resolveBooleanSetting(process.env.BETTER_AUTH_OIDC_PKCE, oidcSettings.pkce, true);
  const oidcPrompt = resolvePromptSetting(process.env.BETTER_AUTH_OIDC_PROMPT, oidcSettings.prompt);
  const oidcTrustEmail = resolveBooleanSetting(
    process.env.BETTER_AUTH_OIDC_TRUST_EMAIL,
    undefined,
    false,
  );
  const oidcEnabledSetting = resolveBooleanSetting(
    process.env.BETTER_AUTH_OIDC_ENABLED,
    oidcSettings.enabled,
    false,
  );
  const oidcEnabled =
    betterAuthEnabled &&
    oidcEnabledSetting &&
    Boolean(oidcDiscoveryUrl) &&
    oidcEnvConfigured;

  const googleEnabled =
    betterAuthEnabled &&
    resolveBooleanSetting(
      process.env.BETTER_AUTH_GOOGLE_ENABLED,
      providerSettings.google?.enabled,
      true,
    ) &&
    googleEnvConfigured;
  const githubEnabled =
    betterAuthEnabled &&
    resolveBooleanSetting(
      process.env.BETTER_AUTH_GITHUB_ENABLED,
      providerSettings.github?.enabled,
      true,
    ) &&
    githubEnvConfigured;

  const anyProviderEnabled = googleEnabled || githubEnabled || oidcEnabled;

  const disableAutoCreate = resolveBooleanSetting(
    process.env.BETTER_AUTH_DISABLE_AUTO_CREATE,
    betterAuthSettings.disableAutoCreate,
    false,
  );

  return {
    enabled: anyProviderEnabled,
    basePath,
    trustedOrigins,
    disableAutoCreate,
    providers: {
      google: {
        enabled: googleEnabled,
      },
      github: {
        enabled: githubEnabled,
      },
      oidc: {
        enabled: oidcEnabled,
        providerId: oidcProviderId,
        discoveryUrl: oidcDiscoveryUrl,
        scopes: oidcScopes,
        pkce: oidcPkce,
        prompt: oidcPrompt,
        trustEmail: oidcTrustEmail,
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
