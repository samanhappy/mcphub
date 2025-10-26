import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { RequestHandler } from 'express';
import { loadSettings } from '../config/index.js';
import { initializeOAuthForServer, refreshAccessToken } from './oauthClientRegistration.js';

// Re-export for external use
export {
  getRegisteredClient,
  getAuthorizationUrl,
  exchangeCodeForToken,
  generateCodeVerifier,
  calculateCodeChallenge,
  autoDetectOAuthConfig,
  parseWWWAuthenticateHeader,
  fetchProtectedResourceMetadata,
} from './oauthClientRegistration.js';

let oauthProvider: ProxyOAuthServerProvider | null = null;
let oauthRouter: RequestHandler | null = null;

/**
 * Initialize OAuth provider from system configuration
 */
export const initOAuthProvider = (): void => {
  const settings = loadSettings();
  const oauthConfig = settings.systemConfig?.oauth;

  if (!oauthConfig || !oauthConfig.enabled) {
    console.log('OAuth provider is disabled or not configured');
    return;
  }

  try {
    // Create proxy OAuth provider
    oauthProvider = new ProxyOAuthServerProvider({
      endpoints: {
        authorizationUrl: oauthConfig.endpoints.authorizationUrl,
        tokenUrl: oauthConfig.endpoints.tokenUrl,
        revocationUrl: oauthConfig.endpoints.revocationUrl,
      },
      verifyAccessToken: async (token: string) => {
        // If a verification endpoint is configured, use it
        if (oauthConfig.verifyAccessToken?.endpoint) {
          const response = await fetch(oauthConfig.verifyAccessToken.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...oauthConfig.verifyAccessToken.headers,
            },
            body: JSON.stringify({ token }),
          });

          if (!response.ok) {
            throw new Error(`Token verification failed: ${response.statusText}`);
          }

          const result = await response.json();
          return {
            token,
            clientId: result.client_id || result.clientId || 'unknown',
            scopes: result.scopes || result.scope?.split(' ') || [],
          };
        }

        // Default verification - just extract basic info from token
        // In production, you should decode/verify JWT or call an introspection endpoint
        return {
          token,
          clientId: 'default',
          scopes: oauthConfig.scopesSupported || [],
        };
      },
      getClient: async (clientId: string) => {
        // Find client in configuration
        const client = oauthConfig.clients?.find((c) => c.client_id === clientId);

        if (!client) {
          return undefined;
        }

        return {
          client_id: client.client_id,
          redirect_uris: client.redirect_uris,
        };
      },
    });

    // Create OAuth router
    const issuerUrl = new URL(oauthConfig.issuerUrl);
    const baseUrl = oauthConfig.baseUrl ? new URL(oauthConfig.baseUrl) : issuerUrl;

    oauthRouter = mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      baseUrl,
      serviceDocumentationUrl: oauthConfig.serviceDocumentationUrl
        ? new URL(oauthConfig.serviceDocumentationUrl)
        : undefined,
      scopesSupported: oauthConfig.scopesSupported,
    });

    console.log('OAuth provider initialized successfully');
    console.log(`OAuth issuer URL: ${issuerUrl.origin}`);
    // Only log endpoint URLs, not full config which might contain sensitive data
    console.log(
      'OAuth endpoints configured: authorization, token' +
        (oauthConfig.endpoints.revocationUrl ? ', revocation' : ''),
    );
  } catch (error) {
    console.error('Failed to initialize OAuth provider:', error);
    oauthProvider = null;
    oauthRouter = null;
  }
};

/**
 * Get the OAuth router if available
 */
export const getOAuthRouter = (): RequestHandler | null => {
  return oauthRouter;
};

/**
 * Get the OAuth provider if available
 */
export const getOAuthProvider = (): ProxyOAuthServerProvider | null => {
  return oauthProvider;
};

/**
 * Check if OAuth is enabled
 */
export const isOAuthEnabled = (): boolean => {
  return oauthProvider !== null && oauthRouter !== null;
};

