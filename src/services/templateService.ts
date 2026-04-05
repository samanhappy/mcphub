import {
  ConfigTemplate,
  TemplateServerConfig,
  TemplateGroup,
  TemplateExportOptions,
  TemplateImportResult,
  TemplateImportDetail,
  IGroupServerConfig,
  ServerConfig,
} from '../types/index.js';
import { getServerDao, getGroupDao } from '../dao/index.js';
import { createGroup } from './groupService.js';
import { addServer } from './mcpService.js';

const TEMPLATE_VERSION = '1.0';

// Env var placeholder pattern: ${VAR_NAME}
const ENV_PLACEHOLDER_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

type TemplateOAuthConfig = NonNullable<TemplateServerConfig['oauth']>;
type TemplateOpenApiConfig = NonNullable<TemplateServerConfig['openapi']>;
type TemplateOpenApiSecurityConfig = NonNullable<TemplateOpenApiConfig['security']>;

// Fields that commonly contain secrets and should be replaced with placeholders
const SECRET_ENV_KEYS = new Set([
  'api_key', 'apikey', 'secret', 'token', 'password', 'passwd',
  'access_key', 'secret_key', 'private_key', 'auth',
]);

function extractPlaceholderName(value: string): string | null {
  const match = value.match(/^\$\{(.+)\}$/);
  return match ? match[1] : null;
}

function toPlaceholderName(value: string, fallback: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function sanitizeSecretValue(value: string, placeholder: string): {
  sanitizedValue: string;
  placeholder: string;
} {
  const existingPlaceholder = extractPlaceholderName(value);
  if (existingPlaceholder) {
    return {
      sanitizedValue: value,
      placeholder: existingPlaceholder,
    };
  }

  return {
    sanitizedValue: `\${${placeholder}}`,
    placeholder,
  };
}

function cloneJsonObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_ENV_KEYS.has(lower) ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('password') ||
    lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('auth_key');
}

/**
 * Strip secrets from a server config's env vars.
 * Values that are already ${PLACEHOLDER} are kept as-is.
 * Values for keys that look like secrets are replaced with ${KEY_NAME}.
 */
function stripEnvSecrets(env: Record<string, string>): {
  sanitized: Record<string, string>;
  placeholders: string[];
} {
  const sanitized: Record<string, string> = {};
  const placeholders: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    const existingPlaceholder = extractPlaceholderName(value);

    if (existingPlaceholder) {
      // Already a placeholder — keep as-is
      sanitized[key] = value;
      placeholders.push(existingPlaceholder);
    } else if (isSecretKey(key)) {
      // Replace with placeholder
      const { sanitizedValue, placeholder } = sanitizeSecretValue(value, key);
      sanitized[key] = sanitizedValue;
      placeholders.push(placeholder);
    } else {
      sanitized[key] = value;
    }
  }

  return { sanitized, placeholders };
}

/**
 * Strip secrets from header values.
 */
function stripHeaderSecrets(headers: Record<string, string>): {
  sanitized: Record<string, string>;
  placeholders: string[];
} {
  const sanitized: Record<string, string> = {};
  const placeholders: string[] = [];

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower.includes('token') || lower.includes('auth')) {
      const placeholder = toPlaceholderName(key, 'HEADER_SECRET');
      const { sanitizedValue, placeholder: placeholderName } = sanitizeSecretValue(value, placeholder);
      sanitized[key] = sanitizedValue;
      placeholders.push(placeholderName);
    } else if (ENV_PLACEHOLDER_RE.test(value)) {
      sanitized[key] = value;
      const existingPlaceholder = extractPlaceholderName(value);
      if (existingPlaceholder) placeholders.push(existingPlaceholder);
    } else {
      sanitized[key] = value;
    }
  }

  return { sanitized, placeholders };
}

function stripProxySecrets(proxy: NonNullable<ServerConfig['proxy']>): {
  sanitized: NonNullable<TemplateServerConfig['proxy']>;
  placeholders: string[];
} {
  const sanitized: NonNullable<TemplateServerConfig['proxy']> = { ...proxy };
  const placeholders: string[] = [];

  if (proxy.password) {
    const { sanitizedValue, placeholder } = sanitizeSecretValue(proxy.password, 'PROXY_PASSWORD');
    sanitized.password = sanitizedValue;
    placeholders.push(placeholder);
  }

  return { sanitized, placeholders };
}

