import { Server } from '@/types';

type ServerListPatch = {
  enabled?: boolean;
  visibility?: Server['visibility'];
};

export const applyServerListPatch = (
  servers: Server[],
  serverIdentifier: string,
  patch: ServerListPatch,
): Server[] =>
  servers.map((server) => {
    if ((server.id ?? server.name) !== serverIdentifier) {
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
