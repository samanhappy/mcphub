/**
 * MCP OAuth Provider Implementation
 *
 * Implements OAuthClientProvider interface from @modelcontextprotocol/sdk/client/auth.js
 * to handle OAuth 2.0 authentication for upstream MCP servers using the SDK's built-in
 * OAuth support.
 *
 * This provider integrates with our existing OAuth infrastructure:
 * - Dynamic client registration (RFC7591)
 * - Token storage and refresh
 * - Authorization flow handling
 */

import { randomBytes } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { ServerConfig } from '../types/index.js';
import { loadSettings } from '../config/index.js';
import {
  initializeOAuthForServer,
  getRegisteredClient,
  removeRegisteredClient,
  fetchScopesFromServer,
} from './oauthClientRegistration.js';
import {
  clearOAuthData,
  loadServerConfig,
  mutateOAuthSettings,
  persistClientCredentials,
  persistTokens,
  updatePendingAuthorization,
  ServerConfigWithOAuth,
} from './oauthSettingsStore.js';

// Import getServerByName to access ServerInfo
import { getServerByName } from './mcpService.js';

/**
 * MCPHub OAuth Provider for server-side OAuth flows
 *
 * This provider handles OAuth authentication for upstream MCP servers.
 * Unlike browser-based providers, this runs in a Node.js server environment,
 * so the authorization flow requires external handling (e.g., via web UI).
 */
export class MCPHubOAuthProvider implements OAuthClientProvider {
  private serverName: string;
  private serverConfig: ServerConfig;
  private _codeVerifier?: string;
  private _currentState?: string;

  constructor(serverName: string, serverConfig: ServerConfig) {
    this.serverName = serverName;
    this.serverConfig = serverConfig;
  }

  private getSystemInstallBaseUrl(): string | undefined {
    const settings = loadSettings();
    return settings.systemConfig?.install?.baseUrl;
  }

  private sanitizeRedirectUri(input?: string): string | null {
    if (!input) {
      return null;
    }

    try {
      const url = new URL(input);
      url.searchParams.delete('server');
      const params = url.searchParams.toString();
      url.search = params ? `?${params}` : '';
      return url.toString();
    } catch {
      return null;
    }
  }

