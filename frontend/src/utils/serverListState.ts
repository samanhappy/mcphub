import { Server } from '@/types';

type ServerListPatch = {
  enabled?: boolean;
  visibility?: Server['visibility'];
};

export const applyServerListPatch = (
  servers: Server[],
  serverName: string,
  patch: ServerListPatch,
): Server[] =>
  servers.map((server) => {
    if (server.name !== serverName) {
      return server;
    }

    return {
      ...server,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      config: server.config
        ? {
            ...server.config,
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
          }
        : server.config,
    };
  });