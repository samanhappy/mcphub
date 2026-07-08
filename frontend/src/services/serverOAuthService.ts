import { apiPost } from '../utils/fetchInterceptor';

export type OAuthDisconnectScope = 'tokens' | 'all';

export const disconnectServerOAuth = (
  serverName: string,
  scope: OAuthDisconnectScope = 'tokens',
) =>
  apiPost(`/servers/${encodeURIComponent(serverName)}/oauth/disconnect`, {
    scope,
  });
