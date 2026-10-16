import type { ServerConfig } from '../types';

type ServerLike = {
  owner?: string;
};

type UserLike = {
  username: string;
  isAdmin?: boolean;
} | null | undefined;

export const canManageServer = (server: ServerLike, user: UserLike): boolean => {
  if (!user) {
    return false;
  }

  if (user.isAdmin) {
    return true;
  }

  return Boolean(server.owner && server.owner === user.username);
};

// Mirror the backend's isPrivilegedServerConfig; parity is covered by tests.
export const getServerConfigPermissionError = (
  config: ServerConfig,
  isAdmin?: boolean,
): string | null => {
  if (isAdmin === true) return null;
  if (config.oauth?.allowInsecureTokenEndpoint === true) {
    return 'server.httpOAuthRequiresAdmin';
  }
  if (
    config.type === 'stdio' ||
    config.command ||
    (Array.isArray(config.args) && config.args.length > 0) ||
    (!config.url && !config.openapi?.url && !config.openapi?.schema)
  ) {
    return 'server.localExecutionRequiresAdmin';
  }
  return null;
};