/**
 * Get OAuth access token for a server if configured
 * Handles both static tokens and dynamic OAuth flows with automatic token refresh
 */
export const getServerOAuthToken = async (serverName: string): Promise<string | undefined> => {
  const settings = loadSettings();
  const serverConfig = settings.mcpServers[serverName];

  if (!serverConfig?.oauth) {
    return undefined;
  }

  // If a pre-configured access token exists, use it
  if (serverConfig.oauth.accessToken) {
    // TODO: In a production system, check if token is expired and refresh if needed
    // For now, just return the configured token
    return serverConfig.oauth.accessToken;
  }

  // If dynamic registration is enabled, initialize OAuth and get token
  if (serverConfig.oauth.dynamicRegistration?.enabled) {
    try {
      // Initialize OAuth for this server (registers client if needed)
      const clientInfo = await initializeOAuthForServer(serverName, serverConfig);

      if (!clientInfo) {
        console.warn(`Failed to initialize OAuth for server: ${serverName}`);
        return undefined;
      }

      // If we have a refresh token, try to get a new access token
      if (serverConfig.oauth.refreshToken) {
        try {
          const tokens = await refreshAccessToken(
            serverName,
            serverConfig,
            clientInfo,
            serverConfig.oauth.refreshToken,
          );
          return tokens.accessToken;
        } catch (error) {
          console.error(`Failed to refresh token for server ${serverName}:`, error);
          // Token refresh failed - user needs to re-authorize
          // In a production system, you would trigger a new authorization flow here
          return undefined;
        }
      }

      // No access token and no refresh token available
      // User needs to go through the authorization flow
      // This would typically be triggered by an API endpoint that initiates the OAuth flow
      console.log(`Server ${serverName} requires user authorization via OAuth flow`);
      return undefined;
    } catch (error) {
      console.error(`Failed to get OAuth token for server ${serverName}:`, error);
      return undefined;
    }
  }

  // Static client configuration - check for existing token
  if (serverConfig.oauth.clientId && serverConfig.oauth.accessToken) {
    return serverConfig.oauth.accessToken;
  }

  return undefined;
};

/**
 * Add OAuth authorization header to request headers if token is available
 */
export const addOAuthHeader = async (
  serverName: string,
  headers: Record<string, string>,
): Promise<Record<string, string>> => {
  const token = await getServerOAuthToken(serverName);

  if (token) {
    return {
      ...headers,
      Authorization: `Bearer ${token}`,
    };
  }

  return headers;
};

/**
 * Initialize OAuth for all configured servers with explicit dynamic registration enabled
 * Servers without explicit configuration will be registered on-demand when receiving 401
 * Call this at application startup to pre-register known OAuth servers
 */
export const initializeAllOAuthClients = async (): Promise<void> => {
  const settings = loadSettings();

  console.log('Initializing OAuth clients for explicitly configured servers...');

  const serverNames = Object.keys(settings.mcpServers);
  const registrationPromises: Promise<void>[] = [];

  for (const serverName of serverNames) {
    const serverConfig = settings.mcpServers[serverName];

    // Only initialize servers with explicitly enabled dynamic registration
    // Others will be auto-detected and registered on first 401 response
    if (serverConfig.oauth?.dynamicRegistration?.enabled === true) {
      registrationPromises.push(
        initializeOAuthForServer(serverName, serverConfig)
          .then((clientInfo) => {
            if (clientInfo) {
              console.log(`✓ OAuth client pre-registered for server: ${serverName}`);
            } else {
              console.warn(`✗ Failed to pre-register OAuth client for server: ${serverName}`);
            }
          })
          .catch((error) => {
            console.error(
              `✗ Error pre-registering OAuth client for server ${serverName}:`,
              error.message,
            );
          }),
      );
    }
  }

  // Wait for all registrations to complete
  if (registrationPromises.length > 0) {
    await Promise.all(registrationPromises);
    console.log(
      `OAuth client pre-registration completed for ${registrationPromises.length} server(s)`,
    );
  } else {
    console.log('No servers configured for pre-registration (will auto-detect on 401 responses)');
  }
};
