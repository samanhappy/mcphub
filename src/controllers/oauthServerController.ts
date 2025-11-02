import { Request, Response } from 'express';
import {
  getOAuthServer,
  handleTokenRequest,
  handleAuthenticateRequest,
} from '../services/oauthServerService.js';
import { findOAuthClientById } from '../models/OAuth.js';
import { loadSettings } from '../config/index.js';
import OAuth2Server from '@node-oauth/oauth2-server';

const { Request: OAuth2Request, Response: OAuth2Response } = OAuth2Server;

/**
 * Helper function to escape HTML
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    const scope = req.query.scope ? validateQueryParam(req.query.scope, 'scope', /^[a-zA-Z0-9_ ]+$/) : undefined;
    const state = req.query.state ? validateQueryParam(req.query.state, 'state', /^[a-zA-Z0-9_-]+$/) : undefined;
    const code_challenge = req.query.code_challenge ? validateQueryParam(req.query.code_challenge, 'code_challenge', /^[a-zA-Z0-9_-]+$/) : undefined;
    const code_challenge_method = req.query.code_challenge_method ? validateQueryParam(req.query.code_challenge_method, 'code_challenge_method', /^(S256|plain)$/) : undefined;

    // Validate required parameters
    if (!client_id || !redirect_uri || !response_type) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
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

    // Check if user is authenticated
    const user = (req as any).user;
    if (!user) {
      // Redirect to login page with return URL
      const returnUrl = encodeURIComponent(req.originalUrl);
      res.redirect(`/login?returnUrl=${returnUrl}`);
      return;
    }

    // Render authorization consent page
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorize Application</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 500px;
              margin: 50px auto;
              padding: 20px;
            }
            .consent-box {
              border: 1px solid #ddd;
              border-radius: 8px;
              padding: 30px;
              background: #f9f9f9;
            }
            h2 {
              color: #333;
              margin-top: 0;
            }
            .client-info {
              margin: 20px 0;
              padding: 15px;
              background: white;
              border-radius: 4px;
            }
            .scopes {
              margin: 20px 0;
            }
            .scope-item {
              padding: 8px 0;
              border-bottom: 1px solid #eee;
            }
            .buttons {
              margin-top: 30px;
              display: flex;
              gap: 10px;
            }
            button {
              flex: 1;
              padding: 12px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 16px;
            }
            .approve {
              background: #4CAF50;
              color: white;
            }
            .deny {
              background: #f44336;
              color: white;
            }
            .approve:hover {
              background: #45a049;
            }
            .deny:hover {
              background: #da190b;
            }
          </style>
        </head>
        <body>
          <div class="consent-box">
            <h2>Authorize Application</h2>
            <div class="client-info">
              <strong>${client.name}</strong> is requesting access to your MCPHub account.
            </div>
            <div class="scopes">
              <h3>This application will be able to:</h3>
              ${(scope || 'read write').split(' ').map(s => `
                <div class="scope-item">
                  <strong>${escapeHtml(s)}</strong> - ${escapeHtml(getScopeDescription(s))}
                </div>
              `).join('')}
            </div>
            <div class="buttons">
              <form method="POST" action="/oauth/authorize" style="flex: 1;">
                <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
                <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}">
                <input type="hidden" name="response_type" value="${escapeHtml(response_type)}">
                <input type="hidden" name="scope" value="${escapeHtml(scope || '')}">
                <input type="hidden" name="state" value="${escapeHtml(state || '')}">
                ${code_challenge ? `<input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">` : ''}
                ${code_challenge_method ? `<input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}">` : ''}
                <input type="hidden" name="allow" value="true">
                <button type="submit" class="approve">Approve</button>
              </form>
              <form method="POST" action="/oauth/authorize" style="flex: 1;">
                <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
                <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}">
                <input type="hidden" name="state" value="${escapeHtml(state || '')}">
                <input type="hidden" name="allow" value="false">
                <button type="submit" class="deny">Deny</button>
              </form>
            </div>
          </div>
        </body>
      </html>
    `);
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

    // Get authenticated user
    const user = (req as any).user;
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
          error_description: oauthError.message || 'Internal server error'
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

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const allowedScopes = oauthConfig.allowedScopes || ['read', 'write'];

    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
      scopes_supported: allowedScopes,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: oauthConfig.requireClientSecret !== false 
        ? ['client_secret_basic', 'client_secret_post']
        : ['none'],
      code_challenge_methods_supported: ['S256', 'plain'],
    });
  } catch (error) {
    console.error('Metadata error:', error);
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
