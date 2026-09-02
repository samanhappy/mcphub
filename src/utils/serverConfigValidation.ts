import { ServerConfig } from '../types/index.js';

/**
 * A config is privileged when it can execute arbitrary host commands:
 * `stdio` servers spawn `command`/`args` locally as the MCPHub process, and
 * any config without a remote target (url or OpenAPI definition) is treated
 * as stdio-shaped. Only admins may create or modify such servers.
 */
export const isPrivilegedServerConfig = (config: ServerConfig): boolean => {
  return Boolean(
    config.type === 'stdio' ||
      config.command ||
      (Array.isArray(config.args) && config.args.length > 0) ||
      (!config.url && !config.openapi?.url && !config.openapi?.schema),
  );
};

/**
 * Credential runtimes currently cover MCP stdio and MCP HTTP transports.
 * Header slots have no meaning for stdio, and OpenAPI has a separate request
 * client/lifecycle that is intentionally deferred from the MVP.
 */
export const getCredentialTemplateValidationError = (config: ServerConfig): string | null => {
  const template = config.credentialTemplate;
  if (!template) return null;
  const hasEnv = Object.keys(template.env || {}).length > 0;
  const hasHeaders = Object.keys(template.headers || {}).length > 0;
  if (!hasEnv && !hasHeaders) return null;

  const type = config.type || (config.openapi ? 'openapi' : config.url ? 'sse' : 'stdio');
  if (type === 'openapi') {
    return 'Per-user credential templates are not supported for OpenAPI servers yet';
  }
  if (type === 'stdio' && hasHeaders) {
    return 'STDIO per-user credential templates do not support header slots; use environment variable slots';
  }
  return null;
};
