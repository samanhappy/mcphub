import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { StagingError } from './types.js';

/**
 * One staging writer per process and state directory (#1056).
 *
 * Content lives on local disk even in DB mode, so two hub processes sharing a
 * ledger would interleave leases and serve each other's missing files. The
 * lockfile records `pid:instanceId`; a same-pid lock can only be a previous
 * instance of this process (the default container runs node as PID 1, so a
 * restart reuses the pid) and is taken over.
 */

const acquiredStateDirs = new Set<string>();

const isLivePid = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const stagingLockPath = (stateDir: string): string => path.join(stateDir, 'staging.lock');

export const acquireStagingProcessLock = async (stateDir: string): Promise<void> => {
  const lockPath = stagingLockPath(stateDir);
  // One writer per process even when two stores are constructed: a second
  // store would otherwise share the pid and silently take the lock over.
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
      await fs.writeFile(lockPath, `${process.pid}:${instanceId}`, { flag: 'wx', mode: 0o600 });
      acquiredStateDirs.add(stateDir);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const raw = await fs.readFile(lockPath, 'utf8').catch(() => '');
      const [pidRaw] = raw.trim().split(':');
      const owner = Number.parseInt(pidRaw, 10);
      // A same-pid lock can only belong to a previous instance of this process:
      // our own store is blocked earlier by acquiredStateDirs.
      if (Number.isFinite(owner) && owner === process.pid) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      if (Number.isFinite(owner) && isLivePid(owner)) {
        throw new StagingError(
          'locked',
          `File staging is already owned by hub process ${owner}; only one process may run staging`,
        );
      }
      if (!Number.isFinite(owner)) {
        // A truncated/empty lockfile is treated as held: deleting it could
        // hand the ledger to a second live writer.
        throw new StagingError(
          'locked',
          'The file staging lockfile is unreadable; remove it only after confirming no hub process is running',
        );
      }
      await fs.rm(lockPath, { force: true });
    }
  }
  throw new StagingError('locked', 'Unable to acquire the file staging process lock');
};

/** Test seam: forget that this process owns the lock for a state directory. */
export const releaseStagingProcessLockForTests = (stateDir: string): void => {
  acquiredStateDirs.delete(stateDir);
};
