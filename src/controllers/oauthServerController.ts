import config from '../config/index.js';
import {
  getDashboardSession,
  getLegacyQueryToken,
  requireDashboardOrigin,
} from '../middlewares/dashboardSession.js';
import {
  findReusableApproval,
  isApprovalGrantValid,
  resolveConsentScopes,
} from '../services/oauthApprovalService.js';
import { getUserSessionVersion, resolveJwtUser, resolveUserSession } from '../utils/userSession.js';
import { Request, Response } from 'express';
import {
  getOAuthServer,
  handleTokenRequest,
  handleAuthenticateRequest,
} from '../services/oauthServerService.js';
import { findOAuthClientIncludingCimd, isCimdClientId } from '../services/cimdClientService.js';
import { getSystemConfigDao, getGroupDao, getServerDao } from '../dao/index.js';
import OAuth2Server from '@node-oauth/oauth2-server';
import { resolveBetterAuthUser } from '../services/betterAuthSession.js';
import { cloneDefaultOAuthServerConfig } from '../constants/oauthServerDefaults.js';
import {
  getPublicInstallBaseUrl,
  getProtectedResourceUrlFromMetadataRequest,
} from '../utils/protectedResource.js';
import { logger } from '../utils/logger.js';
import {
  injectOAuthConsentShell,
  type OAuthConsentContext,
  type ConsentClientInfo,
} from '../utils/frontendShell.js';
import { parseResourceTarget, type ResourceTarget } from '../utils/oauthConsentResource.js';
import {
  PersonalOAuthContext,
  PERSONAL_OAUTH_FLOW_TTL_MS,
  hasUsablePersonalOAuthGrant,
} from '../services/personalOAuthService.js';
import {
  buildClientErrorRedirectUrl,
  createBrowserNonce,
  resolveSingleServerPersonalOAuthTarget,
  setBrowserNonceCookie,
} from '../services/personalOAuthContinuationService.js';
import type { PendingPersonalOAuthContinuation } from '../types/index.js';

const { Request: OAuth2Request, Response: OAuth2Response } = OAuth2Server;

type AuthenticatedUser = {
  username: string;
  isAdmin?: boolean;
  sessionVersion?: string;
  credentialEligible?: boolean;
};

type AuthorizeUser = AuthenticatedUser & {
  approvalId?: string;
  approvalContext?: { redirectUri: string; resource: string };
};

/**
 * Bridge a Better Auth session cookie into req.user for the OAuth Server consent flow.
 *
 * The shared `auth` middleware is only mounted under /api/*, so /oauth/authorize never
 * sees the Better Auth cookie that social-login (GitHub / Google) users carry. Without
 * this helper, those users end up in a /login ↔ /oauth/authorize redirect loop (GET) or
 * receive a 401 after clicking "Allow access" (POST). See issue #815.
 *
 * On success the resolved user is attached to req.user so the caller does not have to
 * repeat that assignment at every call site.
 */
async function resolveBetterAuthUserForAuthorize(req: Request): Promise<AuthenticatedUser | null> {
  try {
    const user = await resolveBetterAuthUser(req);
    if (user) {
      const authenticatedUser: AuthenticatedUser = {
        username: user.username,
        isAdmin: !!user.isAdmin,
        sessionVersion: getUserSessionVersion(user),
      };
      (req as any).user = authenticatedUser;
      return authenticatedUser;
    }
  } catch (error) {
    logger.warn('Better Auth lookup failed in /oauth/authorize:', error);
  }
  return null;
}

/**
 * Attempt to attach a user to the request based on a JWT token present in header, query, or body.
 */
