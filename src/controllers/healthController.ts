import { Request, Response } from 'express';
import { getDatabaseHealth, getAppDataSource } from '../db/connection.js';
import { replicaStatus } from '../services/replicaService.js';
import { isReplicaMode } from '../utils/replicaMode.js';
import { withTimeout } from '../utils/withTimeout.js';
import { getServerConnectionStats } from '../services/mcpService.js';
import { logger } from '../utils/logger.js';

const isDatabaseModeEnabled = (): boolean => {
  return process.env.USE_DB !== undefined ? process.env.USE_DB === 'true' : !!process.env.DB_URL;
};

/**
 * Health check endpoint
 * Returns 200 OK when MCPHub core is healthy.
 * Returns 503 Service Unavailable when MCPHub core is unhealthy.
 */
export const healthCheck = (_req: Request, res: Response): void => {
  try {
    const serverStats = getServerConnectionStats();

    if (isDatabaseModeEnabled()) {
      const databaseHealth = getDatabaseHealth();
      if (!databaseHealth.healthy) {
        res.status(503).json({
          status: 'unhealthy',
          message: databaseHealth.lastError || 'Database health check failed',
          servers: serverStats,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    if (serverStats.disconnected === 0) {
      res.status(200).json({
        status: 'healthy',
        message: 'All enabled MCP servers are ready',
        servers: serverStats,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(200).json({
        status: 'degraded',
        message: 'Some enabled MCP servers are not ready',
        servers: serverStats,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      message: 'Internal server error during health check',
      timestamp: new Date().toISOString(),
    });
  }
};

export const livenessCheck = (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'alive' });
};

export const readinessCheck = async (_req: Request, res: Response): Promise<void> => {
  const state = replicaStatus();
  try {
    if (!state.accepting || (isReplicaMode() &&
      (state.appliedVersion === null || state.configurationDirty || state.desiredVersion !== state.appliedVersion || state.lastError))) {
      res.status(503).json({ status: 'not_ready' });
      return;
    }
    if (isDatabaseModeEnabled())
      await withTimeout(getAppDataSource().query('SELECT 1'), 5000, 'Readiness database timeout');
    res.status(200).json({ status: 'ready', nodeId: state.nodeId, appliedVersion: state.appliedVersion });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
};
