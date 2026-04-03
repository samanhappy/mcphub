import { ServerConfig } from '../types/index.js';

const trimToUndefined = (value?: string): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeRecord = (
  value?: Record<string, string>,
): Record<string, string> | undefined => {
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

const normalizeOptions = (
  options?: ServerConfig['options'],
): ServerConfig['options'] | undefined => {
  if (!options) {
    return undefined;
  }

  const normalized: NonNullable<ServerConfig['options']> = {};

  if (typeof options.timeout === 'number' && !Number.isNaN(options.timeout)) {
    normalized.timeout = options.timeout;
  }

  if (typeof options.resetTimeoutOnProgress === 'boolean') {
    normalized.resetTimeoutOnProgress = options.resetTimeoutOnProgress;
  }

  if (typeof options.maxTotalTimeout === 'number' && !Number.isNaN(options.maxTotalTimeout)) {
    normalized.maxTotalTimeout = options.maxTotalTimeout;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeOAuth = (
  oauth?: ServerConfig['oauth'],
): ServerConfig['oauth'] | undefined => {
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

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const inferServerType = (
  config: ServerConfig,
): NonNullable<ServerConfig['type']> | undefined => {
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
  const options = normalizeOptions(config.options);
  const oauth = normalizeOAuth(config.oauth);
  const openapi = normalizeOpenApi(config.openapi);

  const normalized: ServerConfig = {
    ...config,
    type: normalizedType,
    description,
    owner,
    options,
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
    normalized.url = url;
    normalized.command = undefined;
    normalized.args = undefined;
    normalized.env = env;
    normalized.headers = headers;
    normalized.passthroughHeaders = passthroughHeaders;
    normalized.oauth = oauth;
    normalized.enableKeepAlive = config.enableKeepAlive === true;
    normalized.keepAliveInterval =
      config.enableKeepAlive === true ? config.keepAliveInterval || 60000 : undefined;
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