async function resolveUserFromRequest(req: Request): Promise<AuthenticatedUser | null> {
  const headerToken = req.header('x-auth-token');
  const bodyToken =
    req.body && typeof (req.body as Record<string, unknown>).token === 'string'
      ? ((req.body as Record<string, string>).token as string)
      : undefined;
  const token = headerToken || getDashboardSession(req) || getLegacyQueryToken(req) || bodyToken;

  if (!token) {
    return null;
  }

  const user = await resolveJwtUser(token);
  return user
    ? {
        username: user.username,
        isAdmin: !!user.isAdmin,
        sessionVersion: getUserSessionVersion(user),
      }
    : null;
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

async function validateClientRedirectUri(
  res: Response,
  clientId: unknown,
  redirectUri: unknown,
): Promise<string | null> {
  if (typeof clientId !== 'string' || !clientId) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing client_id',
    });
    return null;
  }

  if (typeof redirectUri !== 'string' || !redirectUri) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing redirect_uri',
    });
    return null;
  }

  const client = await findOAuthClientIncludingCimd(clientId);
  if (!client) {
    res.status(400).json({ error: 'invalid_client', error_description: 'Client not found' });
    return null;
  }

  if (!client.redirectUris.includes(redirectUri)) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Invalid redirect_uri',
    });
    return null;
  }

  return redirectUri;
}

/**
 * Resolve this install's issuer identifier (RFC 9207). Uses the same
 * resolution chain as the RFC 8414 metadata endpoint (`issuer` field) so
 * clients validating `iss` compare against a value they can discover.
 */
export async function resolveIssuer(req: Request): Promise<string | undefined> {
  try {
    const systemConfig = await getSystemConfigDao().get();
    return getPublicInstallBaseUrl(req, systemConfig);
  } catch {
    return undefined;
  }
}

/**
 * Attach the RFC 9207 `iss` parameter to an authorization response redirect.
 * A no-op when the issuer cannot be resolved (defensive: authorization
 * responses must never fail because of this hardening).
 */
