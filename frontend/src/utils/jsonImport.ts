import type { ServerConfig } from '../types';

export interface ImportJsonFormat {
  mcpServers: Record<string, ServerConfig>;
}

export const normalizeImportedServers = (parsed: ImportJsonFormat) => {
  return Object.entries(parsed.mcpServers).map(([name, config]) => {
    const normalizedConfig: Partial<ServerConfig> = {};

    if (config.type === 'sse' || config.type === 'streamable-http') {
      normalizedConfig.type = config.type;
      normalizedConfig.url = config.url;
      if (config.headers) {
        normalizedConfig.headers = config.headers;
      }
    } else if (config.type === 'openapi') {
      normalizedConfig.type = 'openapi';
      normalizedConfig.openapi = config.openapi;
    } else {
      normalizedConfig.type = 'stdio';
      normalizedConfig.command = config.command;
      normalizedConfig.args = config.args || [];
      if (config.env) {
        normalizedConfig.env = config.env;
      }
      if (config.options) {
        normalizedConfig.options = config.options;
      }
    }

    return { name, config: normalizedConfig };
  });
};
