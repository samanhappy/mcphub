import type {
  Prompt,
  Resource,
  Tool,
  RequestOptions,
  Transport,
} from '@modelcontextprotocol/server';
import type { Client } from '../clients/mcpSdkClient.js';
import type { ServerConfig, ServerInfo, UpstreamResourceTemplate } from '../types/index.js';
import { getServerDao } from '../dao/index.js';
import { hasPersonalAuthentication } from '../utils/credentialTemplate.js';
import { logger } from '../utils/logger.js';
import { formatErrorForLogging, summarizeErrorForLogging } from '../utils/serialization.js';
import { expandServerConfig } from './serverConfigEnvironment.js';
import { prepareCapabilitySnapshot, flushCapabilitySnapshot } from './capabilitySnapshotService.js';
import { captureStdioTreeSafely, killStdioProcessTree } from './mcpStdioLifecycle.js';

interface OnDemandLifecycleDependencies {
  createTransportFromConfig(
    name: string,
    config: ServerConfig,
  ): Promise<NonNullable<ServerInfo['transport']>>;
  createUpstreamMcpClient(
    name: string,
    getServerInfo: () => ServerInfo | undefined,
    config: ServerConfig,
  ): Client;
  connectClientWithDiagnostics(
    client: Client,
    transport: Transport,
    options?: RequestOptions,
  ): Promise<void>;
  applyResolvedPackageVersion(info: ServerInfo, config: ServerConfig): void;
  isHubSelfConnection(client: Client): boolean;
  setupServerKeepAlive(info: ServerInfo, config: ServerConfig): void;
  updateServerToolsCache(info: ServerInfo, tools: Tool[]): void;
  updateServerPromptsCache(info: ServerInfo, prompts: Prompt[]): void;
  updateServerResourcesCache(info: ServerInfo, resources: Resource[]): void;
  refreshServerResourceTemplatesCache(
    getTarget: () => ServerInfo | undefined,
    client: Client,
    options?: RequestOptions,
  ): Promise<UpstreamResourceTemplate[] | undefined>;
  broadcastToolListChanged(): void;
}

// stdio servers are the only ones that benefit from deferred spawning; HTTP/SSE
// and OpenAPI servers have no long-lived child process to skip.
export const isStdioServer = (conf: ServerConfig | undefined): boolean =>
  !!conf && (conf.type === 'stdio' || (!conf.type && !!conf.command));

const clearIdleShutdown = (serverInfo: ServerInfo): void => {
  if (serverInfo.idleTimeoutId) {
    clearTimeout(serverInfo.idleTimeoutId);
    serverInfo.idleTimeoutId = undefined;
  }
};

export const closeServerRuntime = (serverInfo: ServerInfo): void => {
  clearIdleShutdown(serverInfo);
  if (serverInfo.client) serverInfo.client.onclose = undefined;
  serverInfo.recovery = undefined;
  if (serverInfo.keepAliveIntervalId) {
    clearInterval(serverInfo.keepAliveIntervalId);
    serverInfo.keepAliveIntervalId = undefined;
    logger.log('Cleared MCP server keep-alive interval');
  }

  const candidateTransport = serverInfo.transport as
    | {
        pid?: unknown;
      }
    | undefined;
  // Snapshot the tree while it is still intact. Both close() calls below
  // signal the child, and a wrapper such as `npx` that exits on SIGTERM takes
  // the only link to its children with it.
  const { pid: stdioPid, captured } = captureStdioTreeSafely(
    serverInfo.name,
    () => candidateTransport?.pid,
  );

  if (serverInfo.client) {
    try {
      serverInfo.client.close();
    } catch {
      logger.warn('Error closing MCP client during runtime shutdown');
    }
    serverInfo.client = undefined;
  }

  if (serverInfo.transport) {
    try {
      serverInfo.transport.close();
    } catch {
      logger.warn('Error closing MCP transport during runtime shutdown');
    }
    serverInfo.transport = undefined;
  }

  if (stdioPid) {
    killStdioProcessTree(serverInfo.name, stdioPid, captured);
  }

  logger.log('Closed MCP server client and transport');
};