function setIssuerParam(redirectUrl: URL, issuer: string | undefined): void {
  if (issuer) {
    redirectUrl.searchParams.set('iss', issuer);
  }
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
 * Resolve an RFC 8707 `resource` URI into a display target for the consent
 * screen, disambiguating `/mcp/{name}` between a group and a single server.
 * Best-effort: unknown or unresolvable targets are surfaced as-is, never
 * blocking the authorization request.
 */
async function resolveResourceTarget(raw: string | undefined): Promise<ResourceTarget | undefined> {
  if (!raw) {
    return undefined;
  }

  const parsed = parseResourceTarget(raw);
  if (parsed.kind !== 'target' || !parsed.name) {
    return parsed;
  }

  try {
    const [group, server] = await Promise.all([
      getGroupDao().findByName(parsed.name),
      getServerDao().findById(parsed.name),
    ]);
    if (group) {
      return { ...parsed, kind: 'group' };
    }
    if (server) {
      return { ...parsed, kind: 'server' };
    }
    return { ...parsed, kind: 'unknown' };
  } catch (error) {
    logger.warn('Failed to resolve OAuth consent resource target:', error);
    return { ...parsed, kind: 'unknown' };
  }
}

type ValidatedContinuationRequest =
  | {
      valid: true;
      clientId: string;
      responseType: string;
      scope?: string;
      state?: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
      resource: string;
      sessionVersion: string;
    }
  | {
      valid: false;
      error: string;
      errorDescription: string;
    };

async function validateClientRequestForContinuation(
  params: Record<string, unknown> | undefined,
  user: AuthorizeUser,
  redirectUri: string,
  state?: string,
): Promise<ValidatedContinuationRequest> {
  const rawClientId = params?.client_id;
  if (typeof rawClientId !== 'string' || !rawClientId) {
    return { valid: false, error: 'invalid_request', errorDescription: 'Missing client_id' };
  }
  const clientId = isCimdClientId(rawClientId)
    ? rawClientId
    : /^[a-zA-Z0-9_-]+$/.test(rawClientId)
      ? rawClientId
      : '';
  if (!clientId) {
    return { valid: false, error: 'invalid_request', errorDescription: 'Invalid client_id' };
  }

  const responseType = typeof params?.response_type === 'string' ? params.response_type : '';
  if (responseType !== 'code') {
    return {
      valid: false,
      error: 'unsupported_response_type',
      errorDescription: 'Unsupported response_type',
    };
  }

  const rawResource = typeof params?.resource === 'string' ? params.resource : '';
  if (!rawResource) {
    return { valid: false, error: 'invalid_request', errorDescription: 'Missing resource' };
  }

  const rawScope =
    typeof params?.scope === 'string' && params.scope !== '' ? params.scope : undefined;
  if (rawScope && !/^[\x21\x23-\x5B\x5D-\x7E ]+$/.test(rawScope)) {
    return { valid: false, error: 'invalid_scope', errorDescription: 'Invalid scope format' };
  }

  if (state !== undefined && state !== '' && !/^[\x20-\x7E]+$/.test(state)) {
    return { valid: false, error: 'invalid_request', errorDescription: 'Invalid state format' };
  }

  const codeChallenge =
    typeof params?.code_challenge === 'string' && params.code_challenge !== ''
      ? params.code_challenge
      : undefined;
  const codeChallengeMethod =
    typeof params?.code_challenge_method === 'string' && params.code_challenge_method !== ''
      ? params.code_challenge_method
      : undefined;

  if (codeChallenge && !/^[a-zA-Z0-9_\-=]+$/.test(codeChallenge)) {
    return {
      valid: false,
      error: 'invalid_request',
      errorDescription: 'Invalid code_challenge format',
    };
  }
  if (codeChallengeMethod && !codeChallenge) {
    return {
      valid: false,
      error: 'invalid_request',
      errorDescription: 'Missing code_challenge',
    };
  }
  if (codeChallenge && codeChallengeMethod !== 'S256') {
    return {
      valid: false,
      error: 'invalid_request',
      errorDescription: 'PKCE code_challenge_method must be S256',
    };
  }

  const client = await findOAuthClientIncludingCimd(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return { valid: false, error: 'invalid_client', errorDescription: 'Invalid client' };
  }
  if (Array.isArray(client.grants) && !client.grants.includes('authorization_code')) {
    return {
      valid: false,
      error: 'unauthorized_client',
      errorDescription: 'Client is not authorized for authorization_code grant',
    };
  }
  if (!client.clientSecret && (!codeChallenge || codeChallengeMethod !== 'S256')) {
    return {
      valid: false,
      error: 'invalid_request',
      errorDescription: 'PKCE with code_challenge_method=S256 is required for public clients',
    };
  }

  const oauthConfig = (await getSystemConfigDao().get())?.oauthServer;
  if (oauthConfig?.requireState === true && !state) {
    return {
      valid: false,
      error: 'invalid_request',
      errorDescription: 'Missing parameter: `state`',
    };
  }

  const allowedScopes = oauthConfig?.allowedScopes || ['read', 'write'];
  if (resolveConsentScopes(rawScope, allowedScopes).length === 0) {
    return { valid: false, error: 'invalid_scope', errorDescription: 'Invalid scope' };
  }

  const currentUser = await resolveUserSession(user);
  if (!currentUser || !user.sessionVersion) {
    return { valid: false, error: 'invalid_grant', errorDescription: 'User no longer exists' };
  }
  const sessionVersion = user.sessionVersion;

  if (
    user.approvalId &&
    !(await isApprovalGrantValid(
      { ...user, username: user.username, sessionVersion },
      client.clientId,
    ))
  ) {
    return { valid: false, error: 'invalid_grant', errorDescription: 'Consent has been revoked' };
  }

  return {
    valid: true,
    clientId,
    responseType,
    scope: rawScope,
    state: state || undefined,
    codeChallenge,
    codeChallengeMethod,
    resource: rawResource,
    sessionVersion,
  };
}

async function executeOAuthAuthorizeAndRedirect(
  req: Request,
  res: Response,
  oauth: OAuth2Server,
  oauthRequest: OAuth2Server.Request,
  oauthResponse: OAuth2Server.Response,
  user: AuthorizeUser,
  redirectUri: string,
  state?: string,
): Promise<void> {
  let code;
  try {
    code = await oauth.authorize(oauthRequest, oauthResponse, {
      authenticateHandler: { handle: async () => user },
    });
  } catch (error) {
    // Silent GET authorization must return the same OAuth errors as explicit consent.
    if (error instanceof Error && 'code' in error) {
      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set('error', error.name || 'server_error');
      redirectUrl.searchParams.set('error_description', error.message);
      setIssuerParam(redirectUrl, await resolveIssuer(req));
      if (state) redirectUrl.searchParams.set('state', state);
      res.redirect(redirectUrl.toString());
      return;
    }
    throw error;
  }
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code.authorizationCode);
  setIssuerParam(redirectUrl, await resolveIssuer(req));
  if (state) redirectUrl.searchParams.set('state', state);
  res.redirect(redirectUrl.toString());
}

