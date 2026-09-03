import { ServerConfig } from '../types/index.js';

const trimToUndefined = (value?: string): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeRecord = (value?: Record<string, string>): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, recordValue]) => [key.trim(), recordValue] as const)
    .filter(([key]) => key.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeStringArray = (value?: string[]): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.map((item) => item.trim()).filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeSharedUsers = (value?: string[]): string[] | undefined => {
  const normalized = normalizeStringArray(value);
  return normalized ? Array.from(new Set(normalized)) : undefined;
};

/**
 * Unpacks the startOnDemand/idleTimeoutMs values mirrored into the `options`
 * blob by normalizeOptions() (see below) back to top-level fields, stripping
 * the mirrored keys out of the returned `options` so they don't leak into
 * plain MCP RequestOptions or resurface as file/API noise. Shared by both
 * ServerDaoDbImpl (unpacks on every DB read) and ServerDaoImpl (unpacks on
 * every JSON-file read), so both storage backends behave identically instead
 * of only stripping the mirrored keys in database mode.
 */
export const unpackStartOnDemandOptions = (
  options: ServerConfig['options'] | undefined,
): {
  options: ServerConfig['options'] | undefined;
  startOnDemand: boolean | undefined;
  idleTimeoutMs: number | undefined;
} => {
  if (!options) {
    return { options: undefined, startOnDemand: undefined, idleTimeoutMs: undefined };
  }

  const { startOnDemand: rawStartOnDemand, idleTimeoutMs: rawIdleTimeoutMs, ...rest } =
    options as Record<string, unknown>;

  return {
    options: Object.keys(rest).length > 0 ? (rest as ServerConfig['options']) : undefined,
    startOnDemand: rawStartOnDemand === true ? true : undefined,
    idleTimeoutMs: typeof rawIdleTimeoutMs === 'number' ? rawIdleTimeoutMs : undefined,
  };
};

/**
 * Merges startOnDemand/idleTimeoutMs into an `options` blob for storage,
 * without touching/re-validating any other keys already present in
 * `options` (unlike normalizeOptions() below, which only forwards a fixed
 * whitelist). Used by ServerDaoDbImpl itself as a persistence-layer safety
 * net: normalizeServerConfigForPersistence() is the primary place that does
 * this, but not every caller routes through it (e.g.
 * templateService.importTemplate() -> mcpService.addServer() calls
 * ServerDao.create()/update() directly), so the DAO mirrors the fields
 * unconditionally to guarantee they're never silently dropped in database
 * mode regardless of how the DAO was invoked.
 */
export const mirrorStartOnDemandIntoOptions = (
  options: ServerConfig['options'] | undefined,
  startOnDemand: boolean | undefined,
  idleTimeoutMs: number | undefined,
): ServerConfig['options'] | undefined => {
  const merged: Record<string, unknown> = { ...(options as Record<string, unknown> | undefined) };
  delete merged.startOnDemand;
  delete merged.idleTimeoutMs;

  if (startOnDemand === true) {
    merged.startOnDemand = true;
  }

  if (typeof idleTimeoutMs === 'number' && !Number.isNaN(idleTimeoutMs) && idleTimeoutMs > 0) {
    merged.idleTimeoutMs = idleTimeoutMs;
  }

  return Object.keys(merged).length > 0 ? (merged as ServerConfig['options']) : undefined;
};

const normalizeOptions = (
  options?: ServerConfig['options'],
  startOnDemand?: boolean,
  idleTimeoutMs?: number,
): ServerConfig['options'] | undefined => {
  const normalized: NonNullable<ServerConfig['options']> = {};

  if (options) {
    if (typeof options.timeout === 'number' && !Number.isNaN(options.timeout)) {
      normalized.timeout = options.timeout;
    }

    if (typeof options.resetTimeoutOnProgress === 'boolean') {
      normalized.resetTimeoutOnProgress = options.resetTimeoutOnProgress;
    }

    if (typeof options.maxTotalTimeout === 'number' && !Number.isNaN(options.maxTotalTimeout)) {
      normalized.maxTotalTimeout = options.maxTotalTimeout;
    }
  }

  // startOnDemand/idleTimeoutMs (#1012) are exposed as top-level ServerConfig
  // fields everywhere else in the codebase (mcpService.ts reads
  // config.startOnDemand / config.idleTimeoutMs directly), but the database-backed
  // ServerDaoDbImpl has no dedicated columns for them and previously dropped both
  // fields silently on every save when running with DB_URL configured (the default
  // production deployment mode) - see ServerDaoDbImpl create()/update(), which only
  // ever whitelisted the fixed set of known Server entity columns. Piggybacking
  // them onto the existing schema-less `options` JSON blob column persists them
  // without requiring a database migration. ServerDaoDbImpl.mapToServerConfig()
  // unpacks them back out to top-level fields on read.
  if (startOnDemand === true) {
    normalized.startOnDemand = true;
  }

  if (typeof idleTimeoutMs === 'number' && !Number.isNaN(idleTimeoutMs) && idleTimeoutMs > 0) {
    normalized.idleTimeoutMs = idleTimeoutMs;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeOAuth = (oauth?: ServerConfig['oauth']): ServerConfig['oauth'] | undefined => {
  if (!oauth) {
    return undefined;
  }

  const normalized: NonNullable<ServerConfig['oauth']> = {};

  const clientId = trimToUndefined(oauth.clientId);
  const clientSecret = trimToUndefined(oauth.clientSecret);
  const accessToken = trimToUndefined(oauth.accessToken);
  const refreshToken = trimToUndefined(oauth.refreshToken);
  const authorizationEndpoint = trimToUndefined(oauth.authorizationEndpoint);
  const tokenEndpoint = trimToUndefined(oauth.tokenEndpoint);
  const resource = trimToUndefined(oauth.resource);
  const scopes = normalizeStringArray(oauth.scopes);

  if (clientId) normalized.clientId = clientId;
  if (clientSecret) normalized.clientSecret = clientSecret;
  if (scopes) normalized.scopes = scopes;
  if (accessToken) normalized.accessToken = accessToken;
  if (refreshToken) normalized.refreshToken = refreshToken;
  if (authorizationEndpoint) normalized.authorizationEndpoint = authorizationEndpoint;
  if (tokenEndpoint) normalized.tokenEndpoint = tokenEndpoint;
  if (resource) normalized.resource = resource;

  if (oauth.dynamicRegistration) {
    normalized.dynamicRegistration = oauth.dynamicRegistration;
  }

  if (oauth.pendingAuthorization) {
    normalized.pendingAuthorization = oauth.pendingAuthorization;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeOpenApi = (
  openapi?: ServerConfig['openapi'],
): ServerConfig['openapi'] | undefined => {
  if (!openapi) {
    return undefined;
  }

  const normalized: NonNullable<ServerConfig['openapi']> = {};

  const url = trimToUndefined(openapi.url);
  const passthroughHeaders = normalizeStringArray(openapi.passthroughHeaders);

  if (url) {
    normalized.url = url;
  }

  if (openapi.schema) {
    normalized.schema = openapi.schema;
  }

  if (trimToUndefined(openapi.version)) {
    normalized.version = trimToUndefined(openapi.version);
  }

  if (openapi.security) {
    normalized.security = openapi.security;
  }

  if (passthroughHeaders) {
    normalized.passthroughHeaders = passthroughHeaders;
  }

  if (openapi.cookieSession === true) {
    normalized.cookieSession = true;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const inferServerType = (config: ServerConfig): NonNullable<ServerConfig['type']> | undefined => {
  if (config.type) {
    return config.type;
  }

  if (config.openapi?.url || config.openapi?.schema) {
    return 'openapi';
  }

  if (config.url) {
    return 'sse';
  }

  if (config.command || (Array.isArray(config.args) && config.args.length > 0)) {
    return 'stdio';
  }

  return undefined;
};

export const normalizeServerConfigForPersistence = (config: ServerConfig): ServerConfig => {
  const normalizedType = inferServerType(config);
  const description = trimToUndefined(config.description);
  const owner = trimToUndefined(config.owner) ?? config.owner;
  const url = trimToUndefined(config.url);
  const command = trimToUndefined(config.command);
  const args = Array.isArray(config.args) && config.args.length > 0 ? config.args : undefined;
  const env = normalizeRecord(config.env);
  const headers = normalizeRecord(config.headers);
  const passthroughHeaders = normalizeStringArray(config.passthroughHeaders);
  const options = normalizeOptions(
    config.options,
    config.startOnDemand === true,
    config.idleTimeoutMs,
  );
  const oauth = normalizeOAuth(config.oauth);
  const openapi = normalizeOpenApi(config.openapi);

  // Default visibility to 'private' so file-defined and freshly-created servers behave
  // identically to the pre-#817 implicit admin-only behaviour. Operators opt servers in
  // to 'public' or restricted 'group' sharing from the dashboard.
  const visibility = config.visibility ?? 'private';
  const sharedWithUsers =
    visibility === 'group' ? normalizeSharedUsers(config.sharedWithUsers) : undefined;

  const normalized: ServerConfig = {
    ...config,
    type: normalizedType,
    description,
    owner,
    visibility,
    sharedWithUsers,
    options,
    perSessionClient: config.perSessionClient === true ? true : undefined,
    // The dashboard sends `startOnDemand: undefined` when the toggle is off, which
    // JSON.stringify strips from the PUT body. Without an explicit key here the
    // DAO update's shallow merge ({...existing, ...updates}) treats the field as
    // "unchanged", so a previously-enabled on-demand server could never be turned
    // off - the toggle would still read enabled after save. Emit an explicit key
    // (matching perSessionClient above) so the old `true` is overwritten. See #1032.
    startOnDemand: config.startOnDemand === true ? true : undefined,
    // Keep the top-level value consistent with what actually gets mirrored into
    // `options` above: an invalid/non-positive idleTimeoutMs is dropped instead
    // of surviving as a meaningless top-level 0/NaN value that only JSON-mode
    // storage would otherwise preserve verbatim.
    idleTimeoutMs:
      typeof config.idleTimeoutMs === 'number' &&
      !Number.isNaN(config.idleTimeoutMs) &&
      config.idleTimeoutMs > 0
        ? config.idleTimeoutMs
        : undefined,
  };

  if (normalizedType === 'openapi') {
    normalized.url = undefined;
    normalized.command = undefined;
    normalized.args = undefined;
    normalized.env = undefined;
    normalized.headers = headers;
    normalized.passthroughHeaders = undefined;
    normalized.oauth = undefined;
    normalized.enableKeepAlive = undefined;
    normalized.keepAliveInterval = undefined;
    normalized.openapi = openapi;
    return normalized;
  }

  if (normalizedType === 'sse' || normalizedType === 'streamable-http') {
    const keepAliveEnabled = config.enableKeepAlive === true;

    normalized.url = url;
    normalized.command = undefined;
    normalized.args = undefined;
    normalized.env = env;
    normalized.headers = headers;
    normalized.passthroughHeaders = passthroughHeaders;
    normalized.oauth = oauth;
    normalized.enableKeepAlive = keepAliveEnabled;
    normalized.keepAliveInterval = keepAliveEnabled ? config.keepAliveInterval || 60000 : undefined;
    normalized.openapi = undefined;
    return normalized;
  }

  normalized.url = undefined;
  normalized.command = command;
  normalized.args = args;
  normalized.env = env;
  normalized.headers = undefined;
  normalized.passthroughHeaders = undefined;
  normalized.oauth = undefined;
  normalized.enableKeepAlive = undefined;
  normalized.keepAliveInterval = undefined;
  normalized.openapi = undefined;

  return normalized;
};
