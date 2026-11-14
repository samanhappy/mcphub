import type { FileStagingSettings } from '../../types/index.js';
import { getSystemConfigDao } from '../../dao/DaoFactory.js';
import { isDatabaseModeEnabled } from '../../utils/systemConfigCache.js';
import { resolveFileStagingSettings } from '../../utils/fileStagingConfig.js';
import { DbStagingStateStore } from './dbStateStore.js';
import { FileStagingStateStore, type StagingStateStore } from './stateStore.js';

let storePromise: Promise<StagingStateStore> | undefined;

/** Resolve the effective global settings, disabled by default. */
export const getFileStagingSettings = async (): Promise<FileStagingSettings> => {
  try {
    const config = await getSystemConfigDao().get();
    return resolveFileStagingSettings(config?.fileStaging);
  } catch {
    // Fail closed: a config read failure must not enable staging.
    return resolveFileStagingSettings(undefined);
  }
};

/**
 * Process-wide ledger. The backend is chosen once: DB mode uses the ledger
 * tables, file mode uses the locked JSON store.
 */
export const getStagingStateStore = (): Promise<StagingStateStore> => {
  if (!storePromise) {
    storePromise = (async () => {
      const store: StagingStateStore = isDatabaseModeEnabled()
        ? new DbStagingStateStore()
        : new FileStagingStateStore();
      await store.init();
      return store;
    })().catch((error) => {
      // Let the next call retry (e.g. DB not ready yet) instead of caching a
      // permanently rejected promise.
      storePromise = undefined;
      throw error;
    });
  }
  return storePromise;
};

/** Test-only seam. */
export const resetStagingStateStoreForTests = (): void => {
  storePromise = undefined;
};
