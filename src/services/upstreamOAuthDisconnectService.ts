import type { ServerConfig } from '../types/index.js';
import { getUserDao } from '../dao/DaoFactory.js';
import { assertSafeUrl, createRedirectValidatingFetch } from '../utils/ssrf.js';
import { summarizeErrorForLogging } from '../utils/serialization.js';
import { getRegisteredClient, removeRegisteredClient } from './oauthClientRegistration.js';
import { clearOAuthData, loadServerConfig } from './oauthSettingsStore.js';
import { getServerByName, reconnectServer, resetServerOAuthConnection } from './mcpService.js';

export type UpstreamOAuthDisconnectScope = 'tokens' | 'all';

const OAUTH_RECONNECT_WAIT_TIMEOUT_MS = 3000;
const OAUTH_RECONNECT_WAIT_INTERVAL_MS = 50;

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
    console.warn('Failed to read cached OAuth server metadata', {
      serverName,
      error: summarizeErrorForLogging(error),
    });
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
  allowInternal: boolean,
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
    await assertSafeUrl(endpoint, { allowInternal });
    const safeFetch = createRedirectValidatingFetch(fetch, allowInternal);
    const response = await safeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      console.warn('OAuth token revocation failed', {
        status: response.status,
        tokenTypeHint: token.hint,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.warn('OAuth token revocation request failed', {
      tokenTypeHint: token.hint,
      error: summarizeErrorForLogging(error),
    });
    return false;
  }
};

const canServerOwnerReachInternalUrls = async (serverConfig: ServerConfig): Promise<boolean> => {
  if (!serverConfig.owner) {
    return false;
  }

  try {
    const ownerUser = await getUserDao().findByUsername(serverConfig.owner);
    return Boolean(ownerUser?.isAdmin);
  } catch (error) {
    console.warn('Failed to load server owner while disconnecting upstream OAuth', {
      serverName: serverConfig.owner,
      error: summarizeErrorForLogging(error),
    });
    return false;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForFreshAuthorizationUrl = async (serverName: string): Promise<void> => {
  const deadline = Date.now() + OAUTH_RECONNECT_WAIT_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    const serverInfo = getServerByName(serverName);

    if (serverInfo?.status === 'oauth_required' && serverInfo.oauth?.authorizationUrl) {
      return;
    }

    if (serverInfo && serverInfo.status !== 'connecting' && serverInfo.status !== 'oauth_required') {
      return;
    }

    await sleep(OAUTH_RECONNECT_WAIT_INTERVAL_MS);
  }
};

const restartServerOAuthFlow = async (serverName: string): Promise<void> => {
  const runtimeReset = resetServerOAuthConnection(serverName);
  if (!runtimeReset) {
    return;
  }

  try {
    await reconnectServer(serverName);
    await waitForFreshAuthorizationUrl(serverName);
  } catch (error) {
    console.warn('Failed to restart upstream OAuth authorization after disconnect', {
      serverName,
      error: summarizeErrorForLogging(error),
    });
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

  const allowInternal = await canServerOwnerReachInternalUrls(serverConfig);
  const revocationEndpoint = getRevocationEndpoint(serverName, serverConfig);
  const tokens = getTokensToRevoke(serverConfig);
  let succeeded = 0;

  if (revocationEndpoint) {
    for (const token of tokens) {
      if (await revokeToken(revocationEndpoint, serverConfig, token, allowInternal)) {
        succeeded += 1;
      }
    }
  }

  if (scope === 'all') {
    removeRegisteredClient(serverName);
  }

  await clearOAuthData(serverName, scope);
  if (scope === 'tokens') {
    await clearOAuthData(serverName, 'verifier');
  }
  await restartServerOAuthFlow(serverName);

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
