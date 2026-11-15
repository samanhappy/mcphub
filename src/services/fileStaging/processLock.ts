import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { StagingError } from './types.js';

/**
 * One staging writer per process and state directory (#1056).
 *
 * Content lives on local disk even in DB mode, so two hub processes sharing a
 * ledger would interleave leases and serve each other's missing files. The
 * lockfile records `pid:instanceId` for diagnostics only: both hub containers
 * run node as PID 1, so a pid says nothing about which process holds the lock.
 * The owner refreshes the file's mtime while alive and a lock is taken over
 * only once that heartbeat is stale.
 */

/** How often the owner refreshes the lockfile mtime. */
export const STAGING_LOCK_HEARTBEAT_INTERVAL_MS = 30_000;
/** A lockfile older than this is stale and may be taken over. */
export const STAGING_LOCK_STALE_MS = 120_000;

const acquiredStateDirs = new Set<string>();
/** Live handles, so a shutdown can hand the lock back without a stale window. */
const heldLocks = new Map<string, { instanceId: string; release: () => Promise<void> }>();

const lockOwnerInstance = async (stateDir: string): Promise<string | undefined> => {
  const raw = await fs.readFile(stagingLockPath(stateDir), 'utf8').catch(() => '');
  const [, instanceId] = raw.trim().split(':');
  return instanceId || undefined;
};

/**
 * Remove the lockfile only when this instance still owns it.
 *
 * An unreadable or empty lockfile is *not* treated as ours: `acquire` creates
 * the file and writes the owner in a second syscall, so a stalled owner's
 * release could otherwise delete the lock a newer owner had just created.
 */
const releaseLockIfOwned = async (stateDir: string, instanceId: string): Promise<void> => {
  const owner = await lockOwnerInstance(stateDir);
  if (owner !== instanceId) return;
  await fs.rm(stagingLockPath(stateDir), { force: true }).catch(() => undefined);
};

export const stagingLockPath = (stateDir: string): string => path.join(stateDir, 'staging.lock');

const isStale = async (lockPath: string, now: number): Promise<boolean> => {
  const stat = await fs.stat(lockPath).catch(() => undefined);
  return stat !== undefined && now - stat.mtimeMs > STAGING_LOCK_STALE_MS;
};

export const acquireStagingProcessLock = async (
  stateDir: string,
): Promise<() => Promise<void>> => {
  const lockPath = stagingLockPath(stateDir);
  // One writer per process even when two stores are constructed: a second
  // store would share the heartbeat and silently take the lock over.
  if (acquiredStateDirs.has(stateDir)) {
    throw new StagingError(
      'locked',
      'File staging is already initialized in this process for the same state directory',
    );
  }
  const instanceId = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // One syscall creates and writes the owner; a concurrent reader never
      // sees an empty lockfile.
      const handle = await fs.open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${process.pid}:${instanceId}`);
      } finally {
        await handle.close();
      }
      acquiredStateDirs.add(stateDir);
      const heartbeat = setInterval(() => {
        // Refresh only while we still own the file: a stalled initialization
        // that lost the lock must not keep another owner's mtime fresh, nor
        // delete its file on release.
        void lockOwnerInstance(stateDir)
          .then((owner) => {
            if (owner !== instanceId) return;
            const now = new Date();
            return fs.utimes(lockPath, now, now);
          })
          .catch(() => undefined);
      }, STAGING_LOCK_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
      // A failed initialization must hand the lock back: the retry path in
      // settings.ts would otherwise stay blocked until a hub restart.
      const release = async () => {
        clearInterval(heartbeat);
        acquiredStateDirs.delete(stateDir);
        heldLocks.delete(stateDir);
        await releaseLockIfOwned(stateDir, instanceId);
      };
      heldLocks.set(stateDir, { instanceId, release });
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const raw = await fs.readFile(lockPath, 'utf8').catch(() => '');
      const [pidRaw] = raw.trim().split(':');
      const owner = Number.parseInt(pidRaw, 10);
      if (Number.isFinite(owner)) {
        // Only a stale heartbeat allows takeover; a live owner in another
        // container may well share our pid.
        if (await isStale(lockPath, Date.now())) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
        throw new StagingError(
          'locked',
          `File staging is already owned by hub process ${owner}; only one process may run staging`,
        );
      }
      // A truncated/empty lockfile is treated as held: deleting it could hand
      // the ledger to a second live writer.
      throw new StagingError(
        'locked',
        'The file staging lockfile is unreadable; remove it only after confirming no hub process is running',
      );
    }
  }
  throw new StagingError('locked', 'Unable to acquire the file staging process lock');
};

/**
 * Hand every lock this process holds back to the next instance. Called from the
 * shutdown path so a restart does not have to wait out the staleness window.
 */
export const releaseAllStagingProcessLocks = async (): Promise<void> => {
  for (const [, held] of heldLocks) {
    await held.release().catch(() => undefined);
  }
};

/** Test seam: forget that this process owns the lock for a state directory. */
export const releaseStagingProcessLockForTests = (stateDir: string): void => {
  acquiredStateDirs.delete(stateDir);
};
