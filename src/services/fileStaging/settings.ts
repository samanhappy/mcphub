import type { FileStagingSettings } from '../../types/index.js';
import { getSystemConfigDao } from '../../dao/DaoFactory.js';
import { isDatabaseModeEnabled } from '../../utils/systemConfigCache.js';
import { resolveFileStagingSettings } from '../../utils/fileStagingConfig.js';
import { resolveJsonBodyLimit } from '../../utils/bearerAuth.js';

const parseByteLimit = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value.trim());
  if (!match) return undefined;
  const unit = (match[2] ?? 'b').toLowerCase();
  const factor = unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1;
  return Math.floor(Number(match[1]) * factor);
};
import { DbStagingStateStore } from './dbStateStore.js';
import { FileStagingStateStore, type StagingStateStore } from './stateStore.js';

let storePromise: Promise<StagingStateStore> | undefined;

/** Resolve the effective global settings, disabled by default. */
export const getFileStagingSettings = async (): Promise<FileStagingSettings> => {
  try {
    const config = await getSystemConfigDao().get();
    const settings = resolveFileStagingSettings(config?.fileStaging);
    // An inline upload is base64 in the JSON body: it can never exceed what the
    // request parser accepts, even if the operator left the inline ceiling high.
    const bodyLimit = parseByteLimit(resolveJsonBodyLimit(config));
    if (bodyLimit !== undefined) {
      settings.inlineMaxBytes = Math.min(
        settings.inlineMaxBytes,
        Math.max(0, Math.floor(bodyLimit * 0.75) - 4096),
      );
    }
    return settings;
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
