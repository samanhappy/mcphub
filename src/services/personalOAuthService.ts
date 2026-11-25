import { validateAuthorizationRelay } from '../utils/oauthServerMetadata.js';
import { withLockConnection, withReplicaLock } from './replicaLock.js';
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
export const PERSONAL_OAUTH_FLOW_TTL_MS = 600_000;
export const hasPersonalOAuth = (config?: ServerConfig): boolean =>
  config?.oauth?.identityMode === 'personal';
export const personalOAuthContexts = new WeakMap<ServerConfig, PersonalOAuthContext>();
const queues = new Map<string, Promise<unknown>>();
const renewals = new Map<string, Promise<PersonalOAuthContext>>();
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
const personalOAuthLockScope = (serverName: string, username: string) =>
  JSON.stringify(['oauth', serverName, username]);
/**
 * Serialize one user's binding of a server across replicas. The action runs in the caller's
 * context; its binding reads and writes go through bindingStore.
 */
export const withPersonalOAuthLock = <T>(
  serverName: string,
  username: string,
  action: () => Promise<T>,
): Promise<T> => {
  const scope = personalOAuthLockScope(serverName, username);
  return withReplicaLock(scope, () => serialize(JSON.stringify([serverName, username]), action));
};
/**
 * Binding access for one user and server. While their replica lock is held, it runs on the
 * lock connection (withLockConnection): reads see the latest committed state, and writes are
 * committed at once, so a refreshed grant survives the rollback of the request that triggered
 * it. Otherwise it runs in the caller's context.
 */
const bindingStore = (serverName: string, username: string) => {
  const onLock = <T>(work: () => Promise<T>) =>
    withLockConnection(personalOAuthLockScope(serverName, username), work);
  const dao = () => getCredentialBindingDao();
  return {
    get: () => onLock(() => dao().get(serverName, username)),
    compareAndSave: (...args: Parameters<ReturnType<typeof dao>['compareAndSave']>) =>
      onLock(() => dao().compareAndSave(...args)),
    save: (...args: Parameters<ReturnType<typeof dao>['save']>) =>
      onLock(() => dao().save(...args)),
  };
};
const readBinding = (serverName: string, username: string) =>
  bindingStore(serverName, username).get();

export class PersonalAuthorizationRequiredError extends CredentialBindingError {}

export const personalAuthorizationRequired = (name: string) =>
  new PersonalAuthorizationRequiredError(
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
    accessTokenExpiresAt: _expiry,
    refreshToken: __,
    pendingAuthorization: ___,
    ...declaration
  } = oauth || {};
  return declaration;
};
// JSON.stringify is key-order sensitive, and the dashboard save path normalizes the
// OAuth object into a fixed key order (normalizeOAuth in serverConfigPersistence.ts),
// so a share-list-only edit could still flip a naive stringify (#1362). Canonicalize
// object keys (array order is preserved) so identical destination/client values always
// yield the same fingerprint regardless of property order.
const canonicalJson = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};
const fingerprint = (expanded: ServerConfig): string =>
  // URL-only MCP declarations use SSE; dashboard saves make that default explicit.
  canonicalJson([
    expanded.type ?? 'sse',
    expanded.type === 'openapi' ? [expanded.openapi?.url, expanded.openapi?.schema] : expanded.url,
    declarationOAuth(expanded.oauth),
  ]);
