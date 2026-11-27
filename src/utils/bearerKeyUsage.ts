import { getBearerKeyDao } from '../dao/index.js';
import { logger } from './logger.js';

export const BEARER_KEY_LAST_USED_THROTTLE_MS = 60_000;
const MAX_THROTTLE_CACHE_SIZE = 10_000;

const lastRecordedByKeyId = new Map<string, number>();

const pruneThrottleCache = (nowMs: number): void => {
  if (lastRecordedByKeyId.size <= MAX_THROTTLE_CACHE_SIZE) {
    return;
  }
  for (const [keyId, recordedMs] of lastRecordedByKeyId) {
    if (nowMs - recordedMs >= BEARER_KEY_LAST_USED_THROTTLE_MS) {
      lastRecordedByKeyId.delete(keyId);
    }
  }
};

/**
 * Reset in-memory throttle state (intended for tests).
 */
export const resetBearerKeyUsageThrottle = (): void => {
  lastRecordedByKeyId.clear();
};

/**
 * Best-effort, 1-minute-throttled recording of bearer key usage.
 * Must be called only after authentication and scope checks succeed.
 */
export const recordBearerKeyUsage = async (
  keyId: string,
  now: Date = new Date(),
): Promise<void> => {
  if (!keyId) {
    return;
  }

  const nowMs = now.getTime();
  const previousMs = lastRecordedByKeyId.get(keyId);
  if (previousMs !== undefined && nowMs - previousMs < BEARER_KEY_LAST_USED_THROTTLE_MS) {
    return;
  }

  const dao = getBearerKeyDao();
  if (typeof dao.recordLastUsed !== 'function') {
    return;
  }

  pruneThrottleCache(nowMs);
  // Reserve the throttle slot before awaiting so concurrent requests do not stampede writes.
  lastRecordedByKeyId.set(keyId, nowMs);

  try {
    await dao.recordLastUsed(keyId, now);
  } catch (error) {
    // Restore previous throttle entry so a transient failure can retry on the next request.
    if (previousMs === undefined) {
      lastRecordedByKeyId.delete(keyId);
    } else {
      lastRecordedByKeyId.set(keyId, previousMs);
    }
    logger.warn(`Failed to record lastUsedAt for bearer key id=${keyId}:`, error);
  }
};
