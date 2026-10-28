import {
  hasPersonalOAuth,
  resolvePersonalOAuth,
  personalOAuthContexts,
  withPersonalOAuthLock,
} from './personalOAuthService.js';
import { getServerDao } from '../dao/DaoFactory.js';
import { credentialBindingEvents, resolveCredentialBinding } from './credentialBindingService.js';
import { authorizationService, type RequestPrincipal } from './authorizationService.js';
import { CredentialBindingError, hasPersonalAuthentication } from '../utils/credentialTemplate.js';
import { expandServerConfig } from './serverConfigEnvironment.js';
import type { CapabilityScope } from './capabilitySnapshotService.js';
import type { ServerConfig, ServerInfo, Tool } from '../types/index.js';

interface RuntimeEntry {
  serverName: string;
  username: string;
  revision: string;
  promise: Promise<ServerInfo>;
  valid: boolean;
  info?: ServerInfo;
  active: number;
  timer?: NodeJS.Timeout;
}

/** Reuses children across MCP sessions, but never across authenticated principals. */
export class PrincipalRuntimeService {
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly toolCatalogs = new Map<
    string,
    { serverName: string; username: string; tools: Tool[] }
  >();

  peekTools(serverName: string, username: string): Tool[] | undefined {
    const entry = this.entries.get(JSON.stringify([serverName, username]));
    return entry?.valid && entry.info
      ? entry.info.tools
      : this.toolCatalogs.get(JSON.stringify([serverName, username]))?.tools;
  }

  constructor(
    private readonly connect: (
      name: string,
      config: ServerConfig,
      scope?: CapabilityScope,
    ) => Promise<ServerInfo>,
    private readonly close: (info: ServerInfo) => void,
    private readonly restoreTools?: (
      name: string,
      config: ServerConfig,
      scope: CapabilityScope,
    ) => Promise<ServerInfo | undefined>,
  ) {
    credentialBindingEvents.on('invalidate', (filter) => this.invalidate(filter));
  }

  invalidate(filter: { serverName?: string; username?: string } = {}): void {
    for (const [key, catalog] of this.toolCatalogs) {
      if (filter.serverName !== undefined && catalog.serverName !== filter.serverName) continue;
      if (filter.username !== undefined && catalog.username !== filter.username) continue;
      this.toolCatalogs.delete(key);
    }
    for (const [key, entry] of this.entries) {
      if (filter.serverName !== undefined && entry.serverName !== filter.serverName) continue;
      if (filter.username !== undefined && entry.username !== filter.username) continue;
      entry.valid = false;
      clearTimeout(entry.timer);
      this.entries.delete(key);
      void entry.promise.then((info) => this.close(info)).catch(() => undefined);
    }
  }

  async acquire(
    serverName: string,
    principal: RequestPrincipal,
    toolsOnly = false,
  ): Promise<{ info: ServerInfo; release: () => void }> {
    if (principal.credentialEligible === false)
      throw new CredentialBindingError('Personal authentication is required');
    const definition = await getServerDao().findById(serverName);
    if (
      !definition ||
      definition.enabled === false ||
      !hasPersonalAuthentication(definition) ||
      !authorizationService.can('server.invoke', definition, principal)
    ) {
      throw new CredentialBindingError('Server not available');
    }
    // These snapshots only detect runtime changes in memory; they are never persisted or logged.
    const definitionSnapshot = JSON.stringify(definition);
    const resolver = hasPersonalOAuth(definition) ? resolvePersonalOAuth : resolveCredentialBinding;
    if (toolsOnly && this.restoreTools) {
      const resolved = await resolver(
        serverName,
        principal.username,
        hasPersonalOAuth(definition) ? definition : await expandServerConfig(definition),
      );
      const existing = this.entries.get(JSON.stringify([serverName, principal.username]));
      const live =
        existing?.valid &&
        existing.revision === JSON.stringify([definitionSnapshot, resolved.revision]) &&
        existing.info?.status !== 'disconnected';
      const cached = live
        ? undefined
        : await this.restoreTools(serverName, resolved.config, {
            username: principal.username,
            revision: resolved.revision,
          });
      if (cached) {
        const latest = await resolver(serverName, principal.username, definition);
        const current = await getServerDao().findById(serverName);
        if (latest.revision !== resolved.revision || JSON.stringify(current) !== definitionSnapshot)
          throw new CredentialBindingError(
            'Personal credentials or server configuration changed; retry the request',
          );
        this.toolCatalogs.set(JSON.stringify([serverName, principal.username]), {
          serverName,
          username: principal.username,
          tools: cached.tools,
        });
        return { info: cached, release: () => {} };
      }
    }
    const prepare = async () => {
      const resolved = await resolver(
        serverName,
        principal.username,
        hasPersonalOAuth(definition) ? definition : await expandServerConfig(definition),
      );
      const revision = JSON.stringify([definitionSnapshot, resolved.revision]);
      const key = JSON.stringify([serverName, principal.username]);
      let entry = this.entries.get(key);
      if (entry && (entry.revision !== revision || entry.info?.status === 'disconnected')) {
        this.invalidate({ serverName, username: principal.username });
        entry = undefined;
      }
      if (!entry) {
        const created: RuntimeEntry = {
          serverName,
          username: principal.username,
          // This context advances only after its own successful CAS writes. External
          // binding changes still differ from its version and invalidate the runtime.
          get revision() {
            return JSON.stringify([
              definitionSnapshot,
              personalOAuthContexts.get(resolved.config)?.version || resolved.revision,
            ]);
          },
          valid: true,
          active: 0,
          promise: undefined!,
        };
        this.entries.set(key, created);
        created.promise = (async () => {
          let info: ServerInfo | undefined;
          try {
            info = await this.connect(serverName, resolved.config, {
              username: principal.username,
              revision: resolved.revision,
            });
            // A rotation/deletion may have raced the initial read or async handshake.
            const verify = async () => {
              const latest = await resolver(serverName, principal.username, definition);
              const currentDefinition = await getServerDao().findById(serverName);
              if (
                !created.valid ||
                latest.revision !==
                  (personalOAuthContexts.get(resolved.config)?.version || resolved.revision) ||
                JSON.stringify(currentDefinition) !== definitionSnapshot
              ) {
                throw new CredentialBindingError(
                  'Personal credentials or server configuration changed; retry the request',
                );
              }
            };
            if (hasPersonalOAuth(definition))
              await withPersonalOAuthLock(serverName, principal.username, verify);
            else await verify();
            created.info = info;
            return info;
          } catch (error) {
            if (info) this.close(info);
            if (this.entries.get(key) === created) this.entries.delete(key);
            created.valid = false;
            throw error;
          }
        })();
        entry = created;
      }
      return entry;
    };
    const entry = hasPersonalOAuth(definition)
      ? await withPersonalOAuthLock(serverName, principal.username, prepare)
      : await prepare();
    clearTimeout(entry.timer);
    entry.active += 1;
    const held = entry;
    const release = () => {
      held.active -= 1;
      if (held.active === 0 && held.valid) {
        const idleMs =
          definition.idleTimeoutMs && definition.idleTimeoutMs > 0
            ? definition.idleTimeoutMs
            : 300_000;
        held.timer = setTimeout(
          () => this.invalidate({ serverName, username: principal.username }),
          idleMs,
        );
        held.timer.unref?.();
      }
    };
    try {
      const info = await held.promise;
      if (!held.valid)
        throw new CredentialBindingError('Personal credentials changed; retry the request');
      return { info, release };
    } catch (error) {
      release();
      throw error;
    }
  }
}