function stripOAuthSecrets(oauth: NonNullable<ServerConfig['oauth']>): {
  sanitized: TemplateOAuthConfig;
  placeholders: string[];
} {
  const sanitized: TemplateOAuthConfig = {};
  const placeholders: string[] = [];

  if (oauth.clientId) sanitized.clientId = oauth.clientId;
  if (oauth.scopes) sanitized.scopes = [...oauth.scopes];
  if (oauth.resource) sanitized.resource = oauth.resource;
  if (oauth.authorizationEndpoint) sanitized.authorizationEndpoint = oauth.authorizationEndpoint;
  if (oauth.tokenEndpoint) sanitized.tokenEndpoint = oauth.tokenEndpoint;

  if (oauth.clientSecret) {
    const { sanitizedValue, placeholder } = sanitizeSecretValue(
      oauth.clientSecret,
      'OAUTH_CLIENT_SECRET',
    );
    sanitized.clientSecret = sanitizedValue;
    placeholders.push(placeholder);
  }

  if (oauth.accessToken) {
    const { sanitizedValue, placeholder } = sanitizeSecretValue(
      oauth.accessToken,
      'OAUTH_ACCESS_TOKEN',
    );
    sanitized.accessToken = sanitizedValue;
    placeholders.push(placeholder);
  }

  if (oauth.refreshToken) {
    const { sanitizedValue, placeholder } = sanitizeSecretValue(
      oauth.refreshToken,
      'OAUTH_REFRESH_TOKEN',
    );
    sanitized.refreshToken = sanitizedValue;
    placeholders.push(placeholder);
  }

  if (oauth.dynamicRegistration) {
    sanitized.dynamicRegistration = {};
    if (oauth.dynamicRegistration.enabled !== undefined) {
      sanitized.dynamicRegistration.enabled = oauth.dynamicRegistration.enabled;
    }
    if (oauth.dynamicRegistration.issuer) {
      sanitized.dynamicRegistration.issuer = oauth.dynamicRegistration.issuer;
    }
    if (oauth.dynamicRegistration.registrationEndpoint) {
      sanitized.dynamicRegistration.registrationEndpoint =
        oauth.dynamicRegistration.registrationEndpoint;
    }
    if (oauth.dynamicRegistration.metadata) {
      sanitized.dynamicRegistration.metadata = cloneJsonObject(oauth.dynamicRegistration.metadata);
    }
    if (oauth.dynamicRegistration.initialAccessToken) {
      const { sanitizedValue, placeholder } = sanitizeSecretValue(
        oauth.dynamicRegistration.initialAccessToken,
        'OAUTH_INITIAL_ACCESS_TOKEN',
      );
      sanitized.dynamicRegistration.initialAccessToken = sanitizedValue;
      placeholders.push(placeholder);
    }
  }

  return { sanitized, placeholders };
}

function stripOpenApiSecuritySecrets(
  security: NonNullable<NonNullable<ServerConfig['openapi']>['security']>,
): {
  sanitized: TemplateOpenApiSecurityConfig;
  placeholders: string[];
} {
  const sanitized: TemplateOpenApiSecurityConfig = { type: security.type };
  const placeholders: string[] = [];

  if (security.apiKey) {
    sanitized.apiKey = {
      name: security.apiKey.name,
      in: security.apiKey.in,
      value: security.apiKey.value,
    };
    if (security.apiKey.value) {
      const { sanitizedValue, placeholder } = sanitizeSecretValue(
        security.apiKey.value,
        toPlaceholderName(security.apiKey.name, 'OPENAPI_API_KEY'),
      );
      sanitized.apiKey.value = sanitizedValue;
      placeholders.push(placeholder);
    }
  }

  if (security.http) {
    sanitized.http = {
      scheme: security.http.scheme,
    };
    if (security.http.bearerFormat) {
      sanitized.http.bearerFormat = security.http.bearerFormat;
    }
    if (security.http.credentials) {
      const { sanitizedValue, placeholder } = sanitizeSecretValue(
        security.http.credentials,
        'OPENAPI_HTTP_CREDENTIALS',
      );
      sanitized.http.credentials = sanitizedValue;
      placeholders.push(placeholder);
    }
  }

  if (security.oauth2) {
    sanitized.oauth2 = {};
    if (security.oauth2.tokenUrl) sanitized.oauth2.tokenUrl = security.oauth2.tokenUrl;
    if (security.oauth2.clientId) sanitized.oauth2.clientId = security.oauth2.clientId;
    if (security.oauth2.scopes) sanitized.oauth2.scopes = [...security.oauth2.scopes];

    if (security.oauth2.clientSecret) {
      const { sanitizedValue, placeholder } = sanitizeSecretValue(
        security.oauth2.clientSecret,
        'OPENAPI_OAUTH2_CLIENT_SECRET',
      );
      sanitized.oauth2.clientSecret = sanitizedValue;
      placeholders.push(placeholder);
    }

    if (security.oauth2.token) {
      const { sanitizedValue, placeholder } = sanitizeSecretValue(
        security.oauth2.token,
        'OPENAPI_OAUTH2_TOKEN',
      );
      sanitized.oauth2.token = sanitizedValue;
      placeholders.push(placeholder);
    }
  }

  if (security.openIdConnect) {
    sanitized.openIdConnect = {
      url: security.openIdConnect.url,
    };
    if (security.openIdConnect.clientId) {
      sanitized.openIdConnect.clientId = security.openIdConnect.clientId;
    }
    if (security.openIdConnect.clientSecret) {
      const { sanitizedValue, placeholder } = sanitizeSecretValue(
        security.openIdConnect.clientSecret,
        'OPENAPI_OPENID_CLIENT_SECRET',
      );
      sanitized.openIdConnect.clientSecret = sanitizedValue;
      placeholders.push(placeholder);
    }
    if (security.openIdConnect.token) {
      const { sanitizedValue, placeholder } = sanitizeSecretValue(
        security.openIdConnect.token,
        'OPENAPI_OPENID_TOKEN',
      );
      sanitized.openIdConnect.token = sanitizedValue;
      placeholders.push(placeholder);
    }
  }

  return { sanitized, placeholders };
}

