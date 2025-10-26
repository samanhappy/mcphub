/**
 * OAuth Callback Controller
 *
 * Handles OAuth 2.0 authorization callbacks for upstream MCP servers.
 *
 * This controller implements a simplified callback flow that relies on the MCP SDK
 * to handle the complete OAuth token exchange:
 *
 * 1. Extract authorization code from callback URL
 * 2. Find the corresponding server using the state parameter
 * 3. Store the authorization code temporarily
 * 4. Reconnect the server - SDK's auth() function will:
 *    - Automatically discover OAuth endpoints
 *    - Exchange the code for tokens using PKCE
 *    - Save tokens via our OAuthClientProvider.saveTokens()
 */

import { Request, Response } from 'express';
import {
  getServerByName,
  getServerByOAuthState,
  createTransportFromConfig,
} from '../services/mcpService.js';
import { getNameSeparator, loadSettings } from '../config/index.js';
import type { ServerInfo } from '../types/index.js';

/**
 * Generate HTML response page with i18n support
 */
const generateHtmlResponse = (
  type: 'error' | 'success',
  title: string,
  message: string,
  details?: { label: string; value: string }[],
  autoClose: boolean = false,
): string => {
  const backgroundColor = type === 'error' ? '#fee' : '#efe';
  const borderColor = type === 'error' ? '#fcc' : '#cfc';
  const titleColor = type === 'error' ? '#c33' : '#3c3';
  const buttonColor = type === 'error' ? '#c33' : '#3c3';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .container { background-color: ${backgroundColor}; border: 1px solid ${borderColor}; padding: 20px; border-radius: 8px; }
          h1 { color: ${titleColor}; margin-top: 0; }
          .detail { margin-top: 10px; padding: 10px; background: #f9f9f9; border-radius: 4px; ${type === 'error' ? 'font-family: monospace; font-size: 12px; white-space: pre-wrap;' : ''} }
          .close-btn { margin-top: 20px; padding: 10px 20px; background: ${buttonColor}; color: white; border: none; border-radius: 4px; cursor: pointer; }
        </style>
        ${autoClose ? '<script>setTimeout(() => { window.close(); }, 3000);</script>' : ''}
      </head>
      <body>
        <div class="container">
          <h1>${type === 'success' ? '✓ ' : ''}${title}</h1>
          ${details ? details.map((d) => `<div class="detail"><strong>${d.label}:</strong> ${d.value}</div>`).join('') : ''}
          <p>${message}</p>
          ${autoClose ? '<p>This window will close automatically in 3 seconds...</p>' : ''}
          <button class="close-btn" onclick="window.close()">${autoClose ? 'Close Now' : 'Close Window'}</button>
        </div>
      </body>
    </html>
  `;
};

const normalizeQueryParam = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    const [first] = value;
    return typeof first === 'string' ? first : undefined;
  }

  return undefined;
};

const extractServerNameFromState = (stateValue: string): string | undefined => {
  try {
    const normalized = stateValue.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (normalized.length % 4)) % 4;
    const base64 = normalized + '='.repeat(padding);
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(decoded);

    if (payload && typeof payload.server === 'string') {
      return payload.server;
    }
  } catch (error) {
    // Ignore decoding errors and fall back to delimiter-based parsing
  }

  const separatorIndex = stateValue.indexOf(':');
  if (separatorIndex > 0) {
    return stateValue.slice(0, separatorIndex);
  }

  return undefined;
};

/**
 * Handle OAuth callback after user authorization
 *
 * This endpoint receives the authorization code from the OAuth provider
 * and initiates the server reconnection process.
 *
 * Expected query parameters:
 * - code: Authorization code from OAuth provider
 * - state: Encoded server identifier used for OAuth session validation
 * - error: Optional error code if authorization failed
 * - error_description: Optional error description
 */
export const handleOAuthCallback = async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query;
    const codeParam = normalizeQueryParam(code);
    const stateParam = normalizeQueryParam(state);

    // Get translation function from request (set by i18n middleware)
    const t = (req as any).t || ((key: string) => key);

    // Check for authorization errors
    if (error) {
      console.error(`OAuth authorization failed: ${error} - ${error_description || ''}`);
      return res.status(400).send(
        generateHtmlResponse('error', t('oauthCallback.authorizationFailed'), '', [
          { label: t('oauthCallback.authorizationFailedError'), value: String(error) },
          ...(error_description
            ? [
                {
                  label: t('oauthCallback.authorizationFailedDetails'),
                  value: String(error_description),
                },
              ]
            : []),
        ]),
      );
    }

    // Validate required parameters
    if (!stateParam) {
      console.error('OAuth callback missing state parameter');
      return res
        .status(400)
        .send(
          generateHtmlResponse(
            'error',
            t('oauthCallback.invalidRequest'),
            t('oauthCallback.missingStateParameter'),
          ),
        );
    }

    if (!codeParam) {
      console.error('OAuth callback missing authorization code');
      return res
        .status(400)
        .send(
          generateHtmlResponse(
            'error',
            t('oauthCallback.invalidRequest'),
            t('oauthCallback.missingCodeParameter'),
          ),
        );
    }

    console.log(`OAuth callback received - code: present, state: ${stateParam}`);

    // Find server by state parameter
    let serverInfo: ServerInfo | undefined;

    serverInfo = getServerByOAuthState(stateParam);

    let decodedServerName: string | undefined;
    if (!serverInfo) {
      decodedServerName = extractServerNameFromState(stateParam);
      if (decodedServerName) {
        console.log(`State lookup failed; decoding server name from state: ${decodedServerName}`);
        serverInfo = getServerByName(decodedServerName);
      }
    }

    if (!serverInfo) {
      console.error(
        `No server found for OAuth callback. State: ${stateParam}${
          decodedServerName ? `, decoded server: ${decodedServerName}` : ''
        }`,
      );
      return res
        .status(400)
        .send(
          generateHtmlResponse(
            'error',
            t('oauthCallback.serverNotFound'),
            `${t('oauthCallback.serverNotFoundMessage')}\n${t('oauthCallback.sessionExpiredMessage')}`,
          ),
        );
    }

    // Optional: Validate state parameter for additional security
    if (serverInfo.oauth?.state && serverInfo.oauth.state !== stateParam) {
      console.warn(
        `State mismatch for server ${serverInfo.name}. Expected: ${serverInfo.oauth.state}, Got: ${stateParam}`,
      );
      // Note: We log a warning but don't fail the request since we have server name as primary identifier
    }

    console.log(`Processing OAuth callback for server: ${serverInfo.name}`);

    // For StreamableHTTPClientTransport, we need to call finishAuth() on the transport
    // This will exchange the authorization code for tokens automatically
    if (serverInfo.transport && 'finishAuth' in serverInfo.transport) {
      try {
        console.log(`Calling transport.finishAuth() for server: ${serverInfo.name}`);
        const currentTransport = serverInfo.transport as any;
        await currentTransport.finishAuth(codeParam);

        console.log(`Successfully exchanged authorization code for tokens: ${serverInfo.name}`);

        // Refresh server configuration from disk to ensure we pick up newly saved tokens
        const settings = loadSettings();
        const storedConfig = settings.mcpServers?.[serverInfo.name];
        const effectiveConfig = storedConfig || serverInfo.config;

        if (!effectiveConfig) {
          throw new Error(
            `Missing server configuration for ${serverInfo.name} after OAuth callback`,
          );
        }

        // Keep latest configuration cached on serverInfo
        serverInfo.config = effectiveConfig;

        // Ensure we have up-to-date request options for the reconnect attempt
        if (!serverInfo.options) {
          const requestConfig = effectiveConfig.options || {};
          serverInfo.options = {
            timeout: requestConfig.timeout || 60000,
            resetTimeoutOnProgress: requestConfig.resetTimeoutOnProgress || false,
            maxTotalTimeout: requestConfig.maxTotalTimeout,
          };
        }

        // Replace the existing transport instance to avoid reusing a closed/aborted transport
        try {
          if (serverInfo.transport && 'close' in serverInfo.transport) {
            await (serverInfo.transport as any).close();
          }
        } catch (closeError) {
          console.warn(`Failed to close existing transport for ${serverInfo.name}:`, closeError);
        }

        console.log(
          `Rebuilding transport with refreshed credentials for server: ${serverInfo.name}`,
        );
        const refreshedTransport = await createTransportFromConfig(
          serverInfo.name,
          effectiveConfig,
        );
        serverInfo.transport = refreshedTransport;

        // Update server status to indicate OAuth is complete
        serverInfo.status = 'connected';
        if (serverInfo.oauth) {
          serverInfo.oauth.authorizationUrl = undefined;
          serverInfo.oauth.state = undefined;
          serverInfo.oauth.codeVerifier = undefined;
        }

        // Check if client needs to be connected
        const isClientConnected = serverInfo.client && serverInfo.client.getServerCapabilities();

        if (!isClientConnected) {
          // Client is not connected yet, connect it
          if (serverInfo.client && serverInfo.transport) {
            console.log(`Connecting client with refreshed transport for: ${serverInfo.name}`);
            try {
              await serverInfo.client.connect(serverInfo.transport, serverInfo.options);
              console.log(`Client connected successfully for: ${serverInfo.name}`);

              // List tools after successful connection
              const capabilities = serverInfo.client.getServerCapabilities();
              console.log(
                `Server capabilities for ${serverInfo.name}:`,
                JSON.stringify(capabilities),
              );

              if (capabilities?.tools) {
                console.log(`Listing tools for server: ${serverInfo.name}`);
                const toolsResult = await serverInfo.client.listTools({}, serverInfo.options);
                const separator = getNameSeparator();
                serverInfo.tools = toolsResult.tools.map((tool) => ({
                  name: `${serverInfo.name}${separator}${tool.name}`,
                  description: tool.description || '',
                  inputSchema: tool.inputSchema || {},
                }));
                console.log(
                  `Listed ${serverInfo.tools.length} tools for server: ${serverInfo.name}`,
                );
              } else {
                console.log(`Server ${serverInfo.name} does not support tools capability`);
              }
            } catch (connectError) {
              console.error(`Error connecting client for ${serverInfo.name}:`, connectError);
              if (connectError instanceof Error) {
                console.error(
                  `Connect error details for ${serverInfo.name}: ${connectError.message}`,
                  connectError.stack,
                );
              }
              // Even if connection fails, mark OAuth as complete
              // The user can try reconnecting from the dashboard
            }
          } else {
            console.log(
              `Cannot connect client for ${serverInfo.name}: client or transport missing`,
            );
          }
        } else {
          console.log(`Client already connected for server: ${serverInfo.name}`);
        }

        console.log(`Successfully completed OAuth flow for server: ${serverInfo.name}`);

        // Return success page
        return res.status(200).send(
          generateHtmlResponse(
            'success',
            t('oauthCallback.authorizationSuccessful'),
            `${t('oauthCallback.successMessage')}\n${t('oauthCallback.autoCloseMessage')}`,
            [
              { label: t('oauthCallback.server'), value: serverInfo.name },
              { label: t('oauthCallback.status'), value: t('oauthCallback.connected') },
            ],
            true, // auto-close
          ),
        );
      } catch (error) {
        console.error(`Failed to complete OAuth flow for server ${serverInfo.name}:`, error);
        console.error(`Error type: ${typeof error}, Error name: ${error?.constructor?.name}`);
        console.error(`Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`Error stack:`, error instanceof Error ? error.stack : 'No stack trace');

        return res
          .status(500)
          .send(
            generateHtmlResponse(
              'error',
              t('oauthCallback.connectionError'),
              `${t('oauthCallback.connectionErrorMessage')}\n${t('oauthCallback.reconnectMessage')}`,
              [{ label: '', value: error instanceof Error ? error.message : String(error) }],
            ),
          );
      }
    } else {
      // No transport available or transport doesn't support finishAuth
      console.error(`Transport for server ${serverInfo.name} does not support finishAuth()`);
      return res
        .status(500)
        .send(
          generateHtmlResponse(
            'error',
            t('oauthCallback.configurationError'),
            t('oauthCallback.configurationErrorMessage'),
          ),
        );
    }
  } catch (error) {
    console.error('Unexpected error handling OAuth callback:', error);

    // Get translation function from request (set by i18n middleware)
    const t = (req as any).t || ((key: string) => key);

    return res
      .status(500)
      .send(
        generateHtmlResponse(
          'error',
          t('oauthCallback.internalError'),
          t('oauthCallback.internalErrorMessage'),
        ),
      );
  }
};
