import { Request, Response } from 'express';
import { ApiResponse, Tool } from '../types/index.js';
import { getSmartRoutingConfig, type SmartRoutingConfig } from '../utils/smartRouting.js';
import { hasCredentialTemplate } from '../utils/credentialTemplate.js';
import { logger } from '../utils/logger.js';
import { getCredentialBindingDao, getUserDao } from '../dao/DaoFactory.js';
import {
  getAppDataSource,
  getDatabaseHealth,
  initializeDatabase,
  isDatabaseConnected,
} from '../db/connection.js';
import { saveToolsAsVectorEmbeddings } from '../services/vectorSearchService.js';
import { getServerToolsForPrincipal, getServersInfo } from '../services/mcpService.js';

/**
 * Resolve the effective embedding model that the vector store is (or will be)
 * persisted with. Mirrors the resolution in vectorSearchService.saveToolsAsVectorEmbeddings
 * so the reported model matches what is actually written to vector_embeddings.
 */
const resolvePersistedEmbeddingModel = (
  config: SmartRoutingConfig,
): string | null => {
  const provider = config.embeddingProvider || 'openai';
  if (provider === 'azure_openai') {
    return config.azureOpenaiEmbeddingModel?.trim() || 'text-embedding-3-small';
  }
  return config.embeddingModel?.trim() || null;
};

/**
 * Read aggregate statistics from the vector_embeddings table.
 * Returns null when the query fails so callers can degrade gracefully instead
 * of returning a 500 for a purely informational endpoint.
 */
const queryVectorStoreStats = async (): Promise<{
  totalRows: number;
  toolRows: number;
  serverRows: number;
  distinctServers: number;
  dimensions: number | null;
  byModel: Array<{ model: string; toolCount: number; serverCount: number }>;
  byServer: Array<{ serverName: string; toolCount: number }>;
  oldestUpdatedAt: string | null;
  newestUpdatedAt: string | null;
} | null> => {
  try {
    const dataSource = getAppDataSource();

    const [overview, byModel, byServer, freshness, dims] = await Promise.all([
      dataSource.query(
        `SELECT
           count(*) FILTER (WHERE content_type = 'tool')  AS tool_rows,
           count(*) FILTER (WHERE content_type = 'server') AS server_rows,
           count(*)                                       AS total_rows,
           count(DISTINCT metadata::jsonb->>'serverName') AS distinct_servers
         FROM vector_embeddings`,
      ),
      dataSource.query(
        `SELECT model,
                count(*) FILTER (WHERE content_type = 'tool')  AS tool_count,
                count(*) FILTER (WHERE content_type = 'server') AS server_count
         FROM vector_embeddings
         GROUP BY model
         ORDER BY model`,
      ),
      dataSource.query(
        `SELECT metadata::jsonb->>'serverName' AS server_name, count(*) AS tool_count
         FROM vector_embeddings
         WHERE content_type = 'tool'
         GROUP BY 1
         ORDER BY tool_count DESC
         LIMIT 500`,
      ),
      dataSource.query(
        `SELECT to_char(min(updated_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS oldest,
                to_char(max(updated_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS newest
         FROM vector_embeddings`,
      ),
      dataSource.query(
        `SELECT atttypmod AS dimensions
         FROM pg_attribute
         WHERE attrelid = 'vector_embeddings'::regclass
           AND attname = 'embedding'`,
      ),
    ]);

    const rawDimensions = dims?.[0]?.dimensions;
    const dimValue = Number(rawDimensions);
    const dimensions =
      rawDimensions !== undefined && rawDimensions !== null && Number.isFinite(dimValue)
        ? dimValue
        : null;

    return {
      totalRows: Number(overview?.[0]?.total_rows ?? 0),
      toolRows: Number(overview?.[0]?.tool_rows ?? 0),
      serverRows: Number(overview?.[0]?.server_rows ?? 0),
      distinctServers: Number(overview?.[0]?.distinct_servers ?? 0),
      dimensions,
      byModel: (byModel ?? []).map((row: any) => ({
        model: String(row.model ?? ''),
        toolCount: Number(row.tool_count ?? 0),
        serverCount: Number(row.server_count ?? 0),
      })),
      byServer: (byServer ?? []).map((row: any) => ({
        serverName: String(row.server_name ?? ''),
        toolCount: Number(row.tool_count ?? 0),
      })),
      oldestUpdatedAt: freshness?.[0]?.oldest ?? null,
      newestUpdatedAt: freshness?.[0]?.newest ?? null,
    };
  } catch (error) {
    logger.warn('Failed to collect vector store statistics:', error);
    return null;
  }
};

/**
 * GET /api/smart-routing/performance
 *
 * Returns a read-only snapshot of smart routing health and the vector store:
 * resolved embedding configuration, database connection state, row counts,
 * per-model/per-server breakdown, and sync freshness.
 */
