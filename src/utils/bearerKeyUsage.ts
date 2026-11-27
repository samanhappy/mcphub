import { getBearerKeyDao } from '../dao/index.js';
import { logger } from './logger.js';

export const BEARER_KEY_LAST_USED_THROTTLE_MS = 60_000;
export const BEARER_KEY_LAST_USED_FAILURE_BACKOFF_MS = 15_000;
const MAX_THROTTLE_CACHE_SIZE = 10_000;

const lastRecordedByKeyId = new Map<string, number>();
const failureBackoffUntilByKeyId = new Map<string, number>();
const pendingWrites = new Set<Promise<void>>();

const pruneThrottleCache = (nowMs: number): void => {
  if (lastRecordedByKeyId.size > MAX_THROTTLE_CACHE_SIZE) {
    for (const [keyId, recordedMs] of lastRecordedByKeyId) {
      if (nowMs - recordedMs >= BEARER_KEY_LAST_USED_THROTTLE_MS) {
        lastRecordedByKeyId.delete(keyId);
      }
    }
  }
  if (failureBackoffUntilByKeyId.size > MAX_THROTTLE_CACHE_SIZE) {
    for (const [keyId, untilMs] of failureBackoffUntilByKeyId) {
      if (nowMs >= untilMs) {
        failureBackoffUntilByKeyId.delete(keyId);
      }
    }
  }
};

/**
 * Reset in-memory throttle and failure backoff state (intended for tests).
 */
export const resetBearerKeyUsageThrottle = (): void => {
  lastRecordedByKeyId.clear();
  failureBackoffUntilByKeyId.clear();
};

/**
 * Wait for any scheduled background usage writes to settle (intended for tests).
 */
export const flushPendingBearerKeyUsage = async (): Promise<void> => {
  while (pendingWrites.size > 0) {
    await Promise.allSettled([...pendingWrites]);
  }
};

/**
 * Best-effort, 1-minute-throttled recording of bearer key usage with bounded failure backoff.
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

  const backoffUntil = failureBackoffUntilByKeyId.get(keyId);
  if (backoffUntil !== undefined && nowMs < backoffUntil) {
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
    failureBackoffUntilByKeyId.delete(keyId);
  } catch (error) {
    // Restore previous success slot and enforce a bounded failure backoff window
    // so transient storage outages do not amplify failed writes under load.
    if (previousMs === undefined) {
      lastRecordedByKeyId.delete(keyId);
    } else {
      lastRecordedByKeyId.set(keyId, previousMs);
    }
    failureBackoffUntilByKeyId.set(keyId, nowMs + BEARER_KEY_LAST_USED_FAILURE_BACKOFF_MS);
    logger.warn(`Failed to record lastUsedAt for bearer key id=${keyId}:`, error);
  }
};

/**
 * Non-blocking, best-effort scheduler for recording bearer key usage off the auth critical path.
 * Never throws or produces an unhandled rejection.
 */
export const scheduleBearerKeyUsage = (keyId: string, now: Date = new Date()): void => {
  const task = recordBearerKeyUsage(keyId, now).finally(() => {
    pendingWrites.delete(task);
  });
  pendingWrites.add(task);
};
