import { Request, Response } from 'express';
import { ApiResponse } from '../types/index.js';
import { getSmartRoutingConfig, type SmartRoutingConfig } from '../utils/smartRouting.js';
import { logger } from '../utils/logger.js';
import {
  getAppDataSource,
  getDatabaseHealth,
  initializeDatabase,
  isDatabaseConnected,
} from '../db/connection.js';
import { saveToolsAsVectorEmbeddings } from '../services/vectorSearchService.js';
import { getServersInfo } from '../services/mcpService.js';

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

    // Compare connected servers against indexed servers for coverage metrics.
    let connectedServers = 0;
    let connectedServerNames: string[] = [];
    try {
      const servers = await getServersInfo();
      connectedServerNames = servers
        .filter((server) => server.status === 'connected' && server.enabled !== false)
        .map((server) => server.name);
      connectedServers = connectedServerNames.length;
    } catch (error) {
      logger.warn('Failed to resolve connected servers for performance stats:', error);
    }

    const indexedServerSet = new Set(
      (vectorStore?.byServer ?? []).map((entry) => entry.serverName),
    );
    const missingIndexServers = connectedServerNames.filter(
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
        connectedServers,
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
 * POST /api/smart-routing/reindex
 *
 * Force a full rebuild of all vector embeddings: every row in
 * vector_embeddings is cleared, then all connected servers are re-embedded.
 * Progress is streamed to authenticated clients through the existing
 * embedding-sync-progress SSE events emitted by saveToolsAsVectorEmbeddings.
 *
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

    // 2. Re-embed every connected server that exposes tools.
    const servers = await getServersInfo();

    const results: Array<{
      serverName: string;
      toolCount: number;
      ok: boolean;
      error?: string;
    }> = [];
    let totalTools = 0;
    let syncedServers = 0;
    let failedServers = 0;

    for (const server of servers) {
      if (server.status !== 'connected' || server.enabled === false) {
        continue;
      }
      const tools = server.tools ?? [];
      if (tools.length === 0) {
        continue;
      }

      try {
        await saveToolsAsVectorEmbeddings(server.name, tools, { reportProgress: true });
        syncedServers += 1;
        totalTools += tools.length;
        results.push({ serverName: server.name, toolCount: tools.length, ok: true });
      } catch (error: any) {
        failedServers += 1;
        logger.error(`Reindex failed for server "${server.name}":`, error);
        results.push({
          serverName: server.name,
          toolCount: tools.length,
          ok: false,
          error: error?.message ? String(error.message) : 'Unknown error',
        });
      }
    }

    const data = {
      syncedServers,
      failedServers,
      totalTools,
      results,
    };
    logger.log('Reindex completed', { syncedServers, failedServers, totalTools });

    const response: ApiResponse = { success: true, data };
    res.json(response);
  } catch (error) {
    logger.error('Failed to rebuild smart routing index:', error);
    res.status(500).json({ success: false, message: 'Failed to rebuild smart routing index' });
  }
};
