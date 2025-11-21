import { Request, Response } from 'express';
import {
  getOAuthServer,
  handleTokenRequest,
  handleAuthenticateRequest,
} from '../services/oauthServerService.js';
import { findOAuthClientById } from '../models/OAuth.js';
import { loadSettings } from '../config/index.js';
import OAuth2Server from '@node-oauth/oauth2-server';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt.js';

const { Request: OAuth2Request, Response: OAuth2Response } = OAuth2Server;

type AuthenticatedUser = {
  username: string;
  isAdmin?: boolean;
};

/**
 * Attempt to attach a user to the request based on a JWT token present in header, query, or body.
 */
function resolveUserFromRequest(req: Request): AuthenticatedUser | null {
  const headerToken = req.header('x-auth-token');
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const bodyToken =
    req.body && typeof (req.body as Record<string, unknown>).token === 'string'
      ? ((req.body as Record<string, string>).token as string)
      : undefined;
  const token = headerToken || queryToken || bodyToken;

  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { user?: AuthenticatedUser };
    if (decoded?.user) {
      return decoded.user;
    }
  } catch (error) {
    console.warn('Invalid JWT supplied to OAuth authorize endpoint:', error);
  }

  return null;
}

/**
 * Helper function to escape HTML
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Helper function to validate query parameters
 */
function validateQueryParam(value: any, name: string, pattern?: RegExp): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  if (pattern && !pattern.test(value)) {
    throw new Error(`${name} has invalid format`);
  }
  return value;
}

/**
 * Generate OAuth authorization consent HTML page with i18n support
 * (keeps visual style consistent with OAuth callback pages)
 */
