// A bind failure exits the process, and exiting cancels in-flight work. These
// tests use real child processes to prove that waiting for the upstream
// terminations actually ends them, including one that ignores SIGTERM and can
// only be stopped by the SIGKILL fallback.
import { spawn, type ChildProcess } from 'node:child_process';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Only the OAuth modules are stubbed, and only because they pull an ESM-only
// dependency the Jest runtime cannot load. tree-kill and the process-lister
// probe stay real: the signals in this file are sent to real processes.
jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  registerOAuthClient: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));
import {
  cleanupAllServers,
  drainStdioTerminations,
  resetStdioTerminationsForTest,
  setServerInfosForTest,
} from '../../src/services/mcpService.js';
import { listenOnAddress } from '../../src/utils/listenAddress.js';
import { exitAfterBindFailure } from '../../src/utils/bindFailureExit.js';
import type { ServerInfo } from '../../src/types/index.js';

// Ignores SIGTERM and stays alive, so only SIGKILL can end it. On Windows
// tree-kill uses `taskkill /F`, which ends it at the first signal instead -
// either way the process must be gone once the drain resolves.
const STUBBORN_CHILD = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";

// Exits on SIGTERM like a well-behaved server, so the wait should end as soon
// as it is gone rather than sitting out the grace period.
const COMPLIANT_CHILD = 'setInterval(() => {}, 1000);';

// Deliberately far above anything the kill path needs. These tests check what
// happens, not how fast this host is; the bound itself is measured with fake
// timers in tests/services/mcpService-stdio-cleanup.test.ts.
const GENEROUS_BUDGET_MS = 60_000;

const children: ChildProcess[] = [];

const startStubbornChild = async (): Promise<ChildProcess> => {
  const child = spawn(process.execPath, ['-e', STUBBORN_CHILD], { stdio: 'ignore' });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  return child;
};

const startCompliantChild = async (): Promise<ChildProcess> => {
  const child = spawn(process.execPath, ['-e', COMPLIANT_CHILD], { stdio: 'ignore' });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  return child;
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
};

const stdioServerInfo = (name: string, pid: number): ServerInfo =>
  ({
    name,
    status: 'connected',
    error: null,
    tools: [],
    prompts: [],
    resources: [],
    enabled: true,
    createTime: Date.now(),
    transport: { pid, close: () => undefined },
  }) as unknown as ServerInfo;

// Only POSIX honours "ignore SIGTERM": tree-kill on Windows uses `taskkill /F`,
// which ends the child at the first signal. The cross-platform assertion is
// that the child is gone once the drain resolves.
const itPosix = process.platform === 'win32' ? it.skip : it;