/**
 * Convert a full ServerConfig to a TemplateServerConfig with secrets stripped.
 */
function serverConfigToTemplate(config: ServerConfig): {
  templateConfig: TemplateServerConfig;
  envVars: string[];
} {
  const envVars: string[] = [];
  const templateConfig: TemplateServerConfig = {};

  if (config.type) templateConfig.type = config.type;
  if (config.description) templateConfig.description = config.description;
  if (config.url) templateConfig.url = config.url;
  if (config.command) templateConfig.command = config.command;
  if (config.args) templateConfig.args = [...config.args];
  if (config.passthroughHeaders) templateConfig.passthroughHeaders = [...config.passthroughHeaders];
  if (config.enabled !== undefined) templateConfig.enabled = config.enabled;
  if (config.enableKeepAlive !== undefined) templateConfig.enableKeepAlive = config.enableKeepAlive;
  if (config.keepAliveInterval !== undefined) {
    templateConfig.keepAliveInterval = config.keepAliveInterval;
  }

  if (config.env) {
    const { sanitized, placeholders } = stripEnvSecrets(config.env);
    templateConfig.env = sanitized;
    envVars.push(...placeholders);
  }

  if (config.headers) {
    const { sanitized, placeholders } = stripHeaderSecrets(config.headers);
    templateConfig.headers = sanitized;
    envVars.push(...placeholders);
  }

  if (config.tools) templateConfig.tools = { ...config.tools };
  if (config.prompts) templateConfig.prompts = { ...config.prompts };
  if (config.resources) templateConfig.resources = { ...config.resources };
  if (config.options) templateConfig.options = { ...config.options };
  if (config.proxy) {
    const { sanitized, placeholders } = stripProxySecrets(config.proxy);
    templateConfig.proxy = sanitized;
    envVars.push(...placeholders);
  }
  if (config.oauth) {
    const { sanitized, placeholders } = stripOAuthSecrets(config.oauth);
    templateConfig.oauth = sanitized;
    envVars.push(...placeholders);
  }

  if (config.openapi) {
    templateConfig.openapi = {};
    if (config.openapi.url) templateConfig.openapi.url = config.openapi.url;
    if (config.openapi.schema) templateConfig.openapi.schema = cloneJsonObject(config.openapi.schema);
    if (config.openapi.version) templateConfig.openapi.version = config.openapi.version;
    if (config.openapi.passthroughHeaders) {
      templateConfig.openapi.passthroughHeaders = [...config.openapi.passthroughHeaders];
    }
    if (config.openapi.security) {
      const { sanitized, placeholders } = stripOpenApiSecuritySecrets(config.openapi.security);
      templateConfig.openapi.security = sanitized;
      envVars.push(...placeholders);
    }
  }

  return { templateConfig, envVars };
}

/**
 * Export configuration as a shareable template.
 */
