import { loadSettings, saveSettings } from '../config/index.js';
import { McpSettings, ServerConfig } from '../types/index.js';

type OAuthConfig = NonNullable<ServerConfig['oauth']>;
export type ServerConfigWithOAuth = ServerConfig & { oauth: OAuthConfig };

export interface OAuthSettingsContext {
  settings: McpSettings;
  serverConfig: ServerConfig;
  oauth: OAuthConfig;
}

/**
 * Load the latest server configuration from disk.
 */
export const loadServerConfig = (serverName: string): ServerConfig | undefined => {
  const settings = loadSettings();
  return settings.mcpServers?.[serverName];
};

/**
 * Mutate OAuth configuration for a server and persist the updated settings.
 * The mutator receives the shared settings object to allow related updates when needed.
 */
export const mutateOAuthSettings = async (
  serverName: string,
  mutator: (context: OAuthSettingsContext) => void,
): Promise<ServerConfigWithOAuth | undefined> => {
  const settings = loadSettings();
  const serverConfig = settings.mcpServers?.[serverName];

  if (!serverConfig) {
    console.warn(`Server ${serverName} not found while updating OAuth settings`);
    return undefined;
  }

  if (!serverConfig.oauth) {
    serverConfig.oauth = {};
  }

  const context: OAuthSettingsContext = {
    settings,
    serverConfig,
    oauth: serverConfig.oauth,
  };

  mutator(context);

  const saved = saveSettings(settings);
  if (!saved) {
    throw new Error(`Failed to persist OAuth settings for server ${serverName}`);
  }

  return context.serverConfig as ServerConfigWithOAuth;
};

export const persistClientCredentials = async (
  serverName: string,
  credentials: {
    clientId: string;
    clientSecret?: string;
    scopes?: string[];
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
  },
): Promise<ServerConfigWithOAuth | undefined> => {
  const updated = await mutateOAuthSettings(serverName, ({ oauth }) => {
    oauth.clientId = credentials.clientId;
    oauth.clientSecret = credentials.clientSecret;

    if (credentials.scopes && credentials.scopes.length > 0) {
      oauth.scopes = credentials.scopes;
    }
    if (credentials.authorizationEndpoint) {
      oauth.authorizationEndpoint = credentials.authorizationEndpoint;
    }
    if (credentials.tokenEndpoint) {
      oauth.tokenEndpoint = credentials.tokenEndpoint;
    }
  });

  console.log(`Persisted OAuth client credentials for server: ${serverName}`);
  if (credentials.scopes && credentials.scopes.length > 0) {
    console.log(`Stored OAuth scopes for ${serverName}: ${credentials.scopes.join(', ')}`);
  }

  return updated;
};

/**
 * Persist OAuth tokens and optionally replace the stored refresh token.
 */
export const persistTokens = async (
  serverName: string,
  tokens: {
    accessToken: string;
    refreshToken?: string | null;
    clearPendingAuthorization?: boolean;
  },
): Promise<ServerConfigWithOAuth | undefined> => {
  return mutateOAuthSettings(serverName, ({ oauth }) => {
    oauth.accessToken = tokens.accessToken;

    if (tokens.refreshToken !== undefined) {
      if (tokens.refreshToken) {
        oauth.refreshToken = tokens.refreshToken;
      } else {
        delete oauth.refreshToken;
      }
    }

    if (tokens.clearPendingAuthorization && oauth.pendingAuthorization) {
      delete oauth.pendingAuthorization;
    }
  });
};

/**
 * Update or create a pending authorization record.
 */
export const updatePendingAuthorization = async (
  serverName: string,
  pending: Partial<NonNullable<OAuthConfig['pendingAuthorization']>>,
): Promise<ServerConfigWithOAuth | undefined> => {
  return mutateOAuthSettings(serverName, ({ oauth }) => {
    oauth.pendingAuthorization = {
      ...(oauth.pendingAuthorization || {}),
      ...pending,
      createdAt: pending.createdAt ?? Date.now(),
    };
  });
};

/**
 * Clear cached OAuth data using shared helpers.
 */
export const clearOAuthData = async (
  serverName: string,
  scope: 'all' | 'client' | 'tokens' | 'verifier',
): Promise<ServerConfigWithOAuth | undefined> => {
  return mutateOAuthSettings(serverName, ({ oauth }) => {
    if (scope === 'tokens' || scope === 'all') {
      delete oauth.accessToken;
      delete oauth.refreshToken;
    }

    if (scope === 'client' || scope === 'all') {
      delete oauth.clientId;
      delete oauth.clientSecret;
    }

    if (scope === 'verifier' || scope === 'all') {
      if (oauth.pendingAuthorization) {
        delete oauth.pendingAuthorization;
      }
    }
  });
};
