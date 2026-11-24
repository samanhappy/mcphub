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
import { getServerDao } from '../dao/DaoFactory.js';
import {
  getServerByOAuthState,
  getServerByPendingOAuthState,
  connectClientWithDiagnostics,
  createTransportFromConfig,
  updateServerToolsCache,
} from '../services/mcpService.js';
import { expandServerConfig } from '../services/serverConfigEnvironment.js';
import { loadServerConfig } from '../services/oauthSettingsStore.js';
import { withOAuthPendingAuthLock } from '../services/replicaLock.js';
import { isApprovalGrantValid } from '../services/oauthApprovalService.js';
import {
  PersonalOAuthContext,
  PERSONAL_OAUTH_FLOW_TTL_MS,
  findPersonalOAuthFlowRecord,
  hasPersonalOAuth,
  hasUsablePersonalOAuthGrant,
} from '../services/personalOAuthService.js';
import { finishPersonalOAuthExchange } from '../services/personalOAuthFlowService.js';
import {
  buildClientErrorRedirectUrl,
  clearBrowserNonceCookie,
  validateContinuationClientRedirect,
  verifyBrowserNonce,
} from '../services/personalOAuthContinuationService.js';
import { issueAuthorizationCodeForContinuation, resolveIssuer } from './oauthServerController.js';
import { resolveUserSession } from '../utils/userSession.js';
import { validateAuthorizationIss } from '../utils/oauthIssuer.js';
import type { ServerInfo } from '../types/index.js';
import { logger } from '../utils/logger.js';

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

/**
 * OAuth `state` is a server-generated, unguessable, single-use value bound to
 * the in-flight authorization of exactly one server (see
 * MCPHubOAuthProvider.generateState). The callback MUST resolve the target
 * server only by exact match against a stored state — never by decoding the
 * supplied value or falling back to a server name embedded in it
 * (GHSA-vc28-27px-x492).
 */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** States whose authorization has already been completed (single-use). */
const consumedOAuthStates = new Map<string, number>(); // state -> consumedAt

const pruneConsumedOAuthStates = (): void => {
  const now = Date.now();
  for (const [state, consumedAt] of consumedOAuthStates) {
    if (now - consumedAt > OAUTH_STATE_TTL_MS) {
      consumedOAuthStates.delete(state);
    }
  }
};

/**
 * Reset the in-memory OAuth state bookkeeping (the consumed-state set). This is
 * a no-op in production use and exists so test suites start from a clean slate
 * between cases.
 */
export const resetOAuthStateTrackingForTests = (): void => {
  consumedOAuthStates.clear();
};

/**
 * True when `state` is the current in-flight authorization state of the server.
 * Requires an exact match against the stored state (in-memory or persisted) and
 * rejects states that are stale beyond the TTL.
 */
const isOAuthStateCurrent = (serverInfo: ServerInfo, state: string): boolean => {
  const inMemoryState = serverInfo.oauth?.state;
  const pendingState = serverInfo.config?.oauth?.pendingAuthorization?.state;
  const storedStates = [inMemoryState, pendingState].filter(
    (s): s is string => typeof s === 'string',
  );

  // Exact match only. A state that does not equal the server's current
  // in-flight authorization is rejected outright.
  if (storedStates.length === 0 || !storedStates.includes(state)) {
    return false;
  }

  const createdAt = serverInfo.config?.oauth?.pendingAuthorization?.createdAt;
  if (createdAt !== undefined && Date.now() - createdAt > OAUTH_STATE_TTL_MS) {
    logger.warn('OAuth callback state expired; rejecting', {
      serverName: serverInfo.name,
    });
    return false;
  }

  return true;
};

/**
 * Re-check `state` against the freshly persisted pending authorization. Called
 * under the per-server OAuth lock, immediately before the token exchange, to
 * catch a flow that replaced the pending state (or a callback that consumed
 * it) while this callback waited for the lock.
 */
