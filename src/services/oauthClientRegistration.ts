/**
 * OAuth 2.0 Dynamic Client Registration Service
 *
 * Implements dynamic client registration for upstream MCP servers based on:
 * - RFC7591: OAuth 2.0 Dynamic Client Registration Protocol
 * - RFC8414: OAuth 2.0 Authorization Server Metadata
 * - MCP Authorization Specification
 *
 * Uses the standard openid-client library for OAuth operations.
 */

import * as client from 'openid-client';
import { ServerConfig } from '../types/index.js';
import {
  mutateOAuthSettings,
  persistClientCredentials,
  persistTokens,
} from './oauthSettingsStore.js';

interface RegisteredClientInfo {
  config: client.Configuration;
  clientId: string;
  clientSecret?: string;
  registrationAccessToken?: string;
  registrationClientUri?: string;
  expiresAt?: number;
  metadata: any;
}

// Cache for registered clients to avoid re-registering on every restart
const registeredClients = new Map<string, RegisteredClientInfo>();

export const removeRegisteredClient = (serverName: string): void => {
  registeredClients.delete(serverName);
};

/**
 * Parse WWW-Authenticate header to extract resource server metadata URL
 * Following RFC9728 Protected Resource Metadata specification
 *
 * Example header: WWW-Authenticate: Bearer resource="https://mcp.example.com/.well-known/oauth-protected-resource"
 */
export const parseWWWAuthenticateHeader = (header: string): string | null => {
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  // Extract resource parameter from WWW-Authenticate header
  const resourceMatch = header.match(/resource="([^"]+)"/i);
  if (resourceMatch && resourceMatch[1]) {
    return resourceMatch[1];
  }

  return null;
};

/**
 * Fetch protected resource metadata from MCP server
 * Following RFC9728 section 3
 *
 * @param resourceMetadataUrl - URL to fetch resource metadata (from WWW-Authenticate header)
 * @returns Authorization server URLs and other metadata
 */
