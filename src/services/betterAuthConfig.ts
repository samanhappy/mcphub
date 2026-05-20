import { loadSettings } from '../config/index.js';

const DEFAULT_BETTER_AUTH_BASE_PATH = '/api/auth/better';
const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'];
const DEFAULT_OIDC_PROVIDER_ID = 'oidc';

const normalizePath = (value: string): string => {
  if (!value) {
    return DEFAULT_BETTER_AUTH_BASE_PATH;
  }
  return value.startsWith('/') ? value : `/${value}`;
};

export const getBetterAuthRuntimeConfig = () => {
  const settings = loadSettings();
  const betterAuthSettings = settings.systemConfig?.auth?.betterAuth || {};
  const databaseUrlConfigured = Boolean(process.env.DB_URL);
  const enabled = Boolean(betterAuthSettings.enabled ?? true) && databaseUrlConfigured;
  const basePath = normalizePath(betterAuthSettings.basePath || DEFAULT_BETTER_AUTH_BASE_PATH);
  const providerSettings = betterAuthSettings.providers || {};

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
  const oidcDiscoveryUrl = oidcSettings.discoveryUrl;
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
    providers: {
      google: {
        enabled: googleEnabled,
      },
      github: {
        enabled: githubEnabled,
      },
      oidc: {
        enabled: oidcEnabled,
        providerId: oidcSettings.providerId || DEFAULT_OIDC_PROVIDER_ID,
        discoveryUrl: oidcDiscoveryUrl,
        scopes: oidcSettings.scopes || DEFAULT_OIDC_SCOPES,
        pkce: oidcSettings.pkce ?? true,
        prompt: oidcSettings.prompt,
      },
    },
  };
};

export const betterAuthRuntimeConfig = getBetterAuthRuntimeConfig();