const isPersistedOAuthStateCurrent = (
  serverInfo: ServerInfo,
  storedConfig: Awaited<ReturnType<typeof loadServerConfig>>,
  state: string,
): boolean => {
  pruneConsumedOAuthStates();
  if (consumedOAuthStates.has(state)) {
    return false;
  }
  const pending = storedConfig?.oauth?.pendingAuthorization;
  if (pending?.state) {
    // Persisted record is authoritative: any other state means another flow
    // replaced this one.
    if (pending.state !== state) {
      return false;
    }
  } else if (serverInfo.oauth?.state !== state) {
    // Nothing persisted (e.g. persistence failed): only the live in-memory
    // flow's own state is acceptable.
    return false;
  }
  if (pending?.createdAt !== undefined && Date.now() - pending.createdAt > OAUTH_STATE_TTL_MS) {
    logger.warn('OAuth callback state expired while waiting for lock; rejecting', {
      serverName: serverInfo.name,
    });
    return false;
  }
  return true;
};

/**
 * Resolve the server targeted by an OAuth callback from its `state` parameter.
 *
 * The state must be an unexpired, unconsumed, exact match against a stored
 * server-generated state. There is deliberately no fallback that interprets the
 * state as a server name — an attacker who forges `state` cannot select which
 * server's authorization to drive (GHSA-vc28-27px-x492).
 */