/**
 * Issue the MCPHub authorization code after a personal upstream OAuth
 * continuation finishes and all revalidation checks pass.
 */
export async function issueAuthorizationCodeForContinuation(
  req: Request,
  res: Response,
  continuation: PendingPersonalOAuthContinuation,
  user: AuthenticatedUser,
): Promise<boolean> {
  const oauth = getOAuthServer();
  if (!oauth) {
    return false;
  }

  const syntheticBody: Record<string, string> = {
    client_id: continuation.clientId,
    redirect_uri: continuation.redirectUri,
    response_type: continuation.responseType,
    resource: continuation.resource,
  };
  if (continuation.scope) syntheticBody.scope = continuation.scope;
  if (continuation.state) syntheticBody.state = continuation.state;
  if (continuation.codeChallenge) syntheticBody.code_challenge = continuation.codeChallenge;
  if (continuation.codeChallengeMethod) {
    syntheticBody.code_challenge_method = continuation.codeChallengeMethod;
  }

  const oauthRequest = new OAuth2Request({
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    query: {},
    body: syntheticBody,
  });
  const oauthResponse = new OAuth2Response(res);

  await executeOAuthAuthorizeAndRedirect(
    req,
    res,
    oauth,
    oauthRequest,
    oauthResponse,
    {
      username: user.username,
      isAdmin: user.isAdmin,
      sessionVersion: continuation.sessionVersion,
      ...(continuation.approvalId ? { approvalId: continuation.approvalId } : {}),
      ...(continuation.approvalContext ? { approvalContext: continuation.approvalContext } : {}),
    },
    continuation.redirectUri,
    continuation.state,
  );
  return true;
}

/**
 * GET /oauth/authorize
 * Display authorization page or handle authorization
 */
async function authorizeAndRedirect(
  req: Request,
  res: Response,
  user: AuthorizeUser,
  redirectUri: string,
  state?: string,
): Promise<void> {
  const oauth = getOAuthServer()!;
  const params = (req.method === 'GET' ? req.query : req.body) as
    | Record<string, unknown>
    | undefined;
  const rawResource = typeof params?.resource === 'string' ? params.resource : undefined;

  const personalServer = await resolveSingleServerPersonalOAuthTarget(rawResource, user);
  if (personalServer) {
    const existingContext = await PersonalOAuthContext.load(
      personalServer.name,
      user.username,
      personalServer,
    );
    if (!hasUsablePersonalOAuthGrant(existingContext)) {
      const validation = await validateClientRequestForContinuation(
        params,
        user,
        redirectUri,
        state,
      );
      if (!validation.valid) {
        res.redirect(
          buildClientErrorRedirectUrl(redirectUri, validation.error, {
            errorDescription: validation.errorDescription,
            state: state || undefined,
            issuer: await resolveIssuer(req),
          }),
        );
        return;
      }

      const { cookieId, nonce, hash } = createBrowserNonce();
      const clientContinuation: PendingPersonalOAuthContinuation = {
        clientId: validation.clientId,
        redirectUri,
        responseType: validation.responseType,
        ...(validation.scope ? { scope: validation.scope } : {}),
        ...(validation.state ? { state: validation.state } : {}),
        resource: validation.resource,
        ...(validation.codeChallenge ? { codeChallenge: validation.codeChallenge } : {}),
        ...(validation.codeChallengeMethod
          ? { codeChallengeMethod: validation.codeChallengeMethod }
          : {}),
        username: user.username,
        sessionVersion: validation.sessionVersion,
        ...(user.approvalId ? { approvalId: user.approvalId } : {}),
        ...(user.approvalContext ? { approvalContext: user.approvalContext } : {}),
        browserNonceHash: hash,
        expiresAt: Date.now() + PERSONAL_OAUTH_FLOW_TTL_MS,
      };

      try {
        const { startPersonalOAuthFlow } = await import('../services/personalOAuthFlowService.js');
        const started = await startPersonalOAuthFlow(personalServer, user.username, {
          preserveUsableGrant: true,
          clientContinuation,
        });
        if (!started.alreadyConnected) {
          if (!started.authorizationUrl) {
            throw new Error('Missing upstream authorization URL');
          }
          setBrowserNonceCookie(req, res, nonce, cookieId);
          res.redirect(started.authorizationUrl);
          return;
        }
      } catch (error) {
        const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
        logger.error('Failed to start personal upstream OAuth continuation:', {
          serverName: personalServer.name,
          username: user.username,
          error,
          ...(cause !== undefined ? { cause } : {}),
        });
        res.redirect(
          buildClientErrorRedirectUrl(redirectUri, 'temporarily_unavailable', {
            errorDescription: 'Unable to prepare personal authorization',
            state: validation.state,
            issuer: await resolveIssuer(req),
          }),
        );
        return;
      }
    }
  }

  const request = new OAuth2Request(req);
  // Both shells submit an empty scope for the configured default permissions.
  request.query = { ...request.query };
  request.body = { ...request.body };
  if (request.query.scope === '') delete request.query.scope;
  if (request.body.scope === '') delete request.body.scope;
  const response = new OAuth2Response(res);

  await executeOAuthAuthorizeAndRedirect(
    req,
    res,
    oauth,
    request,
    response,
    user,
    redirectUri,
    state,
  );
}

