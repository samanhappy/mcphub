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
  updateServerToolsCache,
} from '../services/mcpService.js';
import { replaceEnvVars } from '../config/index.js';
import { loadServerConfig } from '../services/oauthSettingsStore.js';
import type { ServerInfo } from '../types/index.js';

/**
 * Basic HTML escaping helper to prevent XSS in generated pages.
 */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Generate HTML response page with i18n support.
 *
 * Styling mirrors the OAuth authorize consent page (oauthServerController) so the
 * flow feels continuous for end users, and adapts to light/dark color schemes.
 */
const generateHtmlResponse = (
  t: (key: string) => string,
  type: 'error' | 'success',
  title: string,
  message: string,
  details?: { label: string; value: string }[],
  autoClose: boolean = false,
): string => {
  const isSuccess = type === 'success';
  const accentColor = isSuccess ? '#16a34a' : '#dc2626';
  const accentBgLight = isSuccess ? '#dcfce7' : '#fee2e2';
  const accentBgDark = isSuccess ? '#14532d' : '#7f1d1d';
  const icon = isSuccess ? '✓' : '⚠';

  const safeTitle = escapeHtml(title);
  // Render multi-line messages (joined with \n by callers) as line breaks.
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br />');
  const closeButtonLabel = escapeHtml(
    t(autoClose ? 'oauthCallback.closeNow' : 'oauthCallback.closeWindow'),
  );
  const autoCloseNotice = escapeHtml(t('oauthCallback.autoCloseMessage'));

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${safeTitle}</title>
        <style>
          :root { color-scheme: light dark; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 60px auto; padding: 24px; background: #f3f4f6; color: #111827; }
          .container { background-color: #ffffff; border: 1px solid #e5e7eb; padding: 28px; border-radius: 12px; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.12); }
          h1 { margin-top: 0; font-size: 22px; display: flex; align-items: center; gap: 10px; color: #111827; }
          h1 .icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 999px; background: ${accentBgLight}; color: ${accentColor}; font-size: 18px; font-weight: 700; }
          p.message { color: #4b5563; font-size: 14px; line-height: 1.6; margin: 12px 0 0; }
          .detail { margin-top: 12px; padding: 12px 14px; background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 8px; font-size: 13px; color: #374151; }
          .detail strong { color: #111827; }
          .detail.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
          .autoclose { margin-top: 12px; color: #6b7280; font-size: 13px; }
          .close-btn { margin-top: 24px; padding: 10px 20px; background: #2563eb; color: #ffffff; border: none; border-radius: 999px; cursor: pointer; font-size: 14px; font-weight: 500; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35); transition: background-color 120ms ease, transform 60ms ease; }
          .close-btn:hover { background: #1d4ed8; transform: translateY(-1px); }
          @media (prefers-color-scheme: dark) {
            body { background: #0f172a; color: #e5e7eb; }
            .container { background-color: #1e293b; border-color: #334155; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4); }
            h1 { color: #f1f5f9; }
            h1 .icon { background: ${accentBgDark}; }
            p.message { color: #cbd5e1; }
            .detail { background: #0f172a; border-color: #334155; color: #cbd5e1; }
            .detail strong { color: #f1f5f9; }
            .autoclose { color: #94a3b8; }
          }
        </style>
        ${autoClose ? '<script>setTimeout(() => { window.close(); }, 3000);</script>' : ''}
      </head>
      <body>
        <div class="container">
          <h1><span class="icon">${icon}</span>${safeTitle}</h1>
          ${
            details
              ? details
                  .map(
                    (d) =>
                      `<div class="detail${type === 'error' ? ' mono' : ''}">${d.label ? `<strong>${escapeHtml(d.label)}:</strong> ` : ''}${escapeHtml(d.value)}</div>`,
                  )
                  .join('')
              : ''
          }
          ${message ? `<p class="message">${safeMessage}</p>` : ''}
          ${autoClose ? `<p class="autoclose">${autoCloseNotice}</p>` : ''}
          <button class="close-btn" onclick="window.close()">${closeButtonLabel}</button>
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
      console.error('OAuth authorization failed', {
        error,
        errorDescription: error_description || '',
      });
      return res.status(400).send(
        generateHtmlResponse(t, 'error', t('oauthCallback.authorizationFailed'), '', [
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
            t,
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
            t,
            'error',
            t('oauthCallback.invalidRequest'),
            t('oauthCallback.missingCodeParameter'),
          ),
        );
    }

    console.log('OAuth callback received', { hasCode: true, state: stateParam });

    // Find server by state parameter
    let serverInfo: ServerInfo | undefined;

    serverInfo = getServerByOAuthState(stateParam);

    let decodedServerName: string | undefined;
    if (!serverInfo) {
      decodedServerName = extractServerNameFromState(stateParam);
      if (decodedServerName) {
        console.log('State lookup failed; decoded server name from state', {
          decodedServerName,
        });
        serverInfo = getServerByName(decodedServerName);
      }
    }

    if (!serverInfo) {
      console.error('No server found for OAuth callback', {
        state: stateParam,
        decodedServerName,
      });
      return res
        .status(400)
        .send(
          generateHtmlResponse(
            t,
            'error',
            t('oauthCallback.serverNotFound'),
            `${t('oauthCallback.serverNotFoundMessage')}\n${t('oauthCallback.sessionExpiredMessage')}`,
          ),
        );
    }

    // Optional: Validate state parameter for additional security
    if (serverInfo.oauth?.state && serverInfo.oauth.state !== stateParam) {
      console.warn('OAuth state mismatch detected', {
        serverName: serverInfo.name,
        // State values are considered sensitive and are not logged
        expectedState: '<redacted>',
        receivedState: '<redacted>',
      });
      // Note: We log a warning but don't fail the request since we have server name as primary identifier
    }

    console.log('Processing OAuth callback for server', { serverName: serverInfo.name });

    // For StreamableHTTPClientTransport, we need to call finishAuth() on the transport
    // This will exchange the authorization code for tokens automatically
    if (serverInfo.transport && 'finishAuth' in serverInfo.transport) {
      try {
        console.log('Calling transport.finishAuth for server', { serverName: serverInfo.name });
        const currentTransport = serverInfo.transport as any;
        await currentTransport.finishAuth(codeParam);

        console.log('Successfully exchanged authorization code for tokens', {
          serverName: serverInfo.name,
        });

        // Refresh server configuration from storage (DB or file) to pick up newly saved tokens.
        // loadServerConfig is DAO-backed and handles both DB and file modes, so a redundant
        // loadSettings() call is not needed. Apply replaceEnvVars so fields like url/command
        // have environment variable references expanded, consistent with initial server setup.
        const freshConfig = await loadServerConfig(serverInfo.name);
        const effectiveConfig = freshConfig
          ? (replaceEnvVars(freshConfig as any) as typeof freshConfig)
          : serverInfo.config;

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
            resetTimeoutOnProgress: requestConfig.resetTimeoutOnProgress ?? true,
            maxTotalTimeout: requestConfig.maxTotalTimeout,
          };
        }

        // Replace the existing transport instance to avoid reusing a closed/aborted transport
        try {
          if (serverInfo.transport && 'close' in serverInfo.transport) {
            await (serverInfo.transport as any).close();
          }
        } catch (closeError) {
          console.warn('Failed to close existing transport during OAuth reconnect', {
            serverName: serverInfo.name,
            error: closeError,
          });
        }

        console.log('Rebuilding transport with refreshed credentials', {
          serverName: serverInfo.name,
        });
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
            console.log('Connecting client with refreshed transport', {
              serverName: serverInfo.name,
            });
            try {
              await serverInfo.client.connect(serverInfo.transport, serverInfo.options);
              console.log('Client connected successfully after OAuth callback', {
                serverName: serverInfo.name,
              });

              // List tools after successful connection
              const capabilities = serverInfo.client.getServerCapabilities();
              console.log('Server capabilities after OAuth callback', {
                serverName: serverInfo.name,
                capabilities,
              });

              if (capabilities?.tools) {
                console.log('Listing tools after OAuth callback', {
                  serverName: serverInfo.name,
                });
                const toolsResult = await serverInfo.client.listTools({}, serverInfo.options);
                updateServerToolsCache(serverInfo, toolsResult.tools);
                console.log('Listed tools after OAuth callback', {
                  serverName: serverInfo.name,
                  toolCount: serverInfo.tools.length,
                });
              } else {
                console.log('Server does not support tools capability after OAuth callback', {
                  serverName: serverInfo.name,
                });
              }
            } catch (connectError) {
              console.error('Error connecting client after OAuth callback', {
                serverName: serverInfo.name,
                error: connectError,
              });
              if (connectError instanceof Error) {
                console.error('Connect error details after OAuth callback', {
                  serverName: serverInfo.name,
                  message: connectError.message,
                  stack: connectError.stack,
                });
              }
              // Even if connection fails, mark OAuth as complete
              // The user can try reconnecting from the dashboard
            }
          } else {
            console.log(
              'Cannot connect client after OAuth callback because client or transport is missing',
              { serverName: serverInfo.name },
            );
          }
        } else {
          console.log('Client already connected after OAuth callback', {
            serverName: serverInfo.name,
          });
        }

        console.log('Successfully completed OAuth flow for server', {
          serverName: serverInfo.name,
        });

        // Return success page
        return res.status(200).send(
          generateHtmlResponse(
            t,
            'success',
            t('oauthCallback.authorizationSuccessful'),
            t('oauthCallback.successMessage'),
            [
              { label: t('oauthCallback.server'), value: serverInfo.name },
              { label: t('oauthCallback.status'), value: t('oauthCallback.connected') },
            ],
            true, // auto-close
          ),
        );
      } catch (error) {
        console.error('Failed to complete OAuth flow for server', {
          serverName: serverInfo.name,
          error,
        });
        console.error('OAuth callback error details', {
          serverName: serverInfo.name,
          errorType: typeof error,
          errorName: error?.constructor?.name,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : 'No stack trace',
        });

        return res
          .status(500)
          .send(
            generateHtmlResponse(
              t,
              'error',
              t('oauthCallback.connectionError'),
              `${t('oauthCallback.connectionErrorMessage')}\n${t('oauthCallback.reconnectMessage')}`,
              [{ label: '', value: error instanceof Error ? error.message : String(error) }],
            ),
          );
      }
    } else {
      // No transport available or transport doesn't support finishAuth
        console.error('Transport does not support finishAuth', { serverName: serverInfo.name });
      return res
        .status(500)
        .send(
          generateHtmlResponse(
            t,
            'error',
            t('oauthCallback.configurationError'),
            t('oauthCallback.configurationErrorMessage'),
          ),
        );
    }
  } catch (error) {
    console.error('Unexpected error handling OAuth callback', { error });

    // Get translation function from request (set by i18n middleware)
    const t = (req as any).t || ((key: string) => key);

    return res
      .status(500)
      .send(
        generateHtmlResponse(
          t,
          'error',
          t('oauthCallback.internalError'),
          t('oauthCallback.internalErrorMessage'),
        ),
      );
  }
};
