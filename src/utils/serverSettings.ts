import type { ServerConfigWithName } from '../dao/ServerDao.js';
import type { McpSettings } from '../types/index.js';

export const serializeServersForSettings = (
  servers: ServerConfigWithName[],
): McpSettings['mcpServers'] => {
  const nameCounts = new Map<string, number>();
  for (const server of servers) {
    nameCounts.set(server.name, (nameCounts.get(server.name) ?? 0) + 1);
  }

  const result: McpSettings['mcpServers'] = {};
  for (const server of servers) {
    const { id, name, ...config } = server;
    const key = nameCounts.get(name) === 1 ? name : id;
    result[key] = {
      ...(key === name ? {} : { name }),
      ...config,
    };
  }
  return result;
};