const resolveServerByOAuthState = (state: string): ServerInfo | undefined => {
  pruneConsumedOAuthStates();

  if (consumedOAuthStates.has(state)) {
    logger.warn('OAuth callback state already consumed; rejecting', {
      serverName: '<redacted>',
    });
    return undefined;
  }

  // In-memory match: serverInfo.oauth.state is set when redirectToAuthorization
  // ran against a live transport in this process.
  const serverInfo = getServerByOAuthState(state);
  if (serverInfo && isOAuthStateCurrent(serverInfo, state)) {
    return serverInfo;
  }

  // Restart recovery: match against the persisted pendingAuthorization.state.
  const pendingServerInfo = getServerByPendingOAuthState(state);
  if (pendingServerInfo && isOAuthStateCurrent(pendingServerInfo, state)) {
    return pendingServerInfo;
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
 * - state: Server-generated, unguessable, single-use authorization state bound
 *   to the in-flight authorization of exactly one server
 * - error: Optional error code if authorization failed
 * - error_description: Optional error description
 */
const handlePersonalOAuthErrorCallback = async (
  req: Request,
  res: Response,
  stateParam: string,
): Promise<boolean> => {
  const record = await findPersonalOAuthFlowRecord(stateParam);
  if (!record) return false;

  return withOAuthPendingAuthLock(record.context.serverName, record.context.username, async () => {
    const definition = await getServerDao().findById(record.context.serverName);
    if (!definition || !hasPersonalOAuth(definition)) return false;

    const context = await PersonalOAuthContext.load(
      definition.name,
      record.context.username,
      definition,
    );
    const pending = context.config.oauth.pendingAuthorization;
    if (!pending || pending.state !== stateParam) return false;

    const continuation = pending.clientContinuation;
    if (!continuation) return false;

    // Require a matching browser nonce before modifying pending state or redirecting.
    if (!verifyBrowserNonce(req, continuation)) {
      return false;
    }

    const cleared = await context.clearPendingAuthorizationIfCurrentRevision();
    if (!cleared) return false;

    clearBrowserNonceCookie(req, res);

    const client = await validateContinuationClientRedirect(
      continuation.clientId,
      continuation.redirectUri,
    );
    if (!client) {
      return false;
    }

    res.redirect(
      buildClientErrorRedirectUrl(continuation.redirectUri, 'access_denied', {
        state: continuation.state,
        issuer: await resolveIssuer(req),
      }),
    );
    return true;
  });
};

type PersonalOAuthCallbackOutcome = 'redirected' | 'dashboard_success' | 'error' | 'not_found';

const handlePersonalOAuthCallback = async (
  req: Request,
  res: Response,
  stateParam: string,
  codeParam: string,
  issParam?: string,
): Promise<PersonalOAuthCallbackOutcome> => {
  const record = await findPersonalOAuthFlowRecord(stateParam);
  if (!record) return 'not_found';

  return withOAuthPendingAuthLock(record.context.serverName, record.context.username, async () => {
    const definition = await getServerDao().findById(record.context.serverName);
    if (!definition || !hasPersonalOAuth(definition)) return 'error';

    const context = await PersonalOAuthContext.load(
      definition.name,
      record.context.username,
      definition,
    );
    const pending = context.config.oauth.pendingAuthorization;
    if (!pending || pending.state !== stateParam) {
      return 'not_found';
    }

    const continuation = pending.clientContinuation;
    if (!continuation) {
      if (!pending.createdAt || Date.now() - pending.createdAt >= PERSONAL_OAUTH_FLOW_TTL_MS) {
        return 'not_found';
      }
      await context.assertCurrent();
      const issResult = validateAuthorizationIss({
        iss: issParam,
        authorizationUrl: pending.authorizationUrl,
        configuredIssuer: pending.issuer || context.config.oauth.dynamicRegistration?.issuer,
        issRequired: pending.issRequired,
      });
      if (!issResult.valid) {
        return 'error';
      }
      await context.mutate(({ oauth }) => {
        delete oauth.pendingAuthorization!.state;
      });
      await finishPersonalOAuthExchange(context, codeParam, issParam);
      return 'dashboard_success';
    }

    // Bind continuation callback to the initiating browser BEFORE redeeming
    // the upstream code, clearing state, or redirecting to the client.
    if (!verifyBrowserNonce(req, continuation)) {
      return 'error';
    }

    const failValidatedContinuation = async (
      errorCode: string,
      errorDescription?: string,
    ): Promise<PersonalOAuthCallbackOutcome> => {
      await context.clearPendingAuthorizationIfCurrentRevision().catch(() => false);
      clearBrowserNonceCookie(req, res);
      const validClient = await validateContinuationClientRedirect(
        continuation.clientId,
        continuation.redirectUri,
      ).catch(() => undefined);
      if (validClient) {
        res.redirect(
          buildClientErrorRedirectUrl(continuation.redirectUri, errorCode, {
            errorDescription,
            state: continuation.state,
            issuer: await resolveIssuer(req),
          }),
        );
        return 'redirected';
      }
      return 'error';
    };

    const expired =
      !pending.createdAt ||
      Date.now() - pending.createdAt >= PERSONAL_OAUTH_FLOW_TTL_MS ||
      continuation.expiresAt <= Date.now();
    if (expired) {
      return failValidatedContinuation('access_denied', 'Authorization session expired');
    }

    const issResult = validateAuthorizationIss({
      iss: issParam,
      authorizationUrl: pending.authorizationUrl,
      configuredIssuer: pending.issuer || context.config.oauth.dynamicRegistration?.issuer,
      issRequired: pending.issRequired,
    });
    if (!issResult.valid) {
      return failValidatedContinuation('access_denied', 'Invalid authorization issuer');
    }

    // Revalidate user, sessionVersion, server config/permissions, client, redirect URI,
    // and approval BEFORE redeeming the upstream authorization code.
    try {
      await context.assertCurrent();
    } catch {
      return failValidatedContinuation('access_denied');
    }

    const preExchangeUser = await resolveUserSession({
      username: continuation.username,
      sessionVersion: continuation.sessionVersion,
    });
    if (!preExchangeUser) {
      return failValidatedContinuation('access_denied');
    }

    const preExchangeClient = await validateContinuationClientRedirect(
      continuation.clientId,
      continuation.redirectUri,
    );
    if (
      !preExchangeClient ||
      (Array.isArray(preExchangeClient.grants) &&
        !preExchangeClient.grants.includes('authorization_code'))
    ) {
      return failValidatedContinuation('access_denied');
    }

    if (
      continuation.approvalId &&
      !(await isApprovalGrantValid(
        {
          username: continuation.username,
          sessionVersion: continuation.sessionVersion,
          approvalId: continuation.approvalId,
        },
        continuation.clientId,
      ))
    ) {
      return failValidatedContinuation('access_denied');
    }

    // Persist one-time consumption before redeeming the upstream code so
    // concurrent/replayed callbacks across replicas fail closed.
    await context.mutate(({ oauth }) => {
      delete oauth.pendingAuthorization!.state;
      delete oauth.pendingAuthorization!.clientContinuation;
    });

    try {
      await finishPersonalOAuthExchange(context, codeParam, issParam);
    } catch {
      return failValidatedContinuation('access_denied');
    }

    clearBrowserNonceCookie(req, res);

    // Final revalidation before issuing the MCPHub authorization code.
    const latestServer = await getServerDao().findById(context.serverName);
    if (!latestServer || !hasPersonalOAuth(latestServer)) {
      const validClient = await validateContinuationClientRedirect(
        continuation.clientId,
        continuation.redirectUri,
      ).catch(() => undefined);
      if (validClient) {
        res.redirect(
          buildClientErrorRedirectUrl(continuation.redirectUri, 'access_denied', {
            state: continuation.state,
            issuer: await resolveIssuer(req),
          }),
        );
        return 'redirected';
      }
      return 'error';
    }

    const refreshedContext = await PersonalOAuthContext.load(
      latestServer.name,
      continuation.username,
      latestServer,
    );
    let postExchangeValid = hasUsablePersonalOAuthGrant(refreshedContext);
    if (postExchangeValid) {
      try {
        await refreshedContext.assertCurrent();
      } catch {
        postExchangeValid = false;
      }
    }

    const finalUser = postExchangeValid
      ? await resolveUserSession({
          username: continuation.username,
          sessionVersion: continuation.sessionVersion,
        })
      : null;

    const finalClient = await validateContinuationClientRedirect(
      continuation.clientId,
      continuation.redirectUri,
    ).catch(() => undefined);

    const approvalStillValid =
      !continuation.approvalId ||
      (await isApprovalGrantValid(
        {
          username: continuation.username,
          sessionVersion: continuation.sessionVersion,
          approvalId: continuation.approvalId,
        },
        continuation.clientId,
      ));

    if (
      !postExchangeValid ||
      !finalUser ||
      !finalClient ||
      (Array.isArray(finalClient.grants) && !finalClient.grants.includes('authorization_code')) ||
      !approvalStillValid
    ) {
      if (finalClient) {
        res.redirect(
          buildClientErrorRedirectUrl(continuation.redirectUri, 'access_denied', {
            state: continuation.state,
            issuer: await resolveIssuer(req),
          }),
        );
        return 'redirected';
      }
      return 'error';
    }

    const issued = await issueAuthorizationCodeForContinuation(req, res, continuation, {
      username: continuation.username,
      isAdmin: !!finalUser.isAdmin,
      sessionVersion: continuation.sessionVersion,
    });
    return issued ? 'redirected' : 'error';
  });
};

export const handleOAuthCallback = async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query;
    const codeParam = normalizeQueryParam(code);
    const stateParam = normalizeQueryParam(state);

    // Get translation function from request (set by i18n middleware)
    const t = (req as any).t || ((key: string) => key);

    // Check for authorization errors
    if (error) {
      if (stateParam?.startsWith('personal.')) {
        try {
          if (await handlePersonalOAuthErrorCallback(req, res, stateParam)) {
            return;
          }
        } catch (continuationError) {
          logger.error('Failed handling personal OAuth error continuation', {
            error: continuationError,
          });
        }
      }
      logger.error('OAuth authorization failed', {
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
      logger.error('OAuth callback missing state parameter');
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
      logger.error('OAuth callback missing authorization code');
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

    if (stateParam.startsWith('personal.')) {
      try {
        const outcome = await handlePersonalOAuthCallback(
          req,
          res,
          stateParam,
          codeParam,
          normalizeQueryParam(req.query.iss),
        );
        if (outcome === 'redirected') {
          return;
        }
        if (outcome === 'dashboard_success') {
          return res.send(
            generateHtmlResponse(
              t,
              'success',
              t('oauthCallback.authorizationSuccessful'),
              t('server.oauth.personalSuccess'),
              undefined,
              true,
            ),
          );
        }
        if (outcome === 'error') {
          return res
            .status(400)
            .send(
              generateHtmlResponse(
                t,
                'error',
                t('oauthCallback.authorizationFailed'),
                'Personal authorization failed; reconnect in Dashboard → Servers.',
              ),
            );
        }
      } catch {
        return res
          .status(400)
          .send(
            generateHtmlResponse(
              t,
              'error',
              t('oauthCallback.authorizationFailed'),
              'Personal authorization failed; reconnect in Dashboard → Servers.',
            ),
          );
      }
    }

    logger.log('OAuth callback received', { hasCode: true, state: stateParam });

    // Find the target server by the state parameter. Resolution is exact-match
    // only against a stored, server-generated state; a forged state cannot name
    // a server (GHSA-vc28-27px-x492).
    const serverInfo = resolveServerByOAuthState(stateParam);

    if (!serverInfo) {
      logger.error('No server found for OAuth callback', { state: stateParam });
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

    logger.log('Processing OAuth callback for server', { serverName: serverInfo.name });

    // RFC 9207 / SEP-2468: when the authorization response carries `iss`,
    // validate it against the issuer we sent the authorization request to
    // before redeeming the code (mix-up attack mitigation). Legacy servers
    // that do not advertise support may omit `iss`.
    const issParam = normalizeQueryParam(req.query.iss);
    const issResult = validateAuthorizationIss({
      iss: issParam,
      authorizationUrl:
        serverInfo.oauth?.authorizationUrl ??
        serverInfo.config?.oauth?.pendingAuthorization?.authorizationUrl,
      configuredIssuer:
        serverInfo.oauth?.issuer ??
        serverInfo.config?.oauth?.pendingAuthorization?.issuer ??
        serverInfo.config?.oauth?.dynamicRegistration?.issuer,
      issRequired:
        serverInfo.oauth?.issRequired ??
        serverInfo.config?.oauth?.pendingAuthorization?.issRequired,
    });
    if (!issResult.valid) {
      logger.error('OAuth callback iss validation failed', {
        serverName: serverInfo.name,
        reason: issResult.reason,
      });
      return res
        .status(400)
        .send(
          generateHtmlResponse(
            t,
            'error',
            t('oauthCallback.authorizationFailed'),
            issResult.reason,
          ),
        );
    }
    if (issParam && !issResult.checked) {
      logger.warn('OAuth callback carried iss but no expected issuer is known; accepting', {
        serverName: serverInfo.name,
      });
    }

    // For StreamableHTTPClientTransport, we need to call finishAuth() on the transport
    // This will exchange the authorization code for tokens automatically
    if (serverInfo.transport && 'finishAuth' in serverInfo.transport) {
      try {
        logger.log('Calling transport.finishAuth for server', { serverName: serverInfo.name });
        const currentTransport = serverInfo.transport as any;
        // Hold the per-server OAuth lock during the token exchange so a
        // concurrent reconnect cannot overwrite pendingAuthorization between
        // this callback's state check and the provider's codeVerifier lookup.
        // Nested provider lock acquisition is reentrant (see replicaLock).
        //
        // The state was validated before the lock was taken, so another flow
        // may have replaced (or another callback consumed) it while this
        // callback waited. Revalidate against the persisted pending record
        // under the lock, before finishAuth(), so an old code is never
        // exchanged with a different flow's code verifier.
        const stateStillCurrent = await withOAuthPendingAuthLock(
          serverInfo.name,
          'shared',
          async () => {
            const storedConfig = await loadServerConfig(serverInfo.name);
            if (!isPersistedOAuthStateCurrent(serverInfo, storedConfig, stateParam)) {
              return false;
            }
            await currentTransport.finishAuth(codeParam, issParam);
            return true;
          },
        );

        if (!stateStillCurrent) {
          logger.error('OAuth callback state superseded while waiting for lock; rejecting', {
            serverName: serverInfo.name,
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

        // The state has served its purpose: the code was exchanged and the
        // server now holds the resulting tokens. Mark it consumed so a replayed
        // callback with the same state is rejected (single-use, GHSA-vc28-27px-x492).
        consumedOAuthStates.set(stateParam, Date.now());

        logger.log('Successfully exchanged authorization code for tokens', {
          serverName: serverInfo.name,
        });

        // Refresh server configuration from storage (DB or file) to pick up newly saved tokens.
        // loadServerConfig is DAO-backed and handles both DB and file modes, so a redundant
        // loadSettings() call is not needed. Apply replaceEnvVars so fields like url/command
        // have environment variable references expanded, consistent with initial server setup.
        const freshConfig = await loadServerConfig(serverInfo.name);
        const effectiveConfig = freshConfig
          ? await expandServerConfig(freshConfig)
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
          logger.warn('Failed to close existing transport during OAuth reconnect', {
            serverName: serverInfo.name,
            error: closeError,
          });
        }

        logger.log('Rebuilding transport with refreshed credentials', {
          serverName: serverInfo.name,
        });
        const refreshedTransport = await createTransportFromConfig(
          serverInfo.name,
          effectiveConfig,
        );
        serverInfo.transport = refreshedTransport;

        // OAuth tokens are available, but the new transport is not connected yet.
        serverInfo.status = 'connecting';
        if (serverInfo.oauth) {
          serverInfo.oauth.authorizationUrl = undefined;
          serverInfo.oauth.state = undefined;
        }

        if (!serverInfo.client || !serverInfo.transport) {
          const missingRuntimeError = new Error(
            `Cannot reconnect ${serverInfo.name} after OAuth callback because client or transport is missing`,
          );
          serverInfo.status = 'disconnected';
          serverInfo.error = missingRuntimeError.message;
          throw missingRuntimeError;
        }

        logger.log('Connecting client with refreshed transport', {
          serverName: serverInfo.name,
        });
        const reconnectClient = serverInfo.client;
        const reconnectTransport = serverInfo.transport;
        try {
          await connectClientWithDiagnostics(
            reconnectClient,
            reconnectTransport,
            serverInfo.options,
          );
        } catch (connectError) {
          serverInfo.status = 'disconnected';
          serverInfo.error = `Failed to connect after OAuth callback: ${
            connectError instanceof Error ? connectError.message : String(connectError)
          }`;
          logger.error('Error connecting client after OAuth callback', {
            serverName: serverInfo.name,
            error: connectError,
          });
          if (connectError instanceof Error) {
            logger.error('Connect error details after OAuth callback', {
              serverName: serverInfo.name,
              message: connectError.message,
              stack: connectError.stack,
            });
          }

          try {
            await reconnectClient.close();
          } catch (clientCloseError) {
            logger.warn('Failed to close client after OAuth reconnect failure', {
              serverName: serverInfo.name,
              error: clientCloseError,
            });
          }

          try {
            await reconnectTransport.close();
          } catch (transportCloseError) {
            logger.warn('Failed to close transport after OAuth reconnect failure', {
              serverName: serverInfo.name,
              error: transportCloseError,
            });
          }

          if (serverInfo.client === reconnectClient) {
            serverInfo.client = undefined;
          }
          if (serverInfo.transport === reconnectTransport) {
            serverInfo.transport = undefined;
          }

          throw connectError;
        }

        serverInfo.status = 'connected';
        serverInfo.error = null;
        logger.log('Client connected successfully after OAuth callback', {
          serverName: serverInfo.name,
        });

        // List tools after successful connection. A cache refresh failure does not
        // invalidate the connection established by the MCP handshake.
        const capabilities = serverInfo.client.getServerCapabilities();
        logger.log('Server capabilities after OAuth callback', {
          serverName: serverInfo.name,
          capabilities,
        });

        if (capabilities?.tools) {
          logger.log('Listing tools after OAuth callback', {
            serverName: serverInfo.name,
          });
          try {
            const toolsResult = await serverInfo.client.listTools({}, serverInfo.options);
            updateServerToolsCache(serverInfo, toolsResult.tools);
            logger.log('Listed tools after OAuth callback', {
              serverName: serverInfo.name,
              toolCount: serverInfo.tools.length,
            });
          } catch (listToolsError) {
            logger.error('Failed to list tools after OAuth callback', {
              serverName: serverInfo.name,
              error: listToolsError,
            });
          }
        } else {
          logger.log('Server does not support tools capability after OAuth callback', {
            serverName: serverInfo.name,
          });
        }

        logger.log('Successfully completed OAuth flow for server', {
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
        logger.error('Failed to complete OAuth flow for server', {
          serverName: serverInfo.name,
          error,
        });
        logger.error('OAuth callback error details', {
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
      logger.error('Transport does not support finishAuth', { serverName: serverInfo.name });
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
    logger.error('Unexpected error handling OAuth callback', { error });

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