// Bindings persisted before #1362 stored the whole declaration:
// JSON.stringify([declaration, expanded.url, expanded.oauth]). Normalize such a stored
// value to the current destination-only format so an upgrade does not orphan every
// binding, while a genuine destination/client change still fails the comparison.
const normalizeLegacyDeclaration = (stored: string): string | undefined => {
  // The destination-only format before type normalization serialized an omitted
  // type as the literal `undefined`, so it cannot be read with JSON.parse.
  if (stored.startsWith('[undefined,')) {
    return `["sse",${stored.slice('[undefined,'.length)}`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return undefined;
  const [declaration, url, oauth] = parsed as [unknown, unknown, unknown];
  // The legacy form leads with the declaration object; the current form leads with the
  // type string. Only treat object-leading values as legacy.
  if (typeof declaration !== 'object' || declaration === null) return undefined;
  return canonicalJson([
    (declaration as { type?: string }).type ?? 'sse',
    url,
    declarationOAuth(oauth as OAuth | undefined),
  ]);
};
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
    const context = new PersonalOAuthContext(serverName, username, expanded, fingerprint(expanded));
    // Under the user's lock, the latest committed binding (a callback reloading the grant it
    // just saved); otherwise the caller's view, a request snapshot included: a binding made
    // stale by a later rotation is rejected under the lock before its token is redeemed.
    const binding = await readBinding(serverName, username);
    if (binding) {
      const values = await decryptCredentialValues(binding);
      const legacy = normalizeLegacyDeclaration(values.oauthDeclaration || '');
      if (
        values.oauth &&
        (values.oauthDeclaration === context.declaration ||
          (legacy !== undefined && legacy === context.declaration))
      ) {
        context.config.oauth = { ...context.config.oauth, ...JSON.parse(values.oauth) };
      }
      context.revision = binding.encryptedValues;
    }
    validateAuthorizationRelay(context.config.oauth);
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
    return pending?.state &&
      pending.createdAt &&
      Date.now() - pending.createdAt < PERSONAL_OAUTH_FLOW_TTL_MS
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
      const dao = bindingStore(this.serverName, this.username);
      const current = await dao.get();
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
      accessTokenExpiresAt?: number | null;
      refreshToken?: string | null;
      clearPendingAuthorization?: boolean;
    },
  ) {
    const saved = await this.mutate(({ oauth }) => {
      oauth.accessToken = tokens.accessToken;
      if (tokens.accessTokenExpiresAt !== undefined) {
        if (tokens.accessTokenExpiresAt === null) delete oauth.accessTokenExpiresAt;
        else oauth.accessTokenExpiresAt = tokens.accessTokenExpiresAt;
      }
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
  async renewTokens(action: () => Promise<void>): Promise<void> {
    const key = JSON.stringify([this.serverName, this.username, this.revision]);
    let renewal = renewals.get(key);
    if (!renewal) {
      renewal = (async () => {
        await this.assertCurrent();
        if ((await readBinding(this.serverName, this.username))?.encryptedValues !== this.revision)
          throw new CredentialBindingError('Personal authorization changed; reconnect');
        await action();
        return this;
      })();
      renewals.set(key, renewal);
    }
    try {
      const renewed = await renewal;
      await this.assertCurrent();
      if ((await readBinding(this.serverName, this.username))?.encryptedValues !== renewed.revision)
        throw new CredentialBindingError('Personal authorization changed; reconnect');
      this.revision = renewed.revision;
      this.config = renewed.config;
      personalOAuthContexts.set(this.config, this);
    } finally {
      if (renewals.get(key) === renewal) renewals.delete(key);
    }
  }
  updatePendingAuthorization(
    _name: string,
    pending: Partial<NonNullable<OAuth['pendingAuthorization']>>,
  ) {
    return this.mutate(({ oauth }) => {
      const existing = oauth.pendingAuthorization;
      // Mirror oauthSettingsStore.updatePendingAuthorization: the verifier and
      // any client sign-in continuation are bound to their state (drop stale
      // ones on state change) and the flow TTL only refreshes when the state
      // actually changes.
      const stateChanged = pending.state !== undefined && pending.state !== existing?.state;
      oauth.pendingAuthorization = {
        ...existing,
        ...pending,
        codeVerifier: pending.codeVerifier ?? (stateChanged ? undefined : existing?.codeVerifier),
        clientContinuation:
          pending.clientContinuation ?? (stateChanged ? undefined : existing?.clientContinuation),
        createdAt:
          pending.createdAt ??
          (stateChanged || !existing?.createdAt ? Date.now() : existing.createdAt),
      };
      if (oauth.pendingAuthorization.codeVerifier === undefined) {
        delete oauth.pendingAuthorization.codeVerifier;
      }
      if (oauth.pendingAuthorization.clientContinuation === undefined) {
        delete oauth.pendingAuthorization.clientContinuation;
      }
    });
  }
  clearOAuthData(_name: string, scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    return this.mutate(({ oauth }) => {
      if (scope === 'all' || scope === 'tokens') {
        delete oauth.accessToken;
        delete oauth.accessTokenExpiresAt;
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
  /**
   * Atomically remove `pendingAuthorization` when the stored binding still
   * matches this context's revision, even if server access or status changed
   * while the flow was in flight.
   */
  async clearPendingAuthorizationIfCurrentRevision(): Promise<boolean> {
    return withPersonalOAuthLock(this.serverName, this.username, async () => {
      if (!this.revision) return false;
      const dao = bindingStore(this.serverName, this.username);
      const current = await dao.get();
      if (!current || current.encryptedValues !== this.revision) return false;
      const config = structuredClone(this.config);
      delete config.oauth.pendingAuthorization;
      const encryptedValues = await encryptCredentialValues(this.serverName, this.username, {
        oauthDeclaration: this.declaration,
        oauth: JSON.stringify(config.oauth),
      });
      const saved = await dao.compareAndSave(
        {
          serverName: this.serverName,
          username: this.username,
          encryptedValues,
          updatedAt: new Date().toISOString(),
        },
        this.revision,
      );
      if (!saved) return false;
      this.revision = encryptedValues;
      this.config = config;
      personalOAuthContexts.set(config, this);
      return true;
    });
  }
}

export const hasUsablePersonalOAuthGrant = (context: PersonalOAuthContext): boolean => {
  const oauth = context.config.oauth;
  if (!oauth?.accessToken) return false;
  if (oauth.accessTokenExpiresAt === undefined || oauth.accessTokenExpiresAt > Date.now()) {
    return true;
  }
  return Boolean(oauth.refreshToken);
};

export const resolvePersonalOAuth = async (
  serverName: string,
  username: string,
  definition: ServerConfig,
) => {
  const context = await PersonalOAuthContext.load(serverName, username, definition);
  if (!context.config.oauth.accessToken) throw personalAuthorizationRequired(serverName);
  return { config: context.config, revision: context.version };
};

export interface PersonalOAuthFlowRecord {
  context: PersonalOAuthContext;
  expired: boolean;
}

export const findPersonalOAuthFlowRecord = async (
  state: string,
): Promise<PersonalOAuthFlowRecord | undefined> => {
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
      if (pending?.state === state) {
        const continuation = pending.clientContinuation;
        const expired =
          !pending.createdAt ||
          Date.now() - pending.createdAt >= PERSONAL_OAUTH_FLOW_TTL_MS ||
          (continuation !== undefined && continuation.expiresAt <= Date.now());
        return { context, expired };
      }
    }
  }
  return undefined;
};

export const findPersonalOAuthFlow = async (
  state: string,
): Promise<PersonalOAuthContext | undefined> => {
  const record = await findPersonalOAuthFlowRecord(state);
  if (!record || record.expired) return undefined;
  await record.context.assertCurrent();
  return record.context;
};

export const disconnectPersonalOAuth = async (
  serverName: string,
  username: string,
): Promise<void> => {
  await withPersonalOAuthLock(serverName, username, async () => {
    // Retain an encrypted tombstone so even a pre-save, unbound context becomes stale.
    await bindingStore(serverName, username).save({
      serverName,
      username,
      encryptedValues: await encryptCredentialValues(serverName, username, {}),
      updatedAt: new Date().toISOString(),
    });
  });
  // After the lock: the tombstone is committed when listeners reload the binding.
  credentialBindingEvents.emit('invalidate', { serverName, username });
};
