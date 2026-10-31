import os from 'node:os';
import { getAppDataSource } from '../db/connection.js';
import { databaseTransaction } from '../db/transactionContext.js';
import { getServerDao, getSystemConfigDao } from '../dao/DaoFactory.js';
import { getCachedSystemConfig, setCachedSystemConfig } from '../utils/systemConfigCache.js';
import { isReplicaMode } from '../utils/replicaMode.js';
import { logger } from '../utils/logger.js';
import { initOAuthServer } from './oauthServerService.js';

let desiredVersion: string | null = null;
let appliedVersion: string | null = null;
let lastError: string | null = null;
let timer: NodeJS.Timeout | undefined;
let refresh: Promise<void> | undefined;
let apply: typeof import('./mcpService.js').reconcileReplicaServers;
let accepting = false;
let configurationDirty = false;
let appliedOAuthConfiguration: string | undefined;

export const markReplicaConfigurationDirty = (): void => {
  configurationDirty = true;
};

export const replicaStatus = () => ({
  nodeId: process.env.MCPHUB_NODE_ID || os.hostname(),
  desiredVersion,
  appliedVersion,
  lastError,
  accepting,
  configurationDirty,
});

export const getConfigurationVersion = async (): Promise<string> => {
  const rows = await getAppDataSource().query(
    'SELECT version::text FROM mcphub_revision WHERE id = 1',
  );
  if (!rows.length)
    throw new Error('Replica schema missing; run db:setup before starting replicas');
  return rows[0].version;
};

export const refreshReplicaConfiguration = (): Promise<void> => {
  if (refresh) return refresh;
  refresh = (async () => {
    const runner = getAppDataSource().createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction('REPEATABLE READ');
      const snapshot = await databaseTransaction.run(runner, async () => {
        const version = await getConfigurationVersion();
        desiredVersion = version;
        if (version === appliedVersion && !configurationDirty) return undefined;
        configurationDirty = false;
        const servers = await getServerDao().findAll();
        const systemConfig = await getSystemConfigDao().get();
        return { version, servers, systemConfig };
      });
      await runner.commitTransaction();
      await runner.release();
      if (snapshot) {
        const previous = getCachedSystemConfig();
        setCachedSystemConfig(snapshot.systemConfig);
        try {
          await apply(snapshot.servers);
          const oauthConfiguration = JSON.stringify(snapshot.systemConfig?.oauthServer);
          if (oauthConfiguration !== appliedOAuthConfiguration) {
            await initOAuthServer(snapshot.systemConfig);
            appliedOAuthConfiguration = oauthConfiguration;
          }
        } catch (error) {
          setCachedSystemConfig(previous);
          throw error;
        }
        appliedVersion = snapshot.version;
        logger.info('Replica configuration applied', replicaStatus());
      }
      lastError = null;
    } catch (error) {
      configurationDirty = true;
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      lastError = error instanceof Error ? error.message : String(error);
      logger.error('Replica configuration refresh failed', { ...replicaStatus(), error });
      throw error;
    } finally {
      if (!runner.isReleased) await runner.release();
    }
  })().finally(() => {
    refresh = undefined;
  });
  return refresh;
};

export const startReplicaSync = async (
  reconcile: typeof import('./mcpService.js').reconcileReplicaServers,
): Promise<void> => {
  if (!isReplicaMode()) {
    accepting = true;
    return;
  }
  apply = reconcile;
  await refreshReplicaConfiguration();
  accepting = true;
  timer = setInterval(() => {
    void refreshReplicaConfiguration().catch(() => undefined);
  }, 5000);
  timer.unref();
};

export const stopReplicaSync = async (): Promise<void> => {
  accepting = false;
  clearInterval(timer);
  if (refresh) await refresh.catch(() => undefined);
};
