import { createHash } from 'node:crypto';
import { getServerDao } from '../dao/DaoFactory.js';
import { credentialBindingEvents, resolveCredentialBinding } from './credentialBindingService.js';
import { authorizationService, type RequestPrincipal } from './authorizationService.js';
import { CredentialBindingError, hasCredentialTemplate } from '../utils/credentialTemplate.js';
import { replaceEnvVars } from '../config/index.js';
import type { ServerConfig, ServerInfo } from '../types/index.js';

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

  constructor(
    private readonly connect: (name: string, config: ServerConfig) => Promise<ServerInfo>,
    private readonly close: (info: ServerInfo) => void,
  ) {
    credentialBindingEvents.on('invalidate', (filter) => this.invalidate(filter));
  }

  invalidate(filter: { serverName?: string; username?: string } = {}): void {
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
  ): Promise<{ info: ServerInfo; release: () => void }> {
    if (principal.credentialEligible === false)
      throw new CredentialBindingError('Personal authentication is required');
    const definition = await getServerDao().findById(serverName);
    if (
      !definition ||
      definition.enabled === false ||
      !hasCredentialTemplate(definition) ||
      !authorizationService.can('server.invoke', definition, principal)
    ) {
      throw new CredentialBindingError('Server not available');
    }
    const resolved = await resolveCredentialBinding(
      serverName,
      principal.username,
      replaceEnvVars(definition) as ServerConfig,
    );
    const revision = createHash('sha256')
      .update(JSON.stringify([definition, resolved.revision]))
      .digest('hex');
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
        revision,
        valid: true,
        active: 0,
        promise: undefined!,
      };
      this.entries.set(key, created);
      created.promise = (async () => {
        let info: ServerInfo | undefined;
        try {
          info = await this.connect(serverName, resolved.config);
          // A rotation/deletion may have raced the initial read or async handshake.
          const latest = await resolveCredentialBinding(serverName, principal.username, definition);
          const currentDefinition = await getServerDao().findById(serverName);
          if (
            !created.valid ||
            latest.revision !== resolved.revision ||
            JSON.stringify(currentDefinition) !== JSON.stringify(definition)
          ) {
            throw new CredentialBindingError(
              'Personal credentials or server configuration changed; retry the request',
            );
          }
          created.info = info;
          return info;
        } catch (error) {
          if (info) this.close(info);
          if (this.entries.get(key) === created) this.entries.delete(key);
          created.valid = false;
          throw error instanceof CredentialBindingError
            ? error
            : new CredentialBindingError(
                `Unable to connect '${serverName}' with your personal credentials. Check your binding in My Credentials.`,
              );
        }
      })();
      entry = created;
    }
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
