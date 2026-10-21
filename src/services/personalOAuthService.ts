import { expandServerConfig } from './serverConfigEnvironment.js';
import type { FetchLike } from '../utils/ssrf.js';
import { getCredentialBindingDao, getServerDao, getUserDao } from '../dao/DaoFactory.js';
import {
  credentialBindingEvents,
  encryptCredentialValues,
  decryptCredentialValues,
} from './credentialBindingService.js';
import { authorizationService } from './authorizationService.js';
import { CredentialBindingError } from '../utils/credentialTemplate.js';
import type { ServerConfig } from '../types/index.js';
import type { OAuthSettingsContext, ServerConfigWithOAuth } from './oauthSettingsStore.js';

type OAuth = NonNullable<ServerConfig['oauth']>;
export const hasPersonalOAuth = (config?: ServerConfig): boolean =>
  config?.oauth?.identityMode === 'personal';
export const personalOAuthContexts = new WeakMap<ServerConfig, PersonalOAuthContext>();
const queues = new Map<string, Promise<unknown>>();
const serialize = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
};
export const withPersonalOAuthLock = <T>(
  serverName: string,
  username: string,
  action: () => Promise<T>,
): Promise<T> => serialize(JSON.stringify([serverName, username]), action);

export const personalAuthorizationRequired = (name: string) =>
  new CredentialBindingError(
    `Personal authorization required for '${name}'. Connect in Dashboard → Servers.`,
  );

// The declaration, not resolved tokens/client registration, binds a flow to its destination.
// Only destination-relevant fields participate: transport type, endpoint URL, and the OAuth
// client/endpoint metadata. Unrelated declaration edits (visibility, sharedWithUsers,
// description, options, tools, ...) must not invalidate existing personal bindings (#1362).
// `enabled` and `server.invoke` access checks are enforced separately by assertCurrent() and
// principalRuntimeService, so they are intentionally absent here. Runtime token/session fields
// (accessToken, refreshToken, pendingAuthorization) never belong to a stored declaration.
// Bindings follow a plain rename; the display name does not change the destination.
const declarationOAuth = (oauth?: OAuth): OAuth => {
  const {
    accessToken: _,
    refreshToken: __,
    pendingAuthorization: ___,
    ...declaration
  } = oauth || {};
  return declaration;
};
const fingerprint = (expanded: ServerConfig): string =>
  JSON.stringify([expanded.type, expanded.url, declarationOAuth(expanded.oauth)]);
