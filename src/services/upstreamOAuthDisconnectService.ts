import type { ServerConfig } from '../types/index.js';
import { getRegisteredClient, removeRegisteredClient } from './oauthClientRegistration.js';
import { clearOAuthData, loadServerConfig } from './oauthSettingsStore.js';
import { resetServerOAuthConnection } from './mcpService.js';

export type UpstreamOAuthDisconnectScope = 'tokens' | 'all';

interface RevokeableToken {
  token: string;
  hint: 'access_token' | 'refresh_token';
}

export interface UpstreamOAuthDisconnectResult {
  success: true;
  scope: UpstreamOAuthDisconnectScope;
  revoked: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
  revocationEndpoint?: string;
}

const getCachedRevocationEndpoint = (serverName: string): string | undefined => {
  try {
    return getRegisteredClient(serverName)?.config.serverMetadata().revocation_endpoint;
  } catch (error) {
    console.warn('Failed to read cached OAuth server metadata', { serverName, error });
    return undefined;
  }
};

const getRevocationEndpoint = (
  serverName: string,
  serverConfig: ServerConfig,
): string | undefined =>
  serverConfig.oauth?.revocationEndpoint || getCachedRevocationEndpoint(serverName);

const getTokensToRevoke = (serverConfig: ServerConfig): RevokeableToken[] => {
  const tokens: RevokeableToken[] = [];
  const seen = new Set<string>();

  const addToken = (token: string | undefined, hint: RevokeableToken['hint']) => {
    if (!token || seen.has(token)) {
      return;
    }
    seen.add(token);
    tokens.push({ token, hint });
  };

  addToken(serverConfig.oauth?.refreshToken, 'refresh_token');
  addToken(serverConfig.oauth?.accessToken, 'access_token');

  return tokens;
};

const revokeToken = async (
  endpoint: string,
  serverConfig: ServerConfig,
  token: RevokeableToken,
): Promise<boolean> => {
  if (typeof fetch !== 'function') {
    return false;
  }

  const body = new URLSearchParams({
    token: token.token,
    token_type_hint: token.hint,
  });

  if (serverConfig.oauth?.clientId) {
    body.set('client_id', serverConfig.oauth.clientId);
  }
  if (serverConfig.oauth?.clientSecret) {
    body.set('client_secret', serverConfig.oauth.clientSecret);
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      console.warn('OAuth token revocation failed', {
        endpoint,
        status: response.status,
        tokenTypeHint: token.hint,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.warn('OAuth token revocation request failed', {
      endpoint,
      tokenTypeHint: token.hint,
      error,
    });
    return false;
  }
};

export const disconnectUpstreamOAuth = async (
  serverName: string,
  options?: { scope?: UpstreamOAuthDisconnectScope },
): Promise<UpstreamOAuthDisconnectResult> => {
  const scope = options?.scope ?? 'tokens';
  const serverConfig = await loadServerConfig(serverName);

  if (!serverConfig) {
    throw new Error(`Server not found: ${serverName}`);
  }

  const revocationEndpoint = getRevocationEndpoint(serverName, serverConfig);
  const tokens = getTokensToRevoke(serverConfig);
  let succeeded = 0;

  if (revocationEndpoint) {
    for (const token of tokens) {
      if (await revokeToken(revocationEndpoint, serverConfig, token)) {
        succeeded += 1;
      }
    }
  }

  if (scope === 'all') {
    removeRegisteredClient(serverName);
  }

  await clearOAuthData(serverName, scope);
  resetServerOAuthConnection(serverName);

  const attempted = revocationEndpoint ? tokens.length : 0;

  return {
    success: true,
    scope,
    revoked: {
      attempted,
      succeeded,
      failed: attempted - succeeded,
    },
    ...(revocationEndpoint ? { revocationEndpoint } : {}),
  };
};
