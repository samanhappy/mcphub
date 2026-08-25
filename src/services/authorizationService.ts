import { IUser, ServerVisibility } from '../types/index.js';
import { DataService } from './dataService.js';
import { UserContextService } from './userContextService.js';

// Phase 1 authorization boundary for issue #1036: server usage
// (discover/invoke) is a separate decision from configuration disclosure
// (config.read/manage). Discover/invoke delegate to the same visibility rules
// that gate runtime tool routing (DataService.filterData), so there is a single
// source of truth for who can see a server.
export type ServerAuthorizationAction =
  | 'server.discover'
  | 'server.invoke'
  | 'server.config.read'
  | 'server.manage';

// Minimal structural shape needed to authorize a server. Compatible with
// ServerConfig, ServerInfo and DAO server records.
export interface AuthorizableServer {
  owner?: string;
  visibility?: ServerVisibility;
  sharedWithUsers?: string[];
}

export type RequestPrincipal = Pick<IUser, 'username'> & { isAdmin?: boolean } | null;

// Records may predate owner tracking; those are administered by the 'admin'
// account (same normalization as the share-candidates endpoint).
const effectiveOwner = (server: AuthorizableServer): string => server.owner?.trim() || 'admin';

const resolvePrincipal = (principal?: RequestPrincipal): RequestPrincipal =>
  principal ?? UserContextService.getInstance().getCurrentUser();

export class AuthorizationService {
  can(
    action: ServerAuthorizationAction,
    server: AuthorizableServer,
    principal?: RequestPrincipal,
  ): boolean {
    const user = resolvePrincipal(principal);
    if (!user?.username) {
      return false;
    }

    switch (action) {
      case 'server.config.read':
      case 'server.manage':
        return Boolean(user.isAdmin) || user.username === effectiveOwner(server);
      case 'server.discover':
      case 'server.invoke':
        return new DataService().filterData([server], user as IUser).length > 0;
    }
  }
}

export const authorizationService = new AuthorizationService();