export const fetchProtectedResourceMetadata = async (
  resourceMetadataUrl: string,
): Promise<{
  authorization_servers: string[];
  resource?: string;
  [key: string]: any;
}> => {
  try {
    console.log(`Fetching protected resource metadata from: ${resourceMetadataUrl}`);

    const response = await fetch(resourceMetadataUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch resource metadata: ${response.status} ${response.statusText}`,
      );
    }

    const metadata = await response.json();

    if (!metadata.authorization_servers || !Array.isArray(metadata.authorization_servers)) {
      throw new Error('Invalid resource metadata: missing authorization_servers field');
    }

    console.log(`Found ${metadata.authorization_servers.length} authorization server(s)`);
    return metadata;
  } catch (error) {
    console.warn(`Failed to fetch protected resource metadata:`, error);
    throw error;
  }
};

/**
 * Fetch scopes from protected resource metadata by trying the well-known URL
 *
 * @param serverUrl - The MCP server URL
 * @returns Array of supported scopes or undefined if not available
 */
export const fetchScopesFromServer = async (serverUrl: string): Promise<string[] | undefined> => {
  try {
    // Construct the well-known protected resource metadata URL
    // Format: https://example.com/.well-known/oauth-protected-resource/path/to/resource
    const url = new URL(serverUrl);
    const resourcePath = url.pathname + url.search;
    const wellKnownUrl = `${url.origin}/.well-known/oauth-protected-resource${resourcePath}`;

    console.log(`Attempting to fetch scopes from: ${wellKnownUrl}`);

    const metadata = await fetchProtectedResourceMetadata(wellKnownUrl);

    if (metadata.scopes_supported && Array.isArray(metadata.scopes_supported)) {
      console.log(`Fetched scopes from server: ${metadata.scopes_supported.join(', ')}`);
      return metadata.scopes_supported as string[];
    }

    return undefined;
  } catch (error) {
    console.log(
      `Could not fetch scopes from server (this is normal if not using OAuth discovery): ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
};

/**
 * Auto-detect OAuth configuration from 401 response
 * Following MCP Authorization Specification for automatic discovery
 *
 * @param wwwAuthenticateHeader - The WWW-Authenticate header value from 401 response
 * @param serverUrl - The MCP server URL that returned 401
 * @returns Issuer URL and resource URL for OAuth configuration
 */
export const autoDetectOAuthConfig = async (
  wwwAuthenticateHeader: string,
  serverUrl: string,
): Promise<{ issuer: string; resource: string; scopes?: string[] } | null> => {
  try {
    // Step 1: Parse WWW-Authenticate header to get resource metadata URL
    const resourceMetadataUrl = parseWWWAuthenticateHeader(wwwAuthenticateHeader);

    if (!resourceMetadataUrl) {
      console.log('No resource metadata URL found in WWW-Authenticate header');
      return null;
    }

    // Step 2: Fetch protected resource metadata
    const resourceMetadata = await fetchProtectedResourceMetadata(resourceMetadataUrl);

    // Step 3: Select first authorization server (TODO: implement proper selection logic)
    const issuer = resourceMetadata.authorization_servers[0];

    if (!issuer) {
      throw new Error('No authorization servers found in resource metadata');
    }

    // Step 4: Determine resource URL (canonical URI of MCP server)
    const resource = resourceMetadata.resource || new URL(serverUrl).origin;

    // Step 5: Extract supported scopes from resource metadata
    const scopes = resourceMetadata.scopes_supported as string[] | undefined;

    console.log(`Auto-detected OAuth configuration:`);
    console.log(`  Issuer: ${issuer}`);
    console.log(`  Resource: ${resource}`);
    if (scopes && scopes.length > 0) {
      console.log(`  Scopes: ${scopes.join(', ')}`);
    }

    return { issuer, resource, scopes };
  } catch (error) {
    console.error('Failed to auto-detect OAuth configuration:', error);
    return null;
  }
};

/**
 * Perform OAuth 2.0 issuer discovery to get authorization server metadata
 */
export const discoverIssuer = async (
  issuerUrl: string,
  clientId: string = 'mcphub-temp',
  clientSecret?: string,
): Promise<client.Configuration> => {
  try {
    console.log(`Discovering OAuth issuer: ${issuerUrl}`);
    const server = new URL(issuerUrl);

    const clientAuth = clientSecret ? client.ClientSecretPost(clientSecret) : client.None();

    const config = await client.discovery(server, clientId, undefined, clientAuth);
    console.log(`Successfully discovered OAuth issuer: ${issuerUrl}`);
    return config;
  } catch (error) {
    console.error(`Failed to discover OAuth issuer ${issuerUrl}:`, error);
    throw new Error(
      `OAuth issuer discovery failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Register a new OAuth client dynamically using RFC7591
 * Can be called with auto-detected configuration from 401 response
 */
export const registerClient = async (
  serverName: string,
  serverConfig: ServerConfig,
  autoDetectedIssuer?: string,
  autoDetectedScopes?: string[],
): Promise<RegisteredClientInfo> => {
  // Check if we already have a registered client for this server
  const cached = registeredClients.get(serverName);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
    console.log(`Using cached OAuth client for server: ${serverName}`);
    return cached;
  }

  const dynamicConfig = serverConfig.oauth?.dynamicRegistration;

  try {
    let serverUrl: URL;

    // Step 1: Determine the authorization server URL
    // Priority: autoDetectedIssuer > configured issuer > registration endpoint
    const issuerUrl = autoDetectedIssuer || dynamicConfig?.issuer;

    if (issuerUrl) {
      serverUrl = new URL(issuerUrl);
    } else if (dynamicConfig?.registrationEndpoint) {
      // Extract server URL from registration endpoint
      const regUrl = new URL(dynamicConfig.registrationEndpoint);
      serverUrl = new URL(`${regUrl.protocol}//${regUrl.host}`);
    } else {
      throw new Error(
        `Cannot register OAuth client: no issuer URL available. Either provide 'issuer' in configuration or ensure server returns proper 401 with WWW-Authenticate header.`,
      );
    }

    // Step 2: Prepare client metadata for registration
    const metadata = dynamicConfig?.metadata || {};

    // Determine scopes: priority is metadata.scope > autoDetectedScopes > configured scopes > 'openid'
    let scopeValue: string;
    if (metadata.scope) {
      scopeValue = metadata.scope;
    } else if (autoDetectedScopes && autoDetectedScopes.length > 0) {
      scopeValue = autoDetectedScopes.join(' ');
    } else if (serverConfig.oauth?.scopes) {
      scopeValue = serverConfig.oauth.scopes.join(' ');
    } else {
      scopeValue = 'openid';
    }

    const clientMetadata: Partial<client.ClientMetadata> = {
      client_name: metadata.client_name || `MCPHub - ${serverName}`,
      redirect_uris: metadata.redirect_uris || ['http://localhost:3000/oauth/callback'],
      grant_types: metadata.grant_types || ['authorization_code', 'refresh_token'],
      response_types: metadata.response_types || ['code'],
      token_endpoint_auth_method: metadata.token_endpoint_auth_method || 'client_secret_post',
      scope: scopeValue,
      ...metadata, // Include any additional custom metadata
    };

    console.log(`Registering OAuth client for server: ${serverName}`);
    console.log(`Server URL: ${serverUrl}`);
    console.log(`Client metadata:`, JSON.stringify(clientMetadata, null, 2));

    // Step 3: Perform dynamic client registration
    const clientAuth = dynamicConfig?.initialAccessToken
      ? client.ClientSecretPost(dynamicConfig.initialAccessToken)
      : client.None();

    const config = await client.dynamicClientRegistration(serverUrl, clientMetadata, clientAuth);

    console.log(`Successfully registered OAuth client for server: ${serverName}`);

    // Extract client ID from the configuration
    const clientId = (config as any).client_id || (config as any).clientId;
    console.log(`Client ID: ${clientId}`);

    // Step 4: Store registered client information
    const clientInfo: RegisteredClientInfo = {
      config,
      clientId,
      clientSecret: (config as any).client_secret, // Access client secret if available
      registrationAccessToken: (config as any).registrationAccessToken,
      registrationClientUri: (config as any).registrationClientUri,
      expiresAt: (config as any).client_secret_expires_at
        ? (config as any).client_secret_expires_at * 1000
        : undefined,
      metadata: config,
    };

    // Cache the registered client
    registeredClients.set(serverName, clientInfo);

    // Persist the client credentials and scopes to configuration
    const persistedConfig = await persistClientCredentials(serverName, {
      clientId,
      clientSecret: clientInfo.clientSecret,
      scopes: autoDetectedScopes,
      authorizationEndpoint: clientInfo.config.serverMetadata().authorization_endpoint,
      tokenEndpoint: clientInfo.config.serverMetadata().token_endpoint,
    });

    if (persistedConfig) {
      serverConfig.oauth = {
        ...(serverConfig.oauth || {}),
        ...persistedConfig.oauth,
      };
    }

    return clientInfo;
  } catch (error) {
    console.error(`Failed to register OAuth client for server ${serverName}:`, error);
    throw error;
  }
};

/**
 * Get authorization URL for user authorization (OAuth 2.0 authorization code flow)
 */
export const getAuthorizationUrl = async (
  serverName: string,
  serverConfig: ServerConfig,
  clientInfo: RegisteredClientInfo,
  redirectUri: string,
  state: string,
  codeVerifier: string,
): Promise<string> => {
  try {
    // Generate code challenge for PKCE (required by MCP spec)
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    // Build authorization parameters
    const params: Record<string, string> = {
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: serverConfig.oauth?.scopes?.join(' ') || 'openid',
    };

    // Add resource parameter for MCP (RFC8707)
    if (serverConfig.oauth?.resource) {
      params.resource = serverConfig.oauth.resource;
    }

    const authUrl = client.buildAuthorizationUrl(clientInfo.config, params);
    return authUrl.toString();
  } catch (error) {
    console.error(`Failed to generate authorization URL for server ${serverName}:`, error);
    throw error;
  }
};

/**
 * Exchange authorization code for access token
 */
export const exchangeCodeForToken = async (
  serverName: string,
  serverConfig: ServerConfig,
  clientInfo: RegisteredClientInfo,
  currentUrl: string,
  codeVerifier: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> => {
  try {
    console.log(`Exchanging authorization code for access token for server: ${serverName}`);

    // Prepare token endpoint parameters
    const tokenParams: Record<string, string> = {
      code_verifier: codeVerifier,
    };

    // Add resource parameter for MCP (RFC8707)
    if (serverConfig.oauth?.resource) {
      tokenParams.resource = serverConfig.oauth.resource;
    }

    const tokens = await client.authorizationCodeGrant(
      clientInfo.config,
      new URL(currentUrl),
      { expectedState: undefined }, // State is already validated
      tokenParams,
    );

    console.log(`Successfully obtained access token for server: ${serverName}`);

    await persistTokens(serverName, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    };
  } catch (error) {
    console.error(`Failed to exchange code for token for server ${serverName}:`, error);
    throw error;
  }
};

/**
 * Refresh access token using refresh token
 */
export const refreshAccessToken = async (
  serverName: string,
  serverConfig: ServerConfig,
  clientInfo: RegisteredClientInfo,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> => {
  try {
    console.log(`Refreshing access token for server: ${serverName}`);

    // Prepare refresh token parameters
    const params: Record<string, string> = {};

    // Add resource parameter for MCP (RFC8707)
    if (serverConfig.oauth?.resource) {
      params.resource = serverConfig.oauth.resource;
    }

    const tokens = await client.refreshTokenGrant(clientInfo.config, refreshToken, params);

    console.log(`Successfully refreshed access token for server: ${serverName}`);

    await persistTokens(serverName, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    };
  } catch (error) {
    console.error(`Failed to refresh access token for server ${serverName}:`, error);
    throw error;
  }
};

/**
 * Generate PKCE code verifier
 */
export const generateCodeVerifier = (): string => {
  return client.randomPKCECodeVerifier();
};

/**
 * Calculate PKCE code challenge from verifier
 */
export const calculateCodeChallenge = async (codeVerifier: string): Promise<string> => {
  return client.calculatePKCECodeChallenge(codeVerifier);
};

/**
 * Get registered client info from cache
 */
export const getRegisteredClient = (serverName: string): RegisteredClientInfo | undefined => {
  return registeredClients.get(serverName);
};

/**
 * Initialize OAuth for a server (performs registration if needed)
 * Now supports auto-detection via 401 responses with WWW-Authenticate header
 *
 * @param serverName - Name of the server
 * @param serverConfig - Server configuration
 * @param autoDetectedIssuer - Optional issuer URL from auto-detection
 * @param autoDetectedScopes - Optional scopes from auto-detection
 * @returns RegisteredClientInfo or null
 */
export const initializeOAuthForServer = async (
  serverName: string,
  serverConfig: ServerConfig,
  autoDetectedIssuer?: string,
  autoDetectedScopes?: string[],
): Promise<RegisteredClientInfo | null> => {
  if (!serverConfig.oauth) {
    return null;
  }

  // Check if dynamic registration should be attempted
  const shouldAttemptRegistration =
    autoDetectedIssuer || // Auto-detected from 401 response
    serverConfig.oauth.dynamicRegistration?.enabled === true || // Explicitly enabled
    (serverConfig.oauth.dynamicRegistration && !serverConfig.oauth.clientId); // Configured but no static client

  if (shouldAttemptRegistration) {
    try {
      // Perform dynamic client registration
      const clientInfo = await registerClient(
        serverName,
        serverConfig,
        autoDetectedIssuer,
        autoDetectedScopes,
      );
      return clientInfo;
    } catch (error) {
      console.error(`Failed to initialize OAuth for server ${serverName}:`, error);
      // If auto-detection failed, don't throw - allow fallback to static config
      if (!autoDetectedIssuer) {
        throw error;
      }
    }
  }

  // Static client configuration - create Configuration from static values
  if (serverConfig.oauth.clientId) {
    // Try to fetch and store scopes if not already configured
    if (!serverConfig.oauth.scopes && serverConfig.url) {
      try {
        const fetchedScopes = await fetchScopesFromServer(serverConfig.url);
        if (fetchedScopes && fetchedScopes.length > 0) {
          await mutateOAuthSettings(serverName, ({ oauth }) => {
            oauth.scopes = fetchedScopes;
          });

          if (!serverConfig.oauth) {
            serverConfig.oauth = {};
          }
          serverConfig.oauth.scopes = fetchedScopes;
          console.log(`Stored fetched scopes for ${serverName}: ${fetchedScopes.join(', ')}`);
        }
      } catch (error) {
        console.log(`Failed to fetch scopes for ${serverName}, will use defaults`);
      }
    }

    // For static config, we need the authorization server URL
    let serverUrl: URL;

    if (serverConfig.oauth.authorizationEndpoint) {
      const authUrl = new URL(serverConfig.oauth.authorizationEndpoint!);
      serverUrl = new URL(`${authUrl.protocol}//${authUrl.host}`);
    } else if (serverConfig.oauth.tokenEndpoint) {
      const tokenUrl = new URL(serverConfig.oauth.tokenEndpoint!);
      serverUrl = new URL(`${tokenUrl.protocol}//${tokenUrl.host}`);
    } else {
      console.warn(`Server ${serverName} has static OAuth config but missing endpoints`);
      return null;
    }

    try {
      // Discover the server configuration
      const clientAuth = serverConfig.oauth.clientSecret
        ? client.ClientSecretPost(serverConfig.oauth.clientSecret)
        : client.None();

      const config = await client.discovery(
        serverUrl,
        serverConfig.oauth.clientId!,
        undefined,
        clientAuth,
      );

      const clientInfo: RegisteredClientInfo = {
        config,
        clientId: serverConfig.oauth.clientId!,
        clientSecret: serverConfig.oauth.clientSecret,
        metadata: {},
      };

      registeredClients.set(serverName, clientInfo);
      return clientInfo;
    } catch (error) {
      console.error(`Failed to discover OAuth server for ${serverName}:`, error);
      return null;
    }
  }

  return null;
};