export async function exportTemplate(options: TemplateExportOptions): Promise<ConfigTemplate> {
  const serverDao = getServerDao();
  const groupDao = getGroupDao();

  const allServers = await serverDao.findAll();
  const allGroups = await groupDao.findAll();

  // Determine which groups to include
  const selectedGroups = options.groupIds?.length
    ? allGroups.filter((g) => options.groupIds!.includes(g.id))
    : allGroups;

  // Collect server names referenced by selected groups
  const referencedServerNames = new Set<string>();
  const normalizedGroups = selectedGroups.map((group) => ({
    name: group.name,
    description: group.description,
    servers: group.servers.map((s) =>
      typeof s === 'string'
        ? { name: s, tools: 'all' as const, prompts: 'all' as const, resources: 'all' as const }
        : {
            name: s.name,
            tools: s.tools || 'all',
            prompts: s.prompts || 'all',
            resources: s.resources || 'all',
          },
    ),
  }));

  for (const group of normalizedGroups) {
    for (const sc of group.servers) {
      referencedServerNames.add(sc.name);
    }
  }

  // Build server configs for template
  const templateServers: Record<string, TemplateServerConfig> = {};
  const allEnvVars: string[] = [];
  const includedServerNames = new Set<string>();

  for (const server of allServers) {
    if (!referencedServerNames.has(server.name)) continue;
    if (!options.includeDisabledServers && server.enabled === false) continue;

    const { templateConfig, envVars } = serverConfigToTemplate(server);
    templateServers[server.name] = templateConfig;
    includedServerNames.add(server.name);
    allEnvVars.push(...envVars);
  }

  const templateGroups: TemplateGroup[] = normalizedGroups.map((group) => ({
    ...group,
    servers: group.servers.filter((server) => includedServerNames.has(server.name)),
  }));

  // De-duplicate env vars
  const requiredEnvVars = [...new Set(allEnvVars)].sort();

  return {
    version: TEMPLATE_VERSION,
    name: options.name,
    description: options.description,
    createdAt: new Date().toISOString(),
    servers: templateServers,
    groups: templateGroups,
    requiredEnvVars,
  };
}

/**
 * Export a single group as a template.
 */
export async function exportGroupTemplate(
  groupId: string,
  name?: string,
): Promise<ConfigTemplate | null> {
  const groupDao = getGroupDao();
  const group = await groupDao.findById(groupId);
  if (!group) return null;

  return exportTemplate({
    name: name || `${group.name} Template`,
    description: `Template exported from group "${group.name}"`,
    groupIds: [groupId],
    includeDisabledServers: false,
  });
}

/**
 * Validate a template structure before import.
 */
function validateTemplate(data: unknown): data is ConfigTemplate {
  if (!data || typeof data !== 'object') return false;
  const t = data as Record<string, unknown>;
  if (typeof t.version !== 'string') return false;
  if (typeof t.name !== 'string') return false;
  if (!t.servers || typeof t.servers !== 'object') return false;
  if (!Array.isArray(t.groups)) return false;
  return true;
}

/**
 * Import a configuration template.
 * Creates servers and groups that don't already exist.
 */
export async function importTemplate(
  template: unknown,
  owner?: string,
): Promise<TemplateImportResult> {
  if (!validateTemplate(template)) {
    return {
      success: false,
      serversCreated: 0,
      serversSkipped: 0,
      groupsCreated: 0,
      groupsSkipped: 0,
      requiredEnvVars: [],
      details: [{ type: 'server', name: '', action: 'failed', message: 'Invalid template format' }],
    };
  }

  const serverDao = getServerDao();
  const groupDao = getGroupDao();

  const existingServers = await serverDao.findAll();
  const existingServerNames = new Set(existingServers.map((s) => s.name));

  const details: TemplateImportDetail[] = [];
  let serversCreated = 0;
  let serversSkipped = 0;

  // Import servers
  for (const [name, config] of Object.entries(template.servers)) {
    if (existingServerNames.has(name)) {
      details.push({ type: 'server', name, action: 'skipped', message: 'Server already exists' });
      serversSkipped++;
      continue;
    }

    try {
      const serverConfig: ServerConfig = {
        ...config,
        enabled: config.enabled ?? true,
        owner: owner || 'admin',
      };
      await addServer(name, serverConfig);
      details.push({ type: 'server', name, action: 'created' });
      serversCreated++;
    } catch (error) {
      details.push({
        type: 'server',
        name,
        action: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Import groups
  let groupsCreated = 0;
  let groupsSkipped = 0;

  for (const groupDef of template.groups) {
    const existingGroup = await groupDao.findByName(groupDef.name);
    if (existingGroup) {
      details.push({ type: 'group', name: groupDef.name, action: 'skipped', message: 'Group already exists' });
      groupsSkipped++;
      continue;
    }

    try {
      const result = await createGroup(
        groupDef.name,
        groupDef.description,
        groupDef.servers,
        owner || 'admin',
      );
      if (result) {
        details.push({ type: 'group', name: groupDef.name, action: 'created' });
        groupsCreated++;
      } else {
        details.push({ type: 'group', name: groupDef.name, action: 'failed', message: 'Failed to create group' });
      }
    } catch (error) {
      details.push({
        type: 'group',
        name: groupDef.name,
        action: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    success: serversCreated > 0 || groupsCreated > 0,
    serversCreated,
    serversSkipped,
    groupsCreated,
    groupsSkipped,
    requiredEnvVars: template.requiredEnvVars || [],
    details,
  };
}