describe('draining stdio terminations before exit', () => {
  afterEach(async () => {
    setServerInfosForTest([]);
    for (const child of children.splice(0)) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await waitForExit(child, 2000);
      }
    }
    await drainStdioTerminations(10_000);
    resetStdioTerminationsForTest();
  });

  it('resolves at once when no termination is pending', async () => {
    await expect(drainStdioTerminations(0)).resolves.toBe(true);
  });

  it('ends a child that ignores SIGTERM once the drain resolves', async () => {
    const child = await startStubbornChild();
    const pid = child.pid!;
    setServerInfosForTest([stdioServerInfo('stubborn-upstream', pid)]);

    cleanupAllServers();
    const settled = await drainStdioTerminations(GENEROUS_BUDGET_MS);

    expect(settled).toBe(true);
    await expect(waitForExit(child, 5000)).resolves.toBe(true);
    expect(isAlive(pid)).toBe(false);
  }, 60_000);

  // The regression itself: cleanupAllServers() only *starts* the termination.
  // Exiting at that moment is what left `npx` descendants running, because the
  // SIGKILL fallback had not fired yet. If this assertion ever fails because
  // the child is already gone, the kill became synchronous and the drain is no
  // longer load-bearing.
  itPosix(
    'leaves a SIGTERM-ignoring child alive until the drain completes',
    async () => {
      const child = await startStubbornChild();
      const pid = child.pid!;
      setServerInfosForTest([stdioServerInfo('orphan-candidate', pid)]);

      cleanupAllServers();

      expect(isAlive(pid)).toBe(true);

      await expect(drainStdioTerminations(GENEROUS_BUDGET_MS)).resolves.toBe(true);
      await expect(waitForExit(child, 5000)).resolves.toBe(true);
      expect(isAlive(pid)).toBe(false);
    },
    30_000,
  );

  // The composed chain, as close to production as a test process can get: a
  // real port is occupied, the real listener reports EADDRINUSE, and the real
  // handler runs with the real cleanup and the real drain. Only process.exit is
  // replaced, because a test process cannot exit.
  it('kills a running upstream before the bind-failure handler exits', async () => {
    const occupier = await new Promise<Server>((resolve, reject) => {
      const server = listenOnAddress(express(), 0, '127.0.0.1', () => resolve(server), reject);
    });
    const { port } = occupier.address() as AddressInfo;

    const child = await startStubbornChild();
    const pid = child.pid!;
    setServerInfosForTest([stdioServerInfo('upstream-at-bind-failure', pid)]);

    // The ordering is the whole point: by the time the handler exits, the
    // upstream process must already be gone. Checked inside the exit itself,
    // rather than by comparing timestamps with the child's exit event, which
    // fires when the process is reaped and can land either side of it.
    let aliveAtExit: boolean | undefined;
    const exit = jest.fn(() => {
      aliveAtExit = isAlive(pid);
    });
    const handled = new Promise<void>((resolve, reject) => {
      listenOnAddress(
        express(),
        port,
        '127.0.0.1',
        () => reject(new Error(`port ${port} was expected to be occupied`)),
        (error) => {
          expect(error.code).toBe('EADDRINUSE');
          void exitAfterBindFailure({
            error,
            host: '127.0.0.1',
            port,
            cleanupUpstreamServers: cleanupAllServers,
            drainUpstreamTerminations: drainStdioTerminations,
            budgetMs: GENEROUS_BUDGET_MS,
            exit,
          }).then(resolve, reject);
        },
      );
    });

    try {
      await handled;

      expect(exit).toHaveBeenCalledWith(1);
      expect(aliveAtExit).toBe(false);
      await expect(waitForExit(child, 5000)).resolves.toBe(true);
      expect(isAlive(pid)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
    }
  }, 60_000);

  it('exits even when the upstream cleanup cannot finish in the budget', async () => {
    const child = await startStubbornChild();
    setServerInfosForTest([stdioServerInfo('too-slow-upstream', child.pid!)]);

    const exit = jest.fn();

    await exitAfterBindFailure({
      error: Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' }),
      host: '127.0.0.1',
      port: 3000,
      cleanupUpstreamServers: cleanupAllServers,
      drainUpstreamTerminations: drainStdioTerminations,
      // Shorter than the SIGTERM grace period, so the wait cannot complete.
      budgetMs: 5,
      exit,
    });

    expect(exit).toHaveBeenCalledWith(1);
  }, 30_000);

  // If the handler did not bound the wait itself, this test would never finish
  // rather than fail an assertion, which is the behaviour being guarded.
  it('exits even when the wait never resolves', async () => {
    const exit = jest.fn();

    await exitAfterBindFailure({
      error: Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' }),
      host: '127.0.0.1',
      port: 3000,
      cleanupUpstreamServers: () => undefined,
      drainUpstreamTerminations: () => new Promise<boolean>(() => undefined),
      budgetMs: 200,
      exit,
    });

    expect(exit).toHaveBeenCalledWith(1);
  }, 30_000);

  // A server that honours SIGTERM goes away on the first signal, so the wait
  // reports it gone without the escalation ever running. How long that takes is
  // the host's business; that the wait ends early is measured with fake timers
  // in tests/services/mcpService-stdio-cleanup.test.ts.
  it('reports a compliant child gone', async () => {
    const child = await startCompliantChild();
    const pid = child.pid!;
    setServerInfosForTest([stdioServerInfo('compliant-upstream', pid)]);

    cleanupAllServers();

    await expect(drainStdioTerminations(GENEROUS_BUDGET_MS)).resolves.toBe(true);
    expect(isAlive(pid)).toBe(false);
  }, 60_000);

  it('reports false when the budget runs out before the terminations settle', async () => {
    const child = await startStubbornChild();
    setServerInfosForTest([stdioServerInfo('slow-upstream', child.pid!)]);

    cleanupAllServers();

    await expect(drainStdioTerminations(5)).resolves.toBe(false);
  }, 30_000);
});
