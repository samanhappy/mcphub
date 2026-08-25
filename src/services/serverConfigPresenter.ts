import { authorizationService, RequestPrincipal } from './authorizationService.js';

// Safe server representation for issue #1036 Phase 1: shared users may see a
// server's metadata but never its secret-bearing configuration. Redaction is
// enforced here (server-side); the dashboard is never the security boundary.

type ServerConfigLike = Record<string, unknown>;

export interface PresentedServer<T> {
  view: 'full' | 'safe';
  data: T;
}

// Connection/authentication fields whose raw values must never reach an
// unauthorized reader. `args` is included because stdio arguments routinely
// carry tokens on the command line.
const SECRET_BEARING_FIELDS = ['env', 'headers', 'args', 'oauth', 'proxy'] as const;

// OAuth session-recovery fields exposed on ServerInfo list entries; only the
// connected/clientIdConfigured indicators are safe for non-config-readers.
const SAFE_SERVER_INFO_OAUTH_KEYS = ['connected', 'clientIdConfigured'] as const;

const clone = <T>(value: T): T =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

const stripOpenApiSecrets = (openapi: Record<string, unknown>): Record<string, unknown> => {
  const { security: _security, ...rest } = openapi;
  return rest;
};

const presentSafeServerConfig = (config: ServerConfigLike): ServerConfigLike => {
  const safe = clone(config);
  let hadSecrets = false;

  for (const field of SECRET_BEARING_FIELDS) {
    if (safe[field] !== undefined && safe[field] !== null) {
      hadSecrets = true;
    }
    delete safe[field];
  }

  if (safe.openapi && typeof safe.openapi === 'object') {
    const openapi = safe.openapi as Record<string, unknown>;
    if ('security' in openapi) {
      hadSecrets = true;
    }
    safe.openapi = stripOpenApiSecrets(openapi);
  }

  // Explicit marker so callers (and the dashboard) can tell a restricted view
  // apart from "this server genuinely has no credentials".
  if (hadSecrets || !('configRestricted' in safe)) {
    return { ...safe, configRestricted: true };
  }
  return safe;
};

const presentSafeServerInfoOauth = (
  oauth: Record<string, unknown>,
): Record<string, unknown> => {
  const safeOauth: Record<string, unknown> = {};
  for (const key of SAFE_SERVER_INFO_OAUTH_KEYS) {
    if (oauth[key] !== undefined) {
      safeOauth[key] = oauth[key];
    }
  }
  return safeOauth;
};

// Present a raw ServerConfig/DAO record for a principal: full deep copy when
// the principal may read configuration, otherwise the safe view. The input is
// never mutated. Callers decide independently whether the principal may see
// the server at all (403 handling stays with them).
export const presentServerForPrincipal = <T extends object>(
  config: T,
  principal?: RequestPrincipal,
): PresentedServer<T> => {
  if (authorizationService.can('server.config.read', config as ServerConfigLike, principal)) {
    return { view: 'full', data: clone(config) };
  }
  return { view: 'safe', data: presentSafeServerConfig(config as ServerConfigLike) as T };
};

// Present a ServerInfo-shaped list entry: metadata stays, but OAuth session
// fields are withheld from principals who may not read the full config.
export const presentServerInfoForPrincipal = <T extends object>(
  info: T,
  principal?: RequestPrincipal,
): T => {
  if (authorizationService.can('server.config.read', info as ServerConfigLike, principal)) {
    return info;
  }

  const oauth = (info as ServerConfigLike).oauth;
  if (!oauth || typeof oauth !== 'object') {
    return info;
  }

  return {
    ...(info as ServerConfigLike),
    oauth: presentSafeServerInfoOauth(oauth as Record<string, unknown>),
  } as T;
};