export class PersonalOAuthContext {
  private revision: string | undefined;
  private declaration: string;
  config: ServerConfigWithOAuth;
  private constructor(
    readonly serverName: string,
    readonly username: string,
    config: ServerConfig,
    declaration: string,
  ) {
    this.declaration = declaration;
    const oauth = declarationOAuth(config.oauth);
    this.config = {
      ...config,
      oauth,
      passthroughHeaders: config.passthroughHeaders?.filter(
        (name) => name.toLowerCase() !== 'authorization',
      ),
    };
  }
  static async load(serverName: string, username: string, definition: ServerConfig) {
    const expanded = await expandServerConfig(definition);
    const context = new PersonalOAuthContext(
      serverName,
      username,
      expanded,
      fingerprint(expanded),
    );
    const binding = await getCredentialBindingDao().get(serverName, username);
    if (binding) {
      const values = await decryptCredentialValues(binding);
      if (values.oauthDeclaration === context.declaration && values.oauth) {
        context.config.oauth = { ...context.config.oauth, ...JSON.parse(values.oauth) };
      }
      context.revision = binding.encryptedValues;
    }
    personalOAuthContexts.set(context.config, context);
    return context;
  }
  private refresh?: { key: string; response: Promise<Response> };
  wrapFetch(fetchFn: FetchLike): FetchLike {
    return async (input, init) => {
      const body =
        init?.body instanceof URLSearchParams
          ? init.body
          : typeof init?.body === 'string'
            ? new URLSearchParams(init.body)
            : undefined;
      if (body?.get('grant_type') !== 'refresh_token') return fetchFn(input, init);
      const key = JSON.stringify([String(input), body.get('refresh_token')]);
      if (this.refresh?.key !== key) {
        const response = fetchFn(input, init);
        this.refresh = { key, response };
        void response.then(
          () => {
            // The SDK may reject an HTTP 200 payload without persisting tokens.
            // Bound coalescing so that an unusable response cannot poison retries.
            const timer = setTimeout(() => {
              if (this.refresh?.response === response) this.refresh = undefined;
            }, 1000);
            timer.unref?.();
          },
          () => {
            if (this.refresh?.response === response) this.refresh = undefined;
          },
        );
      }
      // Briefly share the response until token persistence completes, so concurrent
      // SDK calls do not redeem a rotating refresh token twice.
      const refresh = this.refresh!;
      const response = await refresh.response;
      if (!response.ok && this.refresh === refresh) this.refresh = undefined;
      return response.clone();
    };
  }
  get authorizationUrl(): string | undefined {
    const pending = this.config.oauth.pendingAuthorization;
    return pending?.state && pending.createdAt && Date.now() - pending.createdAt < 600_000
      ? pending.authorizationUrl
      : undefined;
  }
  get version(): string {
    return this.revision || 'unbound';
  }
  async assertCurrent(): Promise<void> {
    const definition = await getServerDao().findById(this.serverName);
    const user = await getUserDao().findByUsername(this.username);
    if (
      !definition ||
      !user ||
      definition.enabled === false ||
      !hasPersonalOAuth(definition) ||
      fingerprint(await expandServerConfig(definition)) !== this.declaration ||
      !authorizationService.can('server.invoke', definition, { ...user, username: this.username })
    )
      throw new CredentialBindingError(
        'Personal authorization or server access changed; reconnect',
      );
  }
  async mutate(mutator: (context: OAuthSettingsContext) => void): Promise<ServerConfigWithOAuth> {
    return withPersonalOAuthLock(this.serverName, this.username, async () => {
      await this.assertCurrent();
      const dao = getCredentialBindingDao();
      const current = await dao.get(this.serverName, this.username);
      if (current?.encryptedValues !== this.revision)
        throw new CredentialBindingError('Personal authorization changed; reconnect');
      const config = structuredClone(this.config);
      mutator({ serverConfig: config, oauth: config.oauth });
      const encryptedValues = await encryptCredentialValues(this.serverName, this.username, {
        oauthDeclaration: this.declaration,
        oauth: JSON.stringify(config.oauth),
      });
      await this.assertCurrent();
      if (
        !(await dao.compareAndSave(
          {
            serverName: this.serverName,
            username: this.username,
            encryptedValues,
            updatedAt: new Date().toISOString(),
          },
          this.revision,
        ))
      )
        throw new CredentialBindingError('Personal authorization changed; reconnect');
      this.revision = encryptedValues;
      this.config = config;
      personalOAuthContexts.set(config, this);
      return config;
    });
  }
  async loadServerConfig(_name?: string): Promise<ServerConfigWithOAuth> {
    await this.assertCurrent();
    return this.config;
  }
  mutateOAuthSettings(_name: string, mutator: (context: OAuthSettingsContext) => void) {
    return this.mutate(mutator);
  }
  persistClientCredentials(_name: string, credentials: Partial<OAuth>) {
    return this.mutate(({ oauth }) => Object.assign(oauth, credentials));
  }
  async persistTokens(
    _name: string,
    tokens: {
      accessToken: string;
      refreshToken?: string | null;
      clearPendingAuthorization?: boolean;
    },
  ) {
    const saved = await this.mutate(({ oauth }) => {
      oauth.accessToken = tokens.accessToken;
      if (tokens.refreshToken !== undefined) oauth.refreshToken = tokens.refreshToken || undefined;
      const metadata = oauth.pendingAuthorization?.discoveryState?.authorizationServerMetadata;
      if (
        metadata &&
        'revocation_endpoint' in metadata &&
        typeof metadata.revocation_endpoint === 'string'
      )
        oauth.revocationEndpoint = metadata.revocation_endpoint;
      if (tokens.clearPendingAuthorization) delete oauth.pendingAuthorization;
    });
    this.refresh = undefined;
    return saved;
  }
  updatePendingAuthorization(
    _name: string,
    pending: Partial<NonNullable<OAuth['pendingAuthorization']>>,
  ) {
    return this.mutate(({ oauth }) => {
      oauth.pendingAuthorization = {
        ...oauth.pendingAuthorization,
        ...pending,
        createdAt: pending.createdAt ?? Date.now(),
      };
    });
  }
  clearOAuthData(_name: string, scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    return this.mutate(({ oauth }) => {
      if (scope === 'all' || scope === 'tokens') {
        delete oauth.accessToken;
        delete oauth.refreshToken;
      }
      if (scope === 'all' || scope === 'client') {
        delete oauth.clientId;
        delete oauth.clientSecret;
      }
      if (scope === 'all' || scope === 'verifier') delete oauth.pendingAuthorization;
      if (scope === 'discovery' && oauth.pendingAuthorization) {
        delete oauth.pendingAuthorization.discoveryState;
        delete oauth.pendingAuthorization.issuer;
        delete oauth.pendingAuthorization.issRequired;
      }
    });
  }
}

export const resolvePersonalOAuth = async (
  serverName: string,
  username: string,
  definition: ServerConfig,
) => {
  const context = await PersonalOAuthContext.load(serverName, username, definition);
  if (!context.config.oauth.accessToken) throw personalAuthorizationRequired(serverName);
  return { config: context.config, revision: context.version };
};

export const findPersonalOAuthFlow = async (
  state: string,
): Promise<PersonalOAuthContext | undefined> => {
  if (!state.startsWith('personal.')) return undefined;
  for (const server of await getServerDao().findAll()) {
    if (!hasPersonalOAuth(server)) continue;
    for (const username of await getCredentialBindingDao().listUsernames(server.name)) {
      let context: PersonalOAuthContext;
      try {
        context = await PersonalOAuthContext.load(server.name, username, server);
      } catch {
        continue;
      } // One damaged binding must not block another user's callback.
      const pending = context.config.oauth.pendingAuthorization;
      if (
        pending?.state === state &&
        pending.createdAt &&
        Date.now() - pending.createdAt < 600_000
      ) {
        await context.assertCurrent();
        return context;
      }
    }
  }
  return undefined;
};

export const disconnectPersonalOAuth = async (
  serverName: string,
  username: string,
): Promise<void> => {
  await withPersonalOAuthLock(serverName, username, async () => {
    // Retain an encrypted tombstone so even a pre-save, unbound context becomes stale.
    await getCredentialBindingDao().save({
      serverName,
      username,
      encryptedValues: await encryptCredentialValues(serverName, username, {}),
      updatedAt: new Date().toISOString(),
    });
    credentialBindingEvents.emit('invalidate', { serverName, username });
  });
};