const generateAuthorizeHtml = (
  title: string,
  message: string,
  options: {
    clientName: string;
    scopes: { name: string; description: string }[];
    approveLabel: string;
    denyLabel: string;
    approveButtonLabel: string;
    denyButtonLabel: string;
    formFields: string;
  },
): string => {
  const backgroundColor = '#eef5ff';
  const borderColor = '#c3d4ff';
  const titleColor = '#23408f';
  const approveColor = '#2563eb';
  const denyColor = '#ef4444';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 40px auto; padding: 24px; background: #f3f4f6; }
          .container { background-color: ${backgroundColor}; border: 1px solid ${borderColor}; padding: 24px 28px; border-radius: 12px; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.12); }
          h1 { color: ${titleColor}; margin-top: 0; font-size: 22px; display: flex; align-items: center; gap: 8px; }
          h1 span.icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 999px; background: white; border: 1px solid ${borderColor}; font-size: 16px; }
          p.subtitle { margin-top: 8px; margin-bottom: 20px; color: #4b5563; font-size: 14px; }
          .client-box { margin: 16px 0 20px; padding: 14px 16px; background: #eef2ff; border-radius: 10px; border: 1px solid #e5e7eb; display: flex; flex-direction: column; gap: 4px; }
          .client-box-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
          .client-box-name { font-weight: 600; color: #111827; }
          .scopes { margin: 22px 0 16px; }
          .scopes-title { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 8px; }
          .scope-item { padding: 8px 0; border-bottom: 1px solid #e5e7eb; display: flex; flex-direction: column; gap: 2px; }
          .scope-item:last-child { border-bottom: none; }
          .scope-name { font-weight: 600; font-size: 13px; color: #111827; }
          .scope-description { font-size: 12px; color: #4b5563; }
          .buttons { margin-top: 26px; display: flex; gap: 12px; }
          .buttons form { flex: 1; }
          button { width: 100%; padding: 10px 14px; border-radius: 999px; cursor: pointer; font-size: 14px; font-weight: 500; border-width: 1px; border-style: solid; transition: background-color 120ms ease, box-shadow 120ms ease, transform 60ms ease; }
          button.approve { background: ${approveColor}; color: white; border-color: ${approveColor}; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35); }
          button.approve:hover { background: #1d4ed8; box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45); transform: translateY(-1px); }
          button.deny { background: white; color: ${denyColor}; border-color: ${denyColor}; }
          button.deny:hover { background: #fef2f2; }
          .button-label { display: block; }
          .button-sub { display: block; font-size: 11px; opacity: 0.85; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1><span class="icon">🔐</span>${escapeHtml(title)}</h1>
          <p class="subtitle">${escapeHtml(message)}</p>
          <div class="client-box">
            <span class="client-box-label">${escapeHtml(options.clientName ? 'Application' : 'Client')}</span>
            <span class="client-box-name">${escapeHtml(options.clientName || '')}</span>
          </div>
          <div class="scopes">
            <div class="scopes-title">${escapeHtml('This application will be able to:')}</div>
            ${options.scopes
              .map(
                (s) => `
                  <div class="scope-item">
                    <span class="scope-name">${escapeHtml(s.name)}</span>
                    <span class="scope-description">${escapeHtml(s.description)}</span>
                  </div>
                `,
              )
              .join('')}
          </div>
          <div class="buttons">
            <form method="POST" action="/oauth/authorize">
              ${options.formFields}
              <input type="hidden" name="allow" value="true" />
              <button type="submit" class="approve">
                <span class="button-label">${escapeHtml(options.approveLabel)}</span>
                <span class="button-sub">${escapeHtml(options.approveButtonLabel)}</span>
              </button>
            </form>
            <form method="POST" action="/oauth/authorize">
              ${options.formFields}
              <input type="hidden" name="allow" value="false" />
              <button type="submit" class="deny">
                <span class="button-label">${escapeHtml(options.denyLabel)}</span>
                <span class="button-sub">${escapeHtml(options.denyButtonLabel)}</span>
              </button>
            </form>
          </div>
        </div>
      </body>
    </html>
  `;
};

/**
 * GET /oauth/authorize
 * Display authorization page or handle authorization
 */
export const getAuthorize = async (req: Request, res: Response): Promise<void> => {
  try {
    const oauth = getOAuthServer();
    if (!oauth) {
      res.status(503).json({ error: 'OAuth server not available' });
      return;
    }

    // Get and validate query parameters
    const client_id = validateQueryParam(req.query.client_id, 'client_id', /^[a-zA-Z0-9_-]+$/);
    const redirect_uri = validateQueryParam(req.query.redirect_uri, 'redirect_uri');
    const response_type = validateQueryParam(req.query.response_type, 'response_type', /^code$/);
    const scope = req.query.scope
      ? validateQueryParam(req.query.scope, 'scope', /^[a-zA-Z0-9_ ]+$/)
      : undefined;
    const state = req.query.state
      ? validateQueryParam(req.query.state, 'state', /^[a-zA-Z0-9_-]+$/)
      : undefined;
    const code_challenge = req.query.code_challenge
      ? validateQueryParam(req.query.code_challenge, 'code_challenge', /^[a-zA-Z0-9_-]+$/)
      : undefined;
    const code_challenge_method = req.query.code_challenge_method
      ? validateQueryParam(
          req.query.code_challenge_method,
          'code_challenge_method',
          /^(S256|plain)$/,
        )
      : undefined;

    // Validate required parameters
    if (!client_id || !redirect_uri || !response_type) {
      res
        .status(400)
        .json({ error: 'invalid_request', error_description: 'Missing required parameters' });
      return;
    }

    // Verify client
    const client = findOAuthClientById(client_id as string);
    if (!client) {
      res.status(400).json({ error: 'invalid_client', error_description: 'Client not found' });
      return;
    }

    // Verify redirect URI
    if (!client.redirectUris.includes(redirect_uri as string)) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
      return;
    }

    // Check if user is authenticated (including via JWT token)
    let user = (req as any).user;
    if (!user) {
      const tokenUser = resolveUserFromRequest(req);
      if (tokenUser) {
        (req as any).user = tokenUser;
        user = tokenUser;
      }
    }

    if (!user) {
      // Redirect to login page with return URL
      const returnUrl = encodeURIComponent(req.originalUrl);
      res.redirect(`/login?returnUrl=${returnUrl}`);
      return;
    }

    const requestToken = typeof req.query.token === 'string' ? req.query.token : '';
    const tokenField = requestToken
      ? `<input type="hidden" name="token" value="${escapeHtml(requestToken)}">`
      : '';

    // Get translation function from request (set by i18n middleware)
    const t = (req as any).t || ((key: string) => key);

    const scopes = (scope || 'read write')
      .split(' ')
      .filter((s) => s)
      .map((s) => ({ name: s, description: getScopeDescription(s) }));

    const formFields = `
      <input type="hidden" name="client_id" value="${escapeHtml(client_id)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}" />
      <input type="hidden" name="response_type" value="${escapeHtml(response_type)}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope || '')}" />
      <input type="hidden" name="state" value="${escapeHtml(state || '')}" />
      ${code_challenge ? `<input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}" />` : ''}
      ${code_challenge_method ? `<input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}" />` : ''}
      ${tokenField}
    `;

    // Render authorization consent page with consistent, localized styling
    res.send(
      generateAuthorizeHtml(
        t('oauthServer.authorizeTitle') || 'Authorize Application',
        t('oauthServer.authorizeSubtitle') ||
          'Allow this application to access your MCPHub account.',
        {
          clientName: client.name,
          scopes,
          approveLabel: t('oauthServer.buttons.approve') || 'Allow access',
          denyLabel: t('oauthServer.buttons.deny') || 'Deny',
          approveButtonLabel:
            t('oauthServer.buttons.approveSubtitle') ||
            'Recommended if you trust this application.',
          denyButtonLabel:
            t('oauthServer.buttons.denySubtitle') || 'You can always grant access later.',
          formFields,
        },
      ),
    );
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
  }
};

/**
 * POST /oauth/authorize
 * Handle authorization decision
 */
export const postAuthorize = async (req: Request, res: Response): Promise<void> => {
  try {
    const oauth = getOAuthServer();
    if (!oauth) {
      res.status(503).json({ error: 'OAuth server not available' });
      return;
    }

    const { allow, redirect_uri, state } = req.body;

    // If user denied
    if (allow !== 'true') {
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('error', 'access_denied');
      if (state) {
        redirectUrl.searchParams.set('state', state);
      }
      res.redirect(redirectUrl.toString());
      return;
    }

    // Get authenticated user (JWT support for browser form submissions)
    let user = (req as any).user;
    if (!user) {
      const tokenUser = resolveUserFromRequest(req);
      if (tokenUser) {
        (req as any).user = tokenUser;
        user = tokenUser;
      }
    }

    if (!user) {
      res.status(401).json({ error: 'unauthorized', error_description: 'User not authenticated' });
      return;
    }

    // Create OAuth request/response
    const request = new OAuth2Request(req);
    const response = new OAuth2Response(res);

    // Authorize the request
    const code = await oauth.authorize(request, response, {
      authenticateHandler: {
        handle: async () => user,
      },
    });

    // Build redirect URL with authorization code
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code.authorizationCode);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Authorization error:', error);

    // Handle OAuth errors
    if (error instanceof Error && 'code' in error) {
      const oauthError = error as any;
      const redirect_uri = req.body.redirect_uri;
      const state = req.body.state;

      if (redirect_uri) {
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('error', oauthError.name || 'server_error');
        if (oauthError.message) {
          redirectUrl.searchParams.set('error_description', oauthError.message);
        }
        if (state) {
          redirectUrl.searchParams.set('state', state);
        }
        res.redirect(redirectUrl.toString());
      } else {
        res.status(400).json({
          error: oauthError.name || 'server_error',
          error_description: oauthError.message || 'Internal server error',
        });
      }
    } else {
      res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
    }
  }
};

/**
 * POST /oauth/token
 * Exchange authorization code for access token
 */
export const postToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = await handleTokenRequest(req, res);
    res.json({
      access_token: token.accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(((token.accessTokenExpiresAt?.getTime() || 0) - Date.now()) / 1000),
      refresh_token: token.refreshToken,
      scope: Array.isArray(token.scope) ? token.scope.join(' ') : token.scope,
    });
  } catch (error) {
    console.error('Token error:', error);

    if (error instanceof Error && 'code' in error) {
      const oauthError = error as any;
      res.status(oauthError.code || 400).json({
        error: oauthError.name || 'invalid_request',
        error_description: oauthError.message || 'Token request failed',
      });
    } else {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Token request failed',
      });
    }
  }
};

/**
 * GET /oauth/userinfo
 * Get user info from access token (OpenID Connect compatible)
 */
export const getUserInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = await handleAuthenticateRequest(req, res);

    res.json({
      sub: token.user.username,
      username: token.user.username,
      // Add more user info as needed
    });
  } catch (error) {
    console.error('UserInfo error:', error);
    res.status(401).json({
      error: 'invalid_token',
      error_description: 'Invalid or expired access token',
    });
  }
};

/**
 * GET /.well-known/oauth-authorization-server
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 */
export const getMetadata = async (req: Request, res: Response): Promise<void> => {
  try {
    const settings = loadSettings();
    const oauthConfig = settings.systemConfig?.oauthServer;

    if (!oauthConfig || !oauthConfig.enabled) {
      res.status(404).json({ error: 'OAuth server not configured' });
      return;
    }

    const baseUrl =
      settings.systemConfig?.install?.baseUrl || `${req.protocol}://${req.get('host')}`;
    const allowedScopes = oauthConfig.allowedScopes || ['read', 'write'];

    const metadata: any = {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
      scopes_supported: allowedScopes,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported:
        oauthConfig.requireClientSecret !== false
          ? ['client_secret_basic', 'client_secret_post', 'none']
          : ['none'],
      code_challenge_methods_supported: ['S256', 'plain'],
    };

    // Add dynamic registration endpoint if enabled
    if (oauthConfig.dynamicRegistration?.enabled) {
      metadata.registration_endpoint = `${baseUrl}/oauth/register`;
    }

    res.json(metadata);
  } catch (error) {
    console.error('Metadata error:', error);
    res.status(500).json({ error: 'server_error' });
  }
};

/**
 * GET /.well-known/oauth-protected-resource
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 * Provides information about authorization servers that protect this resource
 */
export const getProtectedResourceMetadata = async (req: Request, res: Response): Promise<void> => {
  try {
    const settings = loadSettings();
    const oauthConfig = settings.systemConfig?.oauthServer;

    if (!oauthConfig || !oauthConfig.enabled) {
      res.status(404).json({ error: 'OAuth server not configured' });
      return;
    }

    const baseUrl =
      settings.systemConfig?.install?.baseUrl || `${req.protocol}://${req.get('host')}`;
    const allowedScopes = oauthConfig.allowedScopes || ['read', 'write'];

    // Return protected resource metadata according to RFC 9728
    res.json({
      resource: baseUrl,
      authorization_servers: [baseUrl],
      scopes_supported: allowedScopes,
      bearer_methods_supported: ['header'],
    });
  } catch (error) {
    console.error('Protected resource metadata error:', error);
    res.status(500).json({ error: 'server_error' });
  }
};

/**
 * Helper function to get scope description
 */
function getScopeDescription(scope: string): string {
  const descriptions: Record<string, string> = {
    read: 'Read access to your MCP servers and tools',
    write: 'Execute tools and modify MCP server configurations',
    admin: 'Administrative access to all resources',
  };
  return descriptions[scope] || 'Access to MCPHub resources';
}
