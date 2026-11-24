import type { Request, Response } from 'express';
import { getServerDao } from '../dao/DaoFactory.js';
import { authorizationService, type RequestPrincipal } from '../services/authorizationService.js';
import {
  PersonalOAuthContext,
  PERSONAL_OAUTH_FLOW_TTL_MS,
  hasPersonalOAuth,
  findPersonalOAuthFlowRecord,
  disconnectPersonalOAuth,
} from '../services/personalOAuthService.js';
import { withOAuthPendingAuthLock } from '../services/replicaLock.js';
import {
  buildPersonalOAuthAuthorizationUrl,
  finishPersonalOAuthExchange,
  startPersonalOAuthFlow,
} from '../services/personalOAuthFlowService.js';
import { validateAuthorizationIss } from '../utils/oauthIssuer.js';
import { CredentialBindingError } from '../utils/credentialTemplate.js';

export const managePersonalOAuth = async (req: Request, res: Response): Promise<void> => {
  const user = (req as Request & { user?: RequestPrincipal }).user;
  if (!user?.username || user.credentialEligible === false) {
    res.status(401).json({ success: false });
    return;
  }
  try {
    const definition = await getServerDao().findById(req.params.name);
    if (
      !definition ||
      !hasPersonalOAuth(definition) ||
      definition.enabled === false ||
      !authorizationService.can('server.invoke', definition, user)
    ) {
      res.status(404).json({ success: false, message: 'Server not available' });
      return;
    }
    if (req.method === 'DELETE') {
      // Revocation is best effort: unreadable tokens must not prevent local disconnect.
      const binding = await PersonalOAuthContext.load(
        definition.name,
        user.username,
        definition,
      ).catch(() => undefined);
      await disconnectPersonalOAuth(definition.name, user.username);
      const oauth = binding?.config.oauth;
      if (binding && oauth?.revocationEndpoint) {
        const { revokeToken, canServerOwnerReachInternalUrls } = await import(
          '../services/upstreamOAuthDisconnectService.js'
        );
        const allowInternal = await canServerOwnerReachInternalUrls(definition);
        await Promise.all(
          (
            [
              ['access_token', oauth.accessToken],
              ['refresh_token', oauth.refreshToken],
            ] as const
          )
            .filter((pair): pair is readonly ['access_token' | 'refresh_token', string] =>
              Boolean(pair[1]),
            )
            .map(([hint, token]) =>
              revokeToken(
                oauth.revocationEndpoint!,
                binding.config,
                { hint, token },
                allowInternal,
              ),
            ),
        );
      }
      res.json({ success: true });
      return;
    }

    let context: PersonalOAuthContext;
    let authorizationUrl: string | undefined;
    if (req.method === 'POST') {
      const started = await startPersonalOAuthFlow(definition, user.username);
      context = started.context;
      authorizationUrl = started.authorizationUrl;
    } else {
      context = await PersonalOAuthContext.load(definition.name, user.username, definition);
      authorizationUrl = buildPersonalOAuthAuthorizationUrl(definition.name, context);
    }

    res.json({
      success: true,
      data: {
        connected: Boolean(context.config.oauth.accessToken),
        authorizationUrl,
        status: context.config.oauth.accessToken ? 'connected' : 'oauth_required',
      },
    });
  } catch (error) {
    res.status(error instanceof CredentialBindingError ? 400 : 502).json({
      success: false,
      message:
        error instanceof CredentialBindingError
          ? error.message
          : 'Unable to prepare personal authorization',
    });
  }
};

export const completePersonalOAuth = async (
  state: string,
  code: string,
  iss?: string,
): Promise<boolean> => {
  const record = await findPersonalOAuthFlowRecord(state);
  if (!record || record.expired) return false;

  return withOAuthPendingAuthLock(record.context.serverName, record.context.username, async () => {
    const definition = await getServerDao().findById(record.context.serverName);
    if (!definition || !hasPersonalOAuth(definition)) return false;
    const context = await PersonalOAuthContext.load(
      definition.name,
      record.context.username,
      definition,
    );
    const pending = context.config.oauth.pendingAuthorization;
    if (
      !pending ||
      pending.state !== state ||
      !pending.createdAt ||
      Date.now() - pending.createdAt >= PERSONAL_OAUTH_FLOW_TTL_MS
    ) {
      return false;
    }
    if (pending.clientContinuation) {
      throw new CredentialBindingError('Browser verification required for client authorization');
    }
    await context.assertCurrent();

    const result = validateAuthorizationIss({
      iss,
      authorizationUrl: pending.authorizationUrl,
      configuredIssuer: pending.issuer || context.config.oauth.dynamicRegistration?.issuer,
      issRequired: pending.issRequired,
    });
    if (!result.valid) throw new CredentialBindingError('Invalid authorization issuer');

    // Persist consumption before redeeming the code: concurrent/replayed callbacks fail closed.
    await context.mutate(({ oauth }) => {
      delete oauth.pendingAuthorization!.state;
    });

    await finishPersonalOAuthExchange(context, code, iss);
    return true;
  });
};