export const getAuthorize = async (req: Request, res: Response): Promise<void> => {
  try {
    const oauth = getOAuthServer();
    if (!oauth) {
      res.status(503).json({ error: 'OAuth server not available' });
      return;
    }

    // Get and validate query parameters
    // CIMD (draft-ietf-oauth-client-id-metadata-document) client_ids are HTTPS
    // URLs; registered client_ids stay restricted to the legacy safe charset.
    const rawClientId = validateQueryParam(req.query.client_id, 'client_id');
    const isUrlClientId = isCimdClientId(rawClientId);
    const client_id = isUrlClientId
      ? rawClientId
      : validateQueryParam(rawClientId, 'client_id', /^[a-zA-Z0-9_-]+$/);
    const redirect_uri = validateQueryParam(req.query.redirect_uri, 'redirect_uri');
    const response_type = validateQueryParam(req.query.response_type, 'response_type', /^code$/);
    // RFC 6749 §3.3: scope tokens are printable ASCII (!#-[]-~) excluding " and \, space-delimited
    const scope = req.query.scope
      ? validateQueryParam(req.query.scope, 'scope', /^[\x21\x23-\x5B\x5D-\x7E ]+$/)
      : undefined;
    // State is an opaque string; allow all printable ASCII (space through ~)
    const state = req.query.state
      ? validateQueryParam(req.query.state, 'state', /^[\x20-\x7E]+$/)
      : undefined;
    // RFC 7636: code_challenge is base64url-encoded, may include = padding
    const code_challenge = req.query.code_challenge
      ? validateQueryParam(req.query.code_challenge, 'code_challenge', /^[a-zA-Z0-9_\-=]+$/)
      : undefined;
    const code_challenge_method = req.query.code_challenge_method
      ? validateQueryParam(
          req.query.code_challenge_method,
          'code_challenge_method',
          /^(S256|plain)$/,
        )
      : undefined;
    // RFC 8707: the resource URI the client wants to access (e.g. which MCP
    // server). Optional here for compatibility with clients that omit it, but
    // surfaced on the consent screen when present.
    const resource = req.query.resource
      ? validateQueryParam(req.query.resource, 'resource')
      : undefined;

    // Validate required parameters
    if (!client_id || !redirect_uri || !response_type) {
      res
        .status(400)
        .json({ error: 'invalid_request', error_description: 'Missing required parameters' });
      return;
    }

    // Verify client
    const client = await findOAuthClientIncludingCimd(client_id as string);
    if (!client) {
      res.status(400).json({ error: 'invalid_client', error_description: 'Client not found' });
      return;
    }

    // Verify redirect URI
    if (!client.redirectUris.includes(redirect_uri as string)) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
      return;
    }

    // RFC 7636 + GHSA-3m7m: public clients (no registered secret) must present
    // an S256 code challenge up front. Confidential clients may omit PKCE.
    if (!client.clientSecret && (!code_challenge || code_challenge_method !== 'S256')) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'PKCE with code_challenge_method=S256 is required for public clients',
      });
      return;
    }

    // Check if user is authenticated (including via JWT token)
    let user = (req as any).user;
    if (!user) {
      const tokenUser = await resolveUserFromRequest(req);
      if (tokenUser) {
        (req as any).user = tokenUser;
        user = tokenUser;
      }
    }
    if (!user) {
      user = await resolveBetterAuthUserForAuthorize(req);
    }

    if (!user) {
      // Redirect to login page with return URL
      const target = new URL(req.originalUrl, 'http://localhost');
      target.searchParams.delete('token');
      const returnUrl = encodeURIComponent(target.pathname + target.search);
      res.redirect(`${config.basePath}/login?returnUrl=${returnUrl}`);
      return;
    }

    const consentConfig = (await getSystemConfigDao().get())?.oauthServer;
    const effectiveScopes = resolveConsentScopes(
      scope,
      consentConfig?.allowedScopes || ['read', 'write'],
    );
    if (consentConfig?.alwaysShowApprovalScreen === false) {
      const approval = await findReusableApproval(
        user,
        client,
        redirect_uri,
        resource || '',
        effectiveScopes,
      );
      if (approval) {
        await authorizeAndRedirect(
          req,
          res,
          { ...user, approvalId: approval.id },
          redirect_uri,
          state,
        );
        return;
      }
    }

    const requestToken = typeof req.query.token === 'string' ? req.query.token : '';
    const tokenField = requestToken
      ? `<input type="hidden" name="token" value="${escapeHtml(requestToken)}">`
      : '';

    // Get translation function from request (set by i18n middleware)
    const t = (req as any).t || ((key: string) => key);

    const scopes = effectiveScopes.map((s) => ({ name: s, description: getScopeDescription(s) }));

    const formFields = `
      <input type="hidden" name="client_id" value="${escapeHtml(client_id)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}" />
      <input type="hidden" name="response_type" value="${escapeHtml(response_type)}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope || '')}" />
      <input type="hidden" name="state" value="${escapeHtml(state || '')}" />
      ${resource ? `<input type="hidden" name="resource" value="${escapeHtml(resource)}" />` : ''}
      ${code_challenge ? `<input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}" />` : ''}
      ${code_challenge_method ? `<input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}" />` : ''}
      ${tokenField}
    `;

    // Build the structured consent context handed to the React SPA. The server
    // has already validated the request and resolved the authenticated user, so
    // the SPA only renders this payload (never re-resolves auth).
    const consentClientInfo: ConsentClientInfo = {
      clientUri: client.metadata?.client_uri,
      policyUri: client.metadata?.policy_uri,
      tosUri: client.metadata?.tos_uri,
      logoUri: client.metadata?.logo_uri,
      contacts: client.metadata?.contacts,
      applicationType: client.metadata?.application_type,
    };
    const consentContext: OAuthConsentContext = {
      clientName: client.name || '',
      scopes,
      clientId: client_id,
      redirectUri: redirect_uri,
      responseType: response_type,
      scope: scope || '',
      state: state || undefined,
      codeChallenge: code_challenge || undefined,
      codeChallengeMethod: code_challenge_method || undefined,
      token: requestToken || undefined,
      resource: await resolveResourceTarget(resource),
      client: consentClientInfo,
    };

    // Serve the consent screen inside the React dashboard (SPA shell) when the
    // frontend build is available, so it shares the dashboard's visual
    // language, i18n and dark mode. Fall back to the legacy inline page when
    // the frontend is not deployed (e.g. DISABLE_WEB / headless installs).
    const shell = injectOAuthConsentShell(consentContext);
    if (shell) {
      res.type('html').send(shell);
      return;
    }

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
    logger.error('Authorization error:', error);
    res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
  }
};

/**
 * POST /oauth/authorize
 * Handle authorization decision
 */
export const postAuthorize = async (req: Request, res: Response): Promise<void> => {
  let validatedRedirectUri: string | null = null;

  try {
    const oauth = getOAuthServer();
    if (!oauth) {
      res.status(503).json({ error: 'OAuth server not available' });
      return;
    }

    const issuer = await resolveIssuer(req);
    const { allow, client_id, redirect_uri, state } = req.body;

    validatedRedirectUri = await validateClientRedirectUri(res, client_id, redirect_uri);
    if (!validatedRedirectUri) {
      return;
    }

    if (getDashboardSession(req) && !(await requireDashboardOrigin(req, res))) return;

    // If user denied
    if (allow !== 'true') {
      const redirectUrl = new URL(validatedRedirectUri);
      redirectUrl.searchParams.set('error', 'access_denied');
      setIssuerParam(redirectUrl, issuer);
      if (state) {
        redirectUrl.searchParams.set('state', state);
      }
      res.redirect(redirectUrl.toString());
      return;
    }

    // Get authenticated user (JWT support for browser form submissions, plus
    // Better Auth session cookie for social-login users — see #815).
    let user = (req as any).user;
    if (!user) {
      const tokenUser = await resolveUserFromRequest(req);
      if (tokenUser) {
        (req as any).user = tokenUser;
        user = tokenUser;
      }
    }
    if (!user) {
      user = await resolveBetterAuthUserForAuthorize(req);
    }

    if (!user) {
      res.status(401).json({ error: 'unauthorized', error_description: 'User not authenticated' });
      return;
    }

    await authorizeAndRedirect(
      req,
      res,
      {
        ...user,
        approvalContext: {
          redirectUri: validatedRedirectUri,
          resource: typeof req.body.resource === 'string' ? req.body.resource : '',
        },
      },
      validatedRedirectUri,
      state,
    );
  } catch (error) {
    logger.error('Authorization error:', error);

    // Handle OAuth errors
    if (error instanceof Error && 'code' in error) {
      const oauthError = error as any;
      const state = req.body.state;

      if (validatedRedirectUri) {
        const redirectUrl = new URL(validatedRedirectUri);
        redirectUrl.searchParams.set('error', oauthError.name || 'server_error');
        if (oauthError.message) {
          redirectUrl.searchParams.set('error_description', oauthError.message);
        }
        setIssuerParam(redirectUrl, await resolveIssuer(req));
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
    logger.error('Token error:', error);

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
    logger.error('UserInfo error:', error);
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
    const systemConfig = await getSystemConfigDao().get();
    const storedConfig = systemConfig?.oauthServer;
    // Merge stored config with defaults so partial configs still inherit all default values
    const oauthConfig = { ...cloneDefaultOAuthServerConfig(), ...storedConfig };

    if (!oauthConfig.enabled) {
      res.status(404).json({ error: 'OAuth server not configured' });
      return;
    }

    const baseUrl = getPublicInstallBaseUrl(req, systemConfig);
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
      // Only S256 is supported; the library rejects plain (GHSA-3m7m).
      code_challenge_methods_supported: ['S256'],
    };

    // Add dynamic registration endpoint if enabled
    if (oauthConfig.dynamicRegistration?.enabled) {
      metadata.registration_endpoint = `${baseUrl}/oauth/register`;
    }

    res.json(metadata);
  } catch (error) {
    logger.error('Metadata error:', error);
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
    const systemConfig = await getSystemConfigDao().get();
    const storedConfig = systemConfig?.oauthServer;
    // Merge stored config with defaults so partial configs still inherit all default values
    const oauthConfig = { ...cloneDefaultOAuthServerConfig(), ...storedConfig };

    if (!oauthConfig.enabled) {
      res.status(404).json({ error: 'OAuth server not configured' });
      return;
    }

    const baseUrl = getPublicInstallBaseUrl(req, systemConfig);
    const resource = getProtectedResourceUrlFromMetadataRequest(req, systemConfig);
    if (!resource) {
      res.status(404).json({ error: 'Protected resource not found' });
      return;
    }
    const allowedScopes = oauthConfig.allowedScopes || ['read', 'write'];

    // Return protected resource metadata according to RFC 9728
    res.json({
      resource,
      authorization_servers: [baseUrl],
      scopes_supported: allowedScopes,
      bearer_methods_supported: ['header'],
    });
  } catch (error) {
    logger.error('Protected resource metadata error:', error);
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
