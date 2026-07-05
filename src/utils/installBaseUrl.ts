import type { SystemConfig } from '../types/index.js';

export const INSTALL_BASE_URL_ENV = 'INSTALL_BASE_URL';
export const DEFAULT_INSTALL_BASE_URL = 'http://localhost:3000';

const normalizeInstallBaseUrl = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
};

export const getInstallBaseUrlFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => normalizeInstallBaseUrl(env[INSTALL_BASE_URL_ENV]);

export const resolveInstallBaseUrl = (
  systemConfig?: Pick<SystemConfig, 'install'> | null,
  fallback?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined =>
  normalizeInstallBaseUrl(systemConfig?.install?.baseUrl) ??
  getInstallBaseUrlFromEnv(env) ??
  normalizeInstallBaseUrl(fallback);

export const withResolvedInstallBaseUrl = (
  systemConfig?: SystemConfig | null,
  fallback?: string,
  env: NodeJS.ProcessEnv = process.env,
): SystemConfig => {
  const resolvedBaseUrl = resolveInstallBaseUrl(systemConfig, fallback, env);

  return {
    ...(systemConfig ?? {}),
    install: {
      ...(systemConfig?.install ?? {}),
      ...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
    },
  };
};
