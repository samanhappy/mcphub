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