export const getSmartRoutingPerformance = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const smartRoutingConfig = await getSmartRoutingConfig();
    const databaseHealth = getDatabaseHealth();

    // Only reach into the database when smart routing is enabled and a DB URL
    // is configured; otherwise report the disabled/unconfigured state as-is.
    const dbAvailable =
      smartRoutingConfig.enabled &&
      Boolean(smartRoutingConfig.dbUrl || process.env.DB_URL);

    let vectorStore: Awaited<ReturnType<typeof queryVectorStoreStats>> = null;
    if (dbAvailable) {
      if (!isDatabaseConnected()) {
        try {
          await initializeDatabase();
        } catch (error) {
          logger.warn('Failed to initialize database for performance stats:', error);
        }
      }
      if (isDatabaseConnected()) {
        vectorStore = await queryVectorStoreStats();
      }
    }

    // Coverage is measured against every enabled server, not only the ones this
    // principal happens to see connected: servers that require personal
    // credentials are never connected globally, so a "connected" baseline would
    // silently hide them from the index report.
    let enabledServerNames: string[] = [];
    let connectedServers = 0;
    let personalCredentialServers = 0;
    try {
      const servers = await getServersInfo();
      const enabled = servers.filter((server) => server.enabled !== false);
      enabledServerNames = enabled.map((server) => server.name);
      connectedServers = enabled.filter((server) => server.status === 'connected').length;
      personalCredentialServers = enabled.filter((server) =>
        hasCredentialTemplate(server.config),
      ).length;
    } catch (error) {
      logger.warn('Failed to resolve servers for performance stats:', error);
    }

    const indexedServerSet = new Set(
      (vectorStore?.byServer ?? []).map((entry) => entry.serverName),
    );
    const missingIndexServers = enabledServerNames.filter(
      (name) => !indexedServerSet.has(name),
    );

    const provider = smartRoutingConfig.embeddingProvider || 'openai';
    const data = {
      enabled: smartRoutingConfig.enabled,
      config: {
        provider,
        model: resolvePersistedEmbeddingModel(smartRoutingConfig),
        configuredDimensions:
          typeof smartRoutingConfig.embeddingDimensions === 'number'
            ? smartRoutingConfig.embeddingDimensions
            : null,
      },
      database: {
        connected: databaseHealth.connected,
        healthy: databaseHealth.healthy,
        lastError: databaseHealth.lastError,
      },
      vectorStore: {
        available: vectorStore !== null,
        ...(vectorStore ?? {
          totalRows: 0,
          toolRows: 0,
          serverRows: 0,
          distinctServers: 0,
          dimensions: null,
          byModel: [],
          byServer: [],
          oldestUpdatedAt: null,
          newestUpdatedAt: null,
        }),
      },
      coverage: {
        totalServers: enabledServerNames.length,
        connectedServers,
        personalCredentialServers,
        indexedServers: indexedServerSet.size,
        missingIndexServerCount: missingIndexServers.length,
        missingIndexServers: missingIndexServers.slice(0, 100),
      },
    };

    const response: ApiResponse = { success: true, data };
    res.json(response);
  } catch (error) {
    logger.error('Failed to collect smart routing performance stats:', error);
    res.status(500).json({ success: false, message: 'Failed to collect smart routing performance stats' });
  }
};

/**
 * Usernames holding a personal credential binding for a server, ordered with
 * the server owner first so indexing favours the account that defines it.
 */
const listBindingUsernames = async (
  serverName: string,
  owner?: string,
): Promise<string[]> => {
  try {
    const usernames = await getCredentialBindingDao().listUsernames(serverName);
    const unique = [
      ...new Set(usernames.filter((name) => typeof name === 'string' && name.trim().length > 0)),
    ];
    unique.sort((a, b) => {
      if (a === owner) return -1;
      if (b === owner) return 1;
      return a.localeCompare(b);
    });
    return unique;
  } catch (error) {
    logger.warn(`Failed to list credential bindings for server "${serverName}":`, error);
    return [];
  }
};

/**
 * Collect the union of tools that the binding principals can see for a server.
 * Principals are resolved sequentially because each one may spawn its own
 * upstream connection; a reindex pass should not fan out across all of them.
 */
const collectToolsForPrincipals = async (
  serverName: string,
  usernames: string[],
): Promise<{ tools: Tool[]; principals: string[]; errors: string[] }> => {
  const merged = new Map<string, Tool>();
  const principals: string[] = [];
  const errors: string[] = [];

  for (const username of usernames) {
    try {
      const user = await getUserDao().findByUsername(username);
      if (!user) {
        errors.push(`${username}: user not found`);
        continue;
      }
      const tools = await getServerToolsForPrincipal(serverName, {
        username,
        isAdmin: Boolean(user.isAdmin),
        credentialEligible: true,
      });
      for (const tool of tools) {
        if (tool?.name && !merged.has(tool.name)) {
          merged.set(tool.name, tool);
        }
      }
      principals.push(username);
    } catch (error: any) {
      errors.push(
        `${username}: ${error?.message ? String(error.message) : 'unknown error'}`,
      );
    }
  }

  return { tools: [...merged.values()], principals, errors };
};

