import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  STAGING_LOCK_HEARTBEAT_INTERVAL_MS,
  STAGING_LOCK_STALE_MS,
  acquireStagingProcessLock,
  releaseStagingProcessLockForTests,
  stagingLockPath,
} from '../processLock.js';

const ageLock = async (lockPath: string, ms: number): Promise<void> => {
  const old = new Date(Date.now() - ms);
  await fs.utimes(lockPath, old, old);
};

describe('staging process lock', () => {
  let stateDir: string;
  let lockPath: string;
  const acquired: string[] = [];

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-lock-'));
    lockPath = stagingLockPath(stateDir);
  });

  afterEach(async () => {
    for (const dir of acquired.splice(0)) releaseStagingProcessLockForTests(dir);
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it('exposes a heartbeat shorter than the staleness window', () => {
    expect(STAGING_LOCK_HEARTBEAT_INTERVAL_MS).toBe(30_000);
    expect(STAGING_LOCK_STALE_MS).toBe(120_000);
    expect(STAGING_LOCK_HEARTBEAT_INTERVAL_MS * 2).toBeLessThan(STAGING_LOCK_STALE_MS);
  });

  it('writes pid:instanceId and refuses to take over a fresh lock owned by the same pid', async () => {
    // Both hub containers run node as PID 1, so a fresh lock with our own pid
    // is a live peer, not a previous instance of this process.
    await fs.writeFile(lockPath, `${process.pid}:other-container`);
    await expect(acquireStagingProcessLock(stateDir)).rejects.toMatchObject({
      code: 'locked',
    });
    await expect(fs.readFile(lockPath, 'utf8')).resolves.toBe(`${process.pid}:other-container`);
  });

  it('takes over a stale lock', async () => {
    const owner = `${process.pid}:crashed`;
    await fs.writeFile(lockPath, owner);
    await ageLock(lockPath, STAGING_LOCK_STALE_MS + 60_000);

    const release = await acquireStagingProcessLock(stateDir);
    acquired.push(stateDir);
    const content = await fs.readFile(lockPath, 'utf8');
    expect(content).toMatch(new RegExp(`^${process.pid}:[0-9a-f-]{36}$`));
    expect(content).not.toBe(owner);

    // The new owner refreshed the mtime, so it is not stale anymore.
    const stat = await fs.stat(lockPath);
    expect(Date.now() - stat.mtimeMs).toBeLessThan(STAGING_LOCK_HEARTBEAT_INTERVAL_MS);
    await release();
  });

  it('keeps a lock whose heartbeat is younger than the staleness window', async () => {
    await fs.writeFile(lockPath, '1:alive');
    await ageLock(lockPath, STAGING_LOCK_STALE_MS - 60_000);
    await expect(acquireStagingProcessLock(stateDir)).rejects.toMatchObject({
      code: 'locked',
    });
  });

  it('refreshes the lockfile mtime while the owner is alive', async () => {
    jest.useFakeTimers();
    try {
      const release = await acquireStagingProcessLock(stateDir);
      acquired.push(stateDir);
      const created = (await fs.stat(lockPath)).mtimeMs;
      await ageLock(lockPath, STAGING_LOCK_STALE_MS + 60_000);
      jest.advanceTimersByTime(STAGING_LOCK_HEARTBEAT_INTERVAL_MS);
      // The heartbeat reads the owner before touching the mtime, so the file
      // I/O resolves a few microtasks after the timer fires.
      for (let attempt = 0; attempt < 20; attempt++) {
        await jest.advanceTimersByTimeAsync(1);
        if ((await fs.stat(lockPath)).mtimeMs > created) break;
      }
      const refreshed = (await fs.stat(lockPath)).mtimeMs;
      expect(refreshed).toBeGreaterThan(created);
      expect(Date.now() - refreshed).toBeLessThan(STAGING_LOCK_HEARTBEAT_INTERVAL_MS);
      // Stop the heartbeat before releasing so no timer outlives the test.
      jest.clearAllTimers();
      await release();
    } finally {
      jest.useRealTimers();
    }
  });

  it('release removes the file and the in-process guard', async () => {
    const release = await acquireStagingProcessLock(stateDir);
    await expect(fs.stat(lockPath)).resolves.toBeDefined();
    await release();
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });

    // The guard is gone: the same state dir can be acquired again in-process.
    const again = await acquireStagingProcessLock(stateDir);
    acquired.push(stateDir);
    await again();
  });

  it('refuses a second acquisition in the same process', async () => {
    const release = await acquireStagingProcessLock(stateDir);
    acquired.push(stateDir);
    await expect(acquireStagingProcessLock(stateDir)).rejects.toMatchObject({
      code: 'locked',
    });
    await release();
  });

  it('fails closed on an empty lockfile', async () => {
    await fs.writeFile(lockPath, '');
    await expect(acquireStagingProcessLock(stateDir)).rejects.toMatchObject({
      code: 'locked',
    });
    await expect(fs.readFile(lockPath, 'utf8')).resolves.toBe('');
  });
});