  private buildRedirectUriFromBase(baseUrl?: string): string | null {
    if (!baseUrl) {
      return null;
    }

    const trimmed = baseUrl.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const normalizedBase = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
      const redirect = new URL('oauth/callback', normalizedBase);
      return this.sanitizeRedirectUri(redirect.toString());
    } catch {
      return null;
    }
  }

  /**
   * Get redirect URL for OAuth callback
   */
  get redirectUrl(): string {
    const dynamicConfig = this.serverConfig.oauth?.dynamicRegistration;
    const metadata = dynamicConfig?.metadata || {};
    const fallback = 'http://localhost:3000/oauth/callback';
    const systemConfigured = this.buildRedirectUriFromBase(this.getSystemInstallBaseUrl());
    const metadataConfigured = this.sanitizeRedirectUri(metadata.redirect_uris?.[0]);

    return systemConfigured ?? metadataConfigured ?? fallback;
  }

  /**
   * Get client metadata for dynamic registration or static configuration
   */
  get clientMetadata(): OAuthClientMetadata {
    const dynamicConfig = this.serverConfig.oauth?.dynamicRegistration;
    const metadata = dynamicConfig?.metadata || {};

    // Use redirectUrl getter to ensure consistent callback URL
    const redirectUri = this.redirectUrl;
    const systemConfigured = this.buildRedirectUriFromBase(this.getSystemInstallBaseUrl());
    const metadataRedirects =
      metadata.redirect_uris && metadata.redirect_uris.length > 0
        ? metadata.redirect_uris
            .map((uri) => this.sanitizeRedirectUri(uri))
            .filter((uri): uri is string => Boolean(uri))
        : [];
    const redirectUris: string[] = [];

    if (systemConfigured) {
      redirectUris.push(systemConfigured);
    }

    for (const uri of metadataRedirects) {
      if (!redirectUris.includes(uri)) {
        redirectUris.push(uri);
      }
    }

    if (!redirectUris.includes(redirectUri)) {
      redirectUris.push(redirectUri);
    }

    const tokenEndpointAuthMethod =
      metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== ''
        ? metadata.token_endpoint_auth_method
        : this.serverConfig.oauth?.clientSecret
          ? 'client_secret_post'
          : 'none';

    return {
      ...metadata, // Include any additional custom metadata
      client_name: metadata.client_name || `MCPHub - ${this.serverName}`,
      redirect_uris: redirectUris,
      grant_types: metadata.grant_types || ['authorization_code', 'refresh_token'],
      response_types: metadata.response_types || ['code'],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      scope: metadata.scope || this.serverConfig.oauth?.scopes?.join(' ') || 'openid',
    };
  }

  private async ensureScopesFromServer(): Promise<string[] | undefined> {
    const serverUrl = this.serverConfig.url;
    const existingScopes = this.serverConfig.oauth?.scopes;

    if (!serverUrl) {
      return existingScopes;
    }

    if (existingScopes && existingScopes.length > 0) {
      return existingScopes;
    }

    try {
      const scopes = await fetchScopesFromServer(serverUrl);
      if (scopes && scopes.length > 0) {
        const updatedConfig = await mutateOAuthSettings(this.serverName, ({ oauth }) => {
          oauth.scopes = scopes;
        });
        if (updatedConfig) {
          this.serverConfig = updatedConfig;
        }
        console.log(`Stored auto-detected scopes for ${this.serverName}: ${scopes.join(', ')}`);
        return scopes;
      }
    } catch (error) {
      console.warn(
        `Failed to auto-detect scopes for ${this.serverName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return existingScopes;
  }

  private generateState(): string {
    const payload = {
      server: this.serverName,
      nonce: randomBytes(16).toString('hex'),
    };
    const base64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async state(): Promise<string> {
    if (!this._currentState) {
      this._currentState = this.generateState();
    }
    return this._currentState;
  }

  /**
   * Get previously registered client information
   */
  clientInformation(): OAuthClientInformation | undefined {
    const clientInfo = getRegisteredClient(this.serverName);

    if (!clientInfo) {
      // Try to use static client configuration from cached serverConfig first
      let serverConfig = this.serverConfig;

      // If cached config doesn't have clientId, reload from settings
      if (!serverConfig?.oauth?.clientId) {
        const storedConfig = loadServerConfig(this.serverName);

        if (storedConfig) {
          this.serverConfig = storedConfig;
          serverConfig = storedConfig;
        }
      }

      // Try to use static client configuration from serverConfig
      if (serverConfig?.oauth?.clientId) {
        return {
          client_id: serverConfig.oauth.clientId,
          client_secret: serverConfig.oauth.clientSecret,
        };
      }
      return undefined;
    }

    return {
      client_id: clientInfo.clientId,
      client_secret: clientInfo.clientSecret,
    };
  }

  /**
   * Save registered client information
   * Called by SDK after successful dynamic registration
   */
  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    console.log(`Saving OAuth client information for server: ${this.serverName}`);

    const scopeString = info.scope?.trim();
    const scopes =
      scopeString && scopeString.length > 0
        ? scopeString.split(/\s+/).filter((value) => value.length > 0)
        : undefined;

    try {
      const updatedConfig = await persistClientCredentials(this.serverName, {
        clientId: info.client_id,
        clientSecret: info.client_secret,
        scopes,
      });

      if (updatedConfig) {
        this.serverConfig = updatedConfig;
      }

      if (!scopes || scopes.length === 0) {
        await this.ensureScopesFromServer();
      }
    } catch (error) {
      console.error(
        `Failed to persist OAuth client credentials for server ${this.serverName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get stored OAuth tokens
   */
  tokens(): OAuthTokens | undefined {
    // Use cached config first, but reload if needed
    let serverConfig = this.serverConfig;

    // If cached config doesn't have tokens, try reloading
    if (!serverConfig?.oauth?.accessToken) {
      const storedConfig = loadServerConfig(this.serverName);
      if (storedConfig) {
        this.serverConfig = storedConfig;
        serverConfig = storedConfig;
      }
    }

    if (!serverConfig?.oauth?.accessToken) {
      return undefined;
    }

    return {
      access_token: serverConfig.oauth.accessToken,
      token_type: 'Bearer',
      refresh_token: serverConfig.oauth.refreshToken,
      // Note: expires_in is not typically stored, only the token itself
      // The SDK will handle token refresh when needed
    };
  }

  /**
   * Save OAuth tokens
   * Called by SDK after successful token exchange or refresh
   */
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const currentOAuth = this.serverConfig.oauth;
    const accessTokenChanged = currentOAuth?.accessToken !== tokens.access_token;
    const refreshTokenProvided = tokens.refresh_token !== undefined;
    const refreshTokenChanged =
      refreshTokenProvided && currentOAuth?.refreshToken !== tokens.refresh_token;
    const hadPending = Boolean(currentOAuth?.pendingAuthorization);

    if (!accessTokenChanged && !refreshTokenChanged && !hadPending) {
      return;
    }

    console.log(`Saving OAuth tokens for server: ${this.serverName}`);

    const updatedConfig = await persistTokens(this.serverName, {
      accessToken: tokens.access_token,
      refreshToken: refreshTokenProvided ? (tokens.refresh_token ?? null) : undefined,
      clearPendingAuthorization: hadPending,
    });

    if (updatedConfig) {
      this.serverConfig = updatedConfig;
    }

    this._codeVerifier = undefined;
    this._currentState = undefined;

    const serverInfo = getServerByName(this.serverName);
    if (serverInfo) {
      serverInfo.oauth = undefined;
    }

    console.log(`Saved OAuth tokens for server: ${this.serverName}`);
  }

  /**
   * Redirect to authorization URL
   * In a server environment, we can't directly redirect the user
   * Instead, we store the URL in ServerInfo for the frontend to access
   */
  async redirectToAuthorization(url: URL): Promise<void> {
    console.log('='.repeat(80));
    console.log(`OAuth Authorization Required for server: ${this.serverName}`);
    console.log(`Authorization URL: ${url.toString()}`);
    console.log('='.repeat(80));
    let state = url.searchParams.get('state') || undefined;

    if (!state) {
      state = await this.state();
      url.searchParams.set('state', state);
    } else {
      this._currentState = state;
    }

    const authorizationUrl = url.toString();

    try {
      const pendingUpdate: Partial<NonNullable<ServerConfig['oauth']>['pendingAuthorization']> = {
        authorizationUrl,
        state,
      };

      if (this._codeVerifier) {
        pendingUpdate.codeVerifier = this._codeVerifier;
      }

      const updatedConfig = await updatePendingAuthorization(this.serverName, pendingUpdate);
      if (updatedConfig) {
        this.serverConfig = updatedConfig;
      }
    } catch (error) {
      console.error(
        `Failed to persist pending OAuth authorization state for ${this.serverName}:`,
        error,
      );
    }

    // Store the authorization URL in ServerInfo for the frontend to access
    const serverInfo = getServerByName(this.serverName);
    if (serverInfo) {
      serverInfo.status = 'oauth_required';
      serverInfo.oauth = {
        authorizationUrl,
        state,
        codeVerifier: this._codeVerifier,
      };
      console.log(`Stored OAuth authorization URL in ServerInfo for server: ${this.serverName}`);
    } else {
      console.warn(`ServerInfo not found for ${this.serverName}, cannot store authorization URL`);
    }

    // Throw error to indicate authorization is needed
    // The error will be caught in the connection flow and handled appropriately
    throw new Error(
      `OAuth authorization required for server ${this.serverName}. Please complete OAuth flow via web UI.`,
    );
  }

  /**
   * Save PKCE code verifier for later use in token exchange
   */
  async saveCodeVerifier(verifier: string): Promise<void> {
    this._codeVerifier = verifier;
    try {
      const updatedConfig = await updatePendingAuthorization(this.serverName, {
        codeVerifier: verifier,
      });
      if (updatedConfig) {
        this.serverConfig = updatedConfig;
      }
    } catch (error) {
      console.error(`Failed to persist OAuth code verifier for ${this.serverName}:`, error);
    }
    console.log(`Saved code verifier for server: ${this.serverName}`);
  }

  /**
   * Retrieve PKCE code verifier for token exchange
   */
  async codeVerifier(): Promise<string> {
    if (this._codeVerifier) {
      return this._codeVerifier;
    }

    const storedConfig = loadServerConfig(this.serverName);
    const storedVerifier = storedConfig?.oauth?.pendingAuthorization?.codeVerifier;

    if (storedVerifier) {
      this.serverConfig = storedConfig || this.serverConfig;
      this._codeVerifier = storedVerifier;
      return storedVerifier;
    }

    throw new Error(`No code verifier stored for server: ${this.serverName}`);
  }

  /**
   * Invalidate cached OAuth credentials when the SDK detects they are no longer valid.
   * This keeps stored configuration in sync and forces a fresh authorization flow.
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    const storedConfig = loadServerConfig(this.serverName);

    if (!storedConfig?.oauth) {
      if (scope === 'verifier' || scope === 'all') {
        this._codeVerifier = undefined;
      }
      return;
    }

    let currentConfig = storedConfig as ServerConfigWithOAuth;
    const assignUpdatedConfig = (updated?: ServerConfigWithOAuth) => {
      if (updated) {
        currentConfig = updated;
        this.serverConfig = updated;
      } else {
        this.serverConfig = currentConfig;
      }
    };

    assignUpdatedConfig(currentConfig);
    let changed = false;

    if (scope === 'tokens' || scope === 'all') {
      if (currentConfig.oauth.accessToken || currentConfig.oauth.refreshToken) {
        const updated = await clearOAuthData(this.serverName, 'tokens');
        assignUpdatedConfig(updated);
        changed = true;
        console.warn(`Cleared OAuth tokens for server: ${this.serverName}`);
      }
    }

    if (scope === 'client' || scope === 'all') {
      const supportsDynamicClient = currentConfig.oauth.dynamicRegistration?.enabled === true;

      if (
        supportsDynamicClient &&
        (currentConfig.oauth.clientId || currentConfig.oauth.clientSecret)
      ) {
        removeRegisteredClient(this.serverName);
        const updated = await clearOAuthData(this.serverName, 'client');
        assignUpdatedConfig(updated);
        changed = true;
        console.warn(`Cleared OAuth client registration for server: ${this.serverName}`);
      }
    }

    if (scope === 'verifier' || scope === 'all') {
      this._codeVerifier = undefined;
      this._currentState = undefined;
      if (currentConfig.oauth.pendingAuthorization) {
        const updated = await clearOAuthData(this.serverName, 'verifier');
        assignUpdatedConfig(updated);
        changed = true;
      }
    }

    if (changed) {
      this._currentState = undefined;
      const serverInfo = getServerByName(this.serverName);
      if (serverInfo) {
        serverInfo.status = 'oauth_required';
        serverInfo.oauth = undefined;
      }
    }
  }
}

const prepopulateScopesIfMissing = async (
  serverName: string,
  serverConfig: ServerConfig,
): Promise<void> => {
  if (!serverConfig.oauth || serverConfig.oauth.scopes?.length) {
    return;
  }

  if (!serverConfig.url) {
    return;
  }

  try {
    const scopes = await fetchScopesFromServer(serverConfig.url);
    if (scopes && scopes.length > 0) {
      const updatedConfig = await mutateOAuthSettings(serverName, ({ oauth }) => {
        oauth.scopes = scopes;
      });

      if (!serverConfig.oauth) {
        serverConfig.oauth = {};
      }
      serverConfig.oauth.scopes = scopes;

      if (updatedConfig) {
        console.log(`Stored auto-detected scopes for ${serverName}: ${scopes.join(', ')}`);
      }
    }
  } catch (error) {
    console.warn(
      `Failed to auto-detect scopes for ${serverName} during provider initialization: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

/**
 * Create an OAuth provider for a server if OAuth is configured
 *
 * @param serverName - Name of the server
 * @param serverConfig - Server configuration
 * @returns OAuthClientProvider instance or undefined if OAuth not configured
 */
export const createOAuthProvider = async (
  serverName: string,
  serverConfig: ServerConfig,
): Promise<OAuthClientProvider | undefined> => {
  // Ensure scopes are pre-populated if dynamic registration already ran previously
  await prepopulateScopesIfMissing(serverName, serverConfig);

  // Initialize OAuth for the server (performs registration if needed)
  // This ensures the client is registered before the SDK tries to use it
  try {
    await initializeOAuthForServer(serverName, serverConfig);
  } catch (error) {
    console.warn(`Failed to initialize OAuth for server ${serverName}:`, error);
    // Continue anyway - the SDK might be able to handle it
  }

  // Create and return the provider
  const provider = new MCPHubOAuthProvider(serverName, serverConfig);

  console.log(`Created OAuth provider for server: ${serverName}`);
  return provider;
};