// Connection construction and capability publication remain owned by the hub.
// The lifecycle only manages wake-up, in-flight calls, and idle shutdown.
export const createOnDemandLifecycle = (dependencies: OnDemandLifecycleDependencies) => {
  const {
    createTransportFromConfig,
    createUpstreamMcpClient,
    connectClientWithDiagnostics,
    applyResolvedPackageVersion,
    isHubSelfConnection,
    setupServerKeepAlive,
    updateServerToolsCache,
    updateServerPromptsCache,
    updateServerResourcesCache,
    refreshServerResourceTemplatesCache,
    broadcastToolListChanged,
  } = dependencies;

  // ---------------------------------------------------------------------------
  // On-demand spawning helpers
  // ---------------------------------------------------------------------------

  /**
   * Shuts down an on-demand stdio server without removing it from serverInfos.
   * The tool/prompt/resource lists are preserved so agents can still see what
   * the server offers and trigger a cold-start on the next tool call.
   */
  const shutdownOnDemandServer = (serverInfo: ServerInfo): void => {
    // Discovery priming may finish while a tool call is using the same child.
    if (serverInfo.activeToolCalls) return;

    // Close runtime (kills process) but intentionally keep tools/prompts/resources
    closeServerRuntime(serverInfo);

    serverInfo.status = 'disconnected';
    logger.log(
      `[${serverInfo.name}] On-demand server shut down after idle; ` +
        `${serverInfo.tools.length} tools cached for next wake-up`,
    );
  };

  /**
   * Starts the idle period once the last active call has finished.
   */
  const scheduleIdleShutdown = (serverInfo: ServerInfo): void => {
    clearIdleShutdown(serverInfo);
    if (
      !serverInfo.config?.startOnDemand ||
      !isStdioServer(serverInfo.config) ||
      hasPersonalAuthentication(serverInfo.config) ||
      serverInfo.status !== 'connected' ||
      !serverInfo.client ||
      serverInfo.activeToolCalls
    ) {
      return;
    }

    const idleMs = serverInfo.config.idleTimeoutMs ?? 300_000; // default 5 minutes
    serverInfo.idleTimeoutId = setTimeout(() => {
      if (serverInfo.status === 'connected') {
        shutdownOnDemandServer(serverInfo);
      }
    }, idleMs);
  };

  const beginOnDemandToolCall = (serverInfo: ServerInfo): (() => void) | undefined => {
    if (
      !serverInfo.config?.startOnDemand ||
      !isStdioServer(serverInfo.config) ||
      hasPersonalAuthentication(serverInfo.config)
    ) {
      return undefined;
    }

    clearIdleShutdown(serverInfo);
    serverInfo.activeToolCalls = (serverInfo.activeToolCalls ?? 0) + 1;
    return () => {
      serverInfo.activeToolCalls = serverInfo.activeToolCalls! - 1;
      scheduleIdleShutdown(serverInfo);
    };
  };

  /**
   * Tear down one spawn's own handles. Deliberately not `closeServerRuntime`:
   * on a superseded spawn the entry already holds the *replacement* runtime, and
   * closing through the entry would kill the runtime that replaced it.
   */
  const closeSpawnRuntime = (
    name: string,
    client: { close?: () => unknown } | undefined,
    transport: { close?: () => unknown; pid?: unknown } | undefined,
  ): void => {
    const pid = typeof transport?.pid === 'number' ? transport.pid : null;
    try {
      client?.close?.();
    } catch {
      logger.warn('Error closing superseded client');
    }
    try {
      transport?.close?.();
    } catch {
      logger.warn('Error closing superseded transport');
    }
    if (pid) killStdioProcessTree(name, pid);
  };

  /**
   * Ensures an on-demand server is connected before a tool call proceeds.
   *
   * Performs a direct, awaited wake-up that mutates the existing `serverInfo`
   * in place (preserving the reference callers hold), rather than going through
   * `reconnectServer` -> `initializeClientsFromSettings`. The latter skips the
   * connect for on-demand servers, resolves before the fire-and-forget handshake
   * completes, and rebuilds `serverInfos` (leaving callers with a stale object) -
   * so it could never actually wake a sleeping server. See #1029.
   *
   * Concurrent callers coalesce on `spawningPromise` so only one spawn runs.
   */
  const ensureServerReady = async (serverInfo: ServerInfo): Promise<void> => {
    if (serverInfo.status === 'connected') return;

    // Another call is already spawning - wait for it
    if (serverInfo.spawningPromise) {
      await serverInfo.spawningPromise;
      return;
    }

    const spawnStart = Date.now();
    const generation = serverInfo.runtimeGeneration ?? 0;
    // A reconnect (config change, staging edit) increments the generation and
    // invalidates this spawn's right to publish anything.
    const stale = () => (serverInfo.runtimeGeneration ?? 0) !== generation;

    let spawnClient: { close?: () => unknown } | undefined;
    let spawnTransport: { close?: () => unknown; pid?: unknown } | undefined;

    const spawnPromise = (async () => {
      // Load the config fresh from the DAO for the expanded transport config and
      // to read the server name. See #1029.
      const rawConfig = await getServerDao().findById(serverInfo.name);
      if (!rawConfig) {
        throw new Error('Server configuration not found for on-demand wake');
      }
      if (rawConfig.enabled === false) {
        throw new Error(`Cannot start disabled on-demand server: ${rawConfig.name}`);
      }
      const expandedConf = await expandServerConfig(rawConfig);

      // startOnDemand is a stdio-only optimisation; OpenAPI/HTTP servers have no
      // deferred process to spawn, so there is nothing to wake.
      if (expandedConf.type === 'openapi') {
        return;
      }

      await prepareCapabilitySnapshot(serverInfo, expandedConf);
      const name = rawConfig.name;
      logger.log(`[${name}] Cold-starting on-demand server…`);

      const transport = await createTransportFromConfig(name, expandedConf);
      spawnTransport = transport;
      const client = createUpstreamMcpClient(name, () => serverInfo, expandedConf);
      spawnClient = client;

      const serverRequestOptions = expandedConf.options || {};
      const defaultRequestTimeout = Number(process.env.DEFAULT_REQUEST_TIMEOUT) || 60000;
      const requestOptions = {
        timeout: serverRequestOptions.timeout || defaultRequestTimeout,
        resetTimeoutOnProgress: serverRequestOptions.resetTimeoutOnProgress ?? true,
        maxTotalTimeout: serverRequestOptions.maxTotalTimeout,
      };

      await connectClientWithDiagnostics(client, transport, requestOptions);

      if (stale()) {
        // The server was reconfigured while this cold start was connecting: the
        // new runtime owns the entry, so shut this one down instead of
        // publishing it. `closeServerRuntime` also kills a spawned child, which a
        // bare client.close() would leave running.
        closeSpawnRuntime(name, client, transport);
        return;
      }

      // Mutate in place so every holder of this serverInfo (resolution paths,
      // the caller about to invoke the tool) sees the live client/status.
      serverInfo.client = client;
      serverInfo.transport = transport;
      serverInfo.options = requestOptions;
      serverInfo.version = client.getServerVersion?.()?.version;
      serverInfo.instructions = client.getInstructions?.();
      serverInfo.config = expandedConf;
      // Record the resolved npx/uvx package version backing this server.
      applyResolvedPackageVersion(serverInfo, expandedConf);
      serverInfo.status = 'connected';
      serverInfo.error = null;

      let toolCount = 0;
      let promptCount = 0;
      let resourceCount = 0;
      const capabilities = client.getServerCapabilities?.();
      if (isHubSelfConnection(client)) {
        serverInfo.tools = [];
        serverInfo.prompts = [];
        serverInfo.resources = [];
        serverInfo.resourceTemplates = [];
        setupServerKeepAlive(serverInfo, expandedConf);
        logger.warn(
          `Ignoring capabilities from self-connection '${name}' to prevent a recursive list loop`,
        );
        return;
      }
      if (capabilities?.tools) {
        try {
          const tools = await client.listTools({}, requestOptions);
          if (stale()) return;
          toolCount = tools.tools.length;
          updateServerToolsCache(serverInfo, tools.tools);
          broadcastToolListChanged();
        } catch (error) {
          logger.warn(`[${name}] Failed to list tools during wake`, {
            error: summarizeErrorForLogging(error),
          });
        }
      } else {
        updateServerToolsCache(serverInfo, []);
        broadcastToolListChanged();
      }
      await flushCapabilitySnapshot(serverInfo);
      if (capabilities?.prompts) {
        try {
          const prompts = await client.listPrompts({}, requestOptions);
          if (stale()) return;
          promptCount = prompts.prompts.length;
          updateServerPromptsCache(serverInfo, prompts.prompts);
        } catch (error) {
          logger.warn(`[${name}] Failed to list prompts during wake`, {
            error: summarizeErrorForLogging(error),
          });
        }
      }
      if (capabilities?.resources) {
        void refreshServerResourceTemplatesCache(() => serverInfo, client, requestOptions);
        try {
          const resources = await client.listResources({}, requestOptions);
          if (stale()) return;
          resourceCount = resources.resources.length;
          updateServerResourcesCache(serverInfo, resources.resources);
        } catch (error) {
          logger.warn(`[${name}] Failed to list resources during wake`, {
            error: summarizeErrorForLogging(error),
          });
        }
      }

      // No-op for stdio transports; only SSE/streamable-http opt in via enableKeepAlive.
      setupServerKeepAlive(serverInfo, expandedConf);

      logger.log(
        `[${name}] On-demand server ready in ${Date.now() - spawnStart}ms` +
          ` (${toolCount} tools, ${promptCount} prompts, ${resourceCount} resources)`,
      );
    })();

    serverInfo.spawningPromise = spawnPromise;
    try {
      await spawnPromise;
    } catch (error) {
      // A failed spawn from a superseded generation must not overwrite the error
      // state of the runtime that replaced it, and must not leave its own child
      // or client behind.
      if (stale()) {
        closeSpawnRuntime(serverInfo.name, spawnClient, spawnTransport);
      } else {
        serverInfo.status = 'disconnected';
        serverInfo.error = `Failed to start on-demand server: ${formatErrorForLogging(error)}`;
      }
      throw error;
    } finally {
      // Only clear our own promise: a reconnect (or a newer spawn) may already
      // own the slot, and clearing it would let the next caller start a second
      // child while that one is still connecting.
      if (serverInfo.spawningPromise === spawnPromise) {
        serverInfo.spawningPromise = undefined;
      }
    }
  };

  return { beginOnDemandToolCall, ensureServerReady, shutdownOnDemandServer };
};
