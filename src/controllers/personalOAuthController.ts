import type { Request, Response } from 'express';
import { LegacyMcpClient } from '../clients/legacyMcpClient.js';
import { getServerDao } from '../dao/DaoFactory.js';
import { authorizationService, type RequestPrincipal } from '../services/authorizationService.js';
import { credentialBindingEvents } from '../services/credentialBindingService.js';
import {
  PersonalOAuthContext,
  hasPersonalOAuth,
  findPersonalOAuthFlow,
  disconnectPersonalOAuth,
} from '../services/personalOAuthService.js';
import { createTransportFromConfig } from '../services/mcpService.js';
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
      const binding = await PersonalOAuthContext.load(definition.name, user.username, definition);
      await disconnectPersonalOAuth(definition.name, user.username);
      const oauth = binding.config.oauth;
      if (oauth.revocationEndpoint) {
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
    const context = await PersonalOAuthContext.load(definition.name, user.username, definition);
    if (req.method === 'POST') {
      // Starting a new flow supersedes the previous flow and invalidates live sessions.
      await context.clearOAuthData(definition.name, 'tokens');
      await context.clearOAuthData(definition.name, 'verifier');
      credentialBindingEvents.emit('invalidate', {
        serverName: definition.name,
        username: user.username,
      });
      const config = context.config;
      const transport = await createTransportFromConfig(definition.name, config);
      const client = new LegacyMcpClient({ name: 'mcphub-personal-oauth', version: '1.0.0' });
      try {
        await client.connect(transport);
      } catch {
        if (!context.config.oauth.pendingAuthorization?.authorizationUrl)
          throw new Error('Authorization discovery failed');
      } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    }
    res.json({
      success: true,
      data: {
        connected: Boolean(context.config.oauth.accessToken),
        authorizationUrl: context.authorizationUrl,
        status: context.config.oauth.accessToken ? 'connected' : 'oauth_required',
      },
    });
  } catch (error) {
    res
      .status(error instanceof CredentialBindingError ? 400 : 502)
      .json({
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
  const context = await findPersonalOAuthFlow(state);
  if (!context) return false;
  const pending = context.config.oauth.pendingAuthorization!;
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
  const config = context.config;
  const transport = await createTransportFromConfig(context.serverName, config);
  try {
    if (!('finishAuth' in transport)) throw new Error('OAuth transport required');
    await (transport as { finishAuth: (code: string, iss?: string) => Promise<void> }).finishAuth(
      code,
      iss,
    );
    credentialBindingEvents.emit('invalidate', {
      serverName: context.serverName,
      username: context.username,
    });
    return true;
  } finally {
    await transport.close().catch(() => undefined);
  }
};
