import { LegacyMcpClient } from '../clients/legacyMcpClient.js';
import { credentialBindingEvents } from './credentialBindingService.js';
import { PersonalOAuthContext, hasUsablePersonalOAuthGrant } from './personalOAuthService.js';
import { withOAuthPendingAuthLock } from './replicaLock.js';
import { createTransportFromConfig } from './mcpService.js';
import type { ServerConfigWithName } from '../dao/ServerDao.js';
import type { PendingPersonalOAuthContinuation } from '../types/index.js';

export const buildPersonalOAuthAuthorizationUrl = (
  serverName: string,
  context: PersonalOAuthContext,
): string | undefined => {
  let authorizationUrl = context.authorizationUrl;
  if (authorizationUrl && context.config.oauth.authorizationRelay) {
    const callback = new URL(authorizationUrl).searchParams.get('redirect_uri');
    if (!callback) throw new Error('Missing authorization callback');
    const relay = new URL(`relay/${encodeURIComponent(serverName)}`, callback);
    relay.searchParams.set('state', context.config.oauth.pendingAuthorization!.state!);
    authorizationUrl = relay.toString();
  }
  return authorizationUrl;
};

export interface StartPersonalOAuthFlowOptions {
  /**
   * When true, preserve an existing valid/refreshable personal grant and return
   * `alreadyConnected: true` without clearing tokens or starting a new upstream flow.
   */
  preserveUsableGrant?: boolean;
  /** Optional MCPHub client OAuth continuation bound to the new pending state. */
  clientContinuation?: PendingPersonalOAuthContinuation;
}

export interface StartPersonalOAuthFlowResult {
  context: PersonalOAuthContext;
  authorizationUrl?: string;
  alreadyConnected: boolean;
}

export const startPersonalOAuthFlow = async (
  definition: ServerConfigWithName,
  username: string,
  options: StartPersonalOAuthFlowOptions = {},
): Promise<StartPersonalOAuthFlowResult> =>
  withOAuthPendingAuthLock(definition.name, username, async () => {
    const context = await PersonalOAuthContext.load(definition.name, username, definition);
    if (options.preserveUsableGrant && hasUsablePersonalOAuthGrant(context)) {
      return {
        context,
        authorizationUrl: undefined,
        alreadyConnected: true,
      };
    }

    // Starting a new flow supersedes the previous flow and invalidates live sessions.
    await context.clearOAuthData(definition.name, 'tokens');
    await context.clearOAuthData(definition.name, 'verifier');
    credentialBindingEvents.emit('invalidate', {
      serverName: definition.name,
      username,
    });

    const config = context.config;
    if (config.type === 'openapi') {
      const { MCPHubOAuthProvider } = await import('./mcpOAuthProvider.js');
      const provider = await MCPHubOAuthProvider.create(definition.name, config);
      await provider.startOpenApiAuthorization();
    } else {
      const transport = await createTransportFromConfig(definition.name, config);
      const client = new LegacyMcpClient({ name: 'mcphub-personal-oauth', version: '1.0.0' });
      try {
        await client.connect(transport);
      } catch {
        if (!context.config.oauth.pendingAuthorization?.authorizationUrl) {
          throw new Error('Authorization discovery failed');
        }
      } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    }

    const pending = context.config.oauth.pendingAuthorization;
    if (!pending?.authorizationUrl || !pending.state) {
      throw new Error('Authorization discovery failed');
    }

    if (options.clientContinuation) {
      await context.updatePendingAuthorization(definition.name, {
        clientContinuation: options.clientContinuation,
      });
    }

    return {
      context,
      authorizationUrl: buildPersonalOAuthAuthorizationUrl(definition.name, context),
      alreadyConnected: false,
    };
  });

export const finishPersonalOAuthExchange = async (
  context: PersonalOAuthContext,
  code: string,
  iss?: string,
): Promise<void> => {
  const config = context.config;
  if (config.type === 'openapi') {
    const { MCPHubOAuthProvider } = await import('./mcpOAuthProvider.js');
    const provider = await MCPHubOAuthProvider.create(context.serverName, config);
    await provider.finishOpenApiAuthorization(code, iss);
    credentialBindingEvents.emit('invalidate', {
      serverName: context.serverName,
      username: context.username,
    });
    return;
  }

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
  } finally {
    await transport.close().catch(() => undefined);
  }
};
