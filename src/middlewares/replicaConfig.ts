import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { getAppDataSource } from '../db/connection.js';
import { databaseTransaction } from '../db/transactionContext.js';
import {
  getConfigurationVersion,
  replicaStatus,
  markReplicaConfigurationDirty,
} from '../services/replicaService.js';
import { isReplicaMode } from '../utils/replicaMode.js';
import { logger } from '../utils/logger.js';
import { replicaLogContext } from '../utils/replicaLogContext.js';

export const replicaRequestContext: RequestHandler = (req, res, next) => {
  if (isReplicaMode()) {
    const requestId = randomUUID();
    const state = replicaStatus();
    res.setHeader('X-MCPHub-Node-Id', state.nodeId);
    res.setHeader('X-Request-Id', requestId);
    if (replicaStatus().appliedVersion !== null)
      res.setHeader('X-MCPHub-Applied-Version', replicaStatus().appliedVersion!);
    // Admission after draining starts is rejected even on an existing keep-alive connection.
    if (!replicaStatus().accepting && !['/livez', '/readyz', '/health'].includes(req.path)) {
      res.status(503).json({ success: false, message: 'Node is not accepting requests' });
      return;
    }
    replicaLogContext.run(
      { nodeId: state.nodeId, requestId, appliedVersion: state.appliedVersion },
      next,
    );
    return;
  }
  next();
};

// Run after authentication. Tool execution and operational endpoints never hold a config transaction.
const isConfigurationPath = (path: string): boolean => {
  if (
    /^\/servers\/[^/]+\/(reload|reinstall|oauth)(\/|$)/.test(path) ||
    path === '/servers/openapi/tool-stats' ||
    path === '/resources/read'
  )
    return false;
  return (
    /^\/(servers|groups|settings|system-config|users|credentials|auth\/keys|oauth\/clients|prompts|resources)(\/|$)/.test(
      path,
    ) || path === '/templates/import'
  );
};

export const replicaConfiguration: RequestHandler = async (req, res, next) => {
  if (!isReplicaMode() || !isConfigurationPath(req.path)) return next();
  res.setHeader('Cache-Control', 'no-store');
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const runner = getAppDataSource().createQueryRunner();
  try {
    const expected = mutation
      ? (req.get('If-Match') ?? `"${await getConfigurationVersion()}"`)
      : undefined;
    await runner.connect();
    await runner.startTransaction(mutation ? 'READ COMMITTED' : 'REPEATABLE READ');
    if (mutation) {
      await runner.query("SET LOCAL lock_timeout = '10s'");
      // Serializes read-modify-write handlers, not tool calls or OAuth refreshes.
      await runner.query('SELECT pg_advisory_xact_lock(209, 0)');
    }
    const version = await databaseTransaction.run(runner, getConfigurationVersion);
    const etag = `"${version}"`;
    res.setHeader('X-MCPHub-Config-Version', version);
    res.setHeader('ETag', etag);
    if (mutation && expected !== etag) {
      await runner.rollbackTransaction();
      await runner.release();
      res
        .status(req.get('If-Match') ? 412 : 409)
        .json({ success: false, message: 'Configuration changed; reload before saving' });
      return;
    }
    const end = res.end.bind(res);
    let ending = false;
    const finish = async (commit: boolean) => {
      if (mutation) markReplicaConfigurationDirty();
      try {
        if (runner.isTransactionActive && commit) await runner.commitTransaction();
      } finally {
        try {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
        } finally {
          if (!runner.isReleased) await runner.release();
        }
      }
    };
    res.once('close', () => {
      if (!ending) {
        ending = true;
        void finish(false).catch((error) => logger.error('Configuration rollback failed', error));
      }
    });
    res.end = ((...args: Parameters<typeof end>) => {
      if (ending) return res;
      ending = true;
      void (async () => {
        try {
          if (mutation && res.statusCode < 400) {
            const committedVersion = await databaseTransaction.run(runner, getConfigurationVersion);
            res.setHeader('X-MCPHub-Config-Version', committedVersion);
            res.setHeader('ETag', `"${committedVersion}"`);
          }
          await finish(res.statusCode < 400);
          end(...args);
        } catch (error) {
          if (!runner.isReleased)
            await finish(false).catch((cleanupError) =>
              logger.error('Configuration rollback failed', cleanupError),
            );
          logger.error('Configuration commit failed', error);
          res.removeHeader('Content-Length');
          res.statusCode = 503;
          end(JSON.stringify({ success: false, message: 'Configuration transaction failed' }));
        }
      })();
      return res;
    }) as typeof res.end;
    databaseTransaction.run(runner, next);
  } catch (error) {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } catch (cleanupError) {
      logger.error('Configuration rollback failed', cleanupError);
    } finally {
      if (!runner.isReleased)
        await runner
          .release()
          .catch((cleanupError) => logger.error('Configuration release failed', cleanupError));
    }
    logger.error('Configuration transaction unavailable', error);
    res.status(503).json({ success: false, message: 'Configuration storage unavailable' });
  }
};
