import type { SystemConfig } from '../types/index.js';
import type { AddressInfo } from 'net';
import {
  getBoundAddress,
  isWildcardHost,
  resolveDisplayHost,
  resolveListenHost,
} from './listenAddress.js';

export const INSTALL_BASE_URL_ENV = 'INSTALL_BASE_URL';
export const DEFAULT_INSTALL_BASE_URL = 'http://localhost:3000';

export interface DefaultInstallBaseUrlOptions {
  /** Environment holding PORT and MCPHUB_HOST. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Listener address; null means no listener. Defaults to the address actually bound. */
  bound?: AddressInfo | null;
  /** Origin the client used to reach this request, for example `http://192.168.1.10:3000`. */
  requestOrigin?: string;
  /** Normalised BASE_PATH (`''` or `/prefix`), appended to the result. */
  basePath?: string;
}

/**
 * Base URL of this instance when neither the system config nor INSTALL_BASE_URL sets one,
 * built so the dashboard shows endpoints that reach the running server:
 * - listening on one address: that address and the port actually bound;
 * - listening on every interface: the origin the client used for this request, because
 *   any of the host's addresses may be the right one; `localhost` when there is no request;
 * - not listening yet: MCPHUB_HOST and PORT, each optional (unset gives localhost and 3000).
 * BASE_PATH is appended in every case.
 */
export const getDefaultInstallBaseUrl = ({
  env = process.env,
  bound = getBoundAddress(),
  requestOrigin,
  basePath = '',
}: DefaultInstallBaseUrlOptions = {}): string => {
  let origin: string;
  if (bound && !isWildcardHost(bound.address)) {
    origin = `http://${resolveDisplayHost(bound.address)}:${bound.port}`;
  } else if (requestOrigin) {
    origin = requestOrigin.replace(/\/+$/, '');
  } else if (bound) {
    origin = `http://localhost:${bound.port}`;
  } else {
    const port = env.PORT?.trim() || '3000';
    origin = `http://${resolveDisplayHost(resolveListenHost(env.MCPHUB_HOST))}:${port}`;
  }
  return `${origin}${basePath}`;
};

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
