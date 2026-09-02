import { authorizationService, RequestPrincipal } from './authorizationService.js';

// Safe server representation for issue #1036 Phase 1: shared users may see a
// server's metadata but never its connection configuration. The restricted
// view is an explicit ALLOWLIST — newly added ServerConfig fields are withheld
// by default until they are reviewed and added here. Redaction is enforced
// server-side; the dashboard is never the security boundary.

type ServerConfigLike = Record<string, unknown>;

export interface PresentedServer<T> {
  view: 'full' | 'safe';
  data: T;
}

// Metadata a shared user legitimately needs. Everything else — including
// url, command, args, env, headers, oauth, proxy, openapi, options and any
// unrecognized future field — is withheld.
const SAFE_SERVER_CONFIG_FIELDS = [
  'name',
  'description',
  'type',
  'visibility',
  'owner',
  'enabled',
  'tools',
  'prompts',
  'resources',
  'credentialTemplate',
] as const;

// OAuth session-recovery fields exposed on ServerInfo list entries; only the
// connected/clientIdConfigured indicators are safe for non-config-readers.
const SAFE_SERVER_INFO_OAUTH_KEYS = ['connected', 'clientIdConfigured'] as const;

const clone = <T>(value: T): T =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

const presentSafeServerConfig = (config: ServerConfigLike): ServerConfigLike => {
  const safe: Record<string, unknown> = {};
  for (const field of SAFE_SERVER_CONFIG_FIELDS) {
    if (config[field] !== undefined && config[field] !== null) {
      safe[field] = clone(config[field]);
    }
  }
  // Explicit marker so callers (and the dashboard) can tell a restricted view
  // apart from "this server genuinely has no credentials".
  return { ...safe, configRestricted: true };
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
  principal?: RequestPrincipal | null,
): PresentedServer<T> => {
  if (authorizationService.can('server.config.read', config as ServerConfigLike, principal)) {
    return { view: 'full', data: clone(config) };
  }
  return { view: 'safe', data: presentSafeServerConfig(config as ServerConfigLike) as T };
};

// Generic placeholder for runtime connection errors shown to principals who
// may not read the full configuration. Upstream/transport error text can
// contain connection URLs, tokens, or internal paths, and heuristic redaction
// cannot guarantee arbitrary secrets are removed — so the raw value is
// withheld entirely (fail closed). `status` stays untouched so shared users
// can still tell connected/connecting/disconnected/oauth_required apart.
export const SAFE_RUNTIME_ERROR_MESSAGE = 'Server connection failed';

const presentSafeRuntimeError = (error: unknown): unknown => {
  if (error === null || error === undefined) {
    return error;
  }
  return SAFE_RUNTIME_ERROR_MESSAGE;
};

// Present a ServerInfo-shaped list entry: runtime metadata stays, but OAuth
// session fields, the embedded connection config, and raw runtime error text
// are reduced to their safe subsets for principals who may not read the full
// configuration.
export const presentServerInfoForPrincipal = <T extends object>(
  info: T,
  principal?: RequestPrincipal | null,
): T => {
  if (authorizationService.can('server.config.read', info as ServerConfigLike, principal)) {
    return info;
  }

  const entry = { ...(info as ServerConfigLike) };

  if (entry.oauth && typeof entry.oauth === 'object') {
    entry.oauth = presentSafeServerInfoOauth(entry.oauth as Record<string, unknown>);
  }

  if (entry.config && typeof entry.config === 'object') {
    entry.config = presentSafeServerConfig(entry.config as ServerConfigLike);
  }

  if ('error' in entry) {
    entry.error = presentSafeRuntimeError(entry.error);
  }

  return entry as T;
};