/**
 * POST /api/smart-routing/reindex
 *
 * Force a full rebuild of all vector embeddings: every row in
 * vector_embeddings is cleared, then every enabled server is re-embedded.
 *
 * Servers that declare a personal credential template are never connected
 * globally — their runtime only exists for principals that bound their own
 * credentials. Those servers are therefore indexed on behalf of the users who
 * hold a binding (the server owner first), and the union of the tools those
 * principals can see is what gets embedded. A server with no binding at all is
 * reported as skipped instead of being silently dropped from the index.
 *
 * Progress is streamed to authenticated clients through the existing
 * embedding-sync-progress SSE events emitted by saveToolsAsVectorEmbeddings.
 * Response is sent only when the whole pass finishes (synchronous execution).
 */
export const reindexSmartRouting = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const smartRoutingConfig = await getSmartRoutingConfig();

    if (!smartRoutingConfig.enabled) {
      res.status(400).json({ success: false, message: 'Smart routing is not enabled' });
      return;
    }
    if (!smartRoutingConfig.dbUrl && !process.env.DB_URL) {
      res.status(400).json({ success: false, message: 'Database (DB_URL) is not configured' });
      return;
    }

    if (!isDatabaseConnected()) {
      await initializeDatabase();
    }

    // 1. Clear the existing index so every tool is regenerated from scratch.
    logger.log('Reindex: clearing all vector embeddings');
    await getAppDataSource().query('DELETE FROM vector_embeddings');

    // 2. Re-embed every enabled server.
    const servers = await getServersInfo();

    const results: Array<{
      serverName: string;
      toolCount: number;
      ok: boolean;
      skipped?: boolean;
      error?: string;
      principals?: string[];
    }> = [];
    let totalTools = 0;
    let syncedServers = 0;
    let failedServers = 0;
    let skippedServers = 0;

    for (const server of servers) {
      if (server.enabled === false) {
        continue;
      }

      let tools: Tool[];
      let principals: string[] | undefined;

      if (hasCredentialTemplate(server.config)) {
        // Personal-credential server: borrow the principals that can reach it.
        const usernames = await listBindingUsernames(server.name, server.config?.owner);
        if (usernames.length === 0) {
          skippedServers += 1;
          results.push({
            serverName: server.name,
            toolCount: 0,
            ok: false,
            skipped: true,
            error: 'No user has bound personal credentials for this server',
          });
          continue;
        }

        const collected = await collectToolsForPrincipals(server.name, usernames);
        principals = collected.principals;
        tools = collected.tools;
        if (tools.length === 0) {
          failedServers += 1;
          results.push({
            serverName: server.name,
            toolCount: 0,
            ok: false,
            principals,
            error:
              collected.errors.join('; ') ||
              'No tools could be resolved with the bound personal credentials',
          });
          continue;
        }
      } else {
        if (server.status !== 'connected') {
          skippedServers += 1;
          results.push({
            serverName: server.name,
            toolCount: 0,
            ok: false,
            skipped: true,
            error: `Server is not connected (status: ${server.status ?? 'unknown'})`,
          });
          continue;
        }
        tools = server.tools ?? [];
        if (tools.length === 0) {
          skippedServers += 1;
          results.push({
            serverName: server.name,
            toolCount: 0,
            ok: false,
            skipped: true,
            error: 'Server exposes no tools',
          });
          continue;
        }
      }

      try {
        await saveToolsAsVectorEmbeddings(server.name, tools, { reportProgress: true });
        syncedServers += 1;
        totalTools += tools.length;
        results.push({
          serverName: server.name,
          toolCount: tools.length,
          ok: true,
          ...(principals ? { principals } : {}),
        });
      } catch (error: any) {
        failedServers += 1;
        logger.error(`Reindex failed for server "${server.name}":`, error);
        results.push({
          serverName: server.name,
          toolCount: tools.length,
          ok: false,
          ...(principals ? { principals } : {}),
          error: error?.message ? String(error.message) : 'Unknown error',
        });
      }
    }

    const data = {
      syncedServers,
      failedServers,
      skippedServers,
      totalTools,
      results,
    };
    logger.log('Reindex completed', { syncedServers, failedServers, skippedServers, totalTools });

    const response: ApiResponse = { success: true, data };
    res.json(response);
  } catch (error) {
    logger.error('Failed to rebuild smart routing index:', error);
    res.status(500).json({ success: false, message: 'Failed to rebuild smart routing index' });
  }
};
