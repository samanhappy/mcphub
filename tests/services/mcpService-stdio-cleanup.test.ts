// Tests that stdio MCP server child processes are fully terminated on
// delete/disable — not just the direct child wrapper, but the whole process
// tree. Regression coverage for issue #920.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// The capture has to happen BEFORE either close(), because client.close()
// sends the SIGTERM that makes an `npx` wrapper exit and reparent its children.
// Both closes are mocked no-ops here, so nothing else in this file would notice
// the order changing. This records it.
const mockCallOrder: string[] = [];

const mockRemoveServerToolEmbeddings = jest.fn().mockResolvedValue(undefined);
const mockClientConnect = jest.fn().mockResolvedValue(undefined);
const mockClientClose = jest.fn(() => {
  mockCallOrder.push('client.close');
});
const mockListTools = jest.fn().mockResolvedValue({ tools: [] });

const mockStdioTransportClose = jest.fn(() => {
  mockCallOrder.push('transport.close');
});

// Per-instance PID. The mock factory stores a fresh instance in this map so
// tests can look up / set PIDs from the outside.
const stdioInstances: Array<{ pid: number | null }> = [];

// IMPORTANT: the jest.mock factory must be self-contained. ESM hoists
// `jest.mock` calls above all imports and the factory runs before any module
// is loaded, so it cannot reference top-level consts defined in the test
// file. We expose a setter that the test can call after import.
let currentTestPid: number | null = 12345;

jest.mock('@modelcontextprotocol/client', () => ({
  ...jest.requireActual('@modelcontextprotocol/client'),
  Client: jest.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    close: mockClientClose,
    getServerCapabilities: jest.fn(() => ({})),
    listTools: mockListTools,
  })),
}));

jest.mock('@modelcontextprotocol/client/stdio', () => {
  class FakeStdioClientTransport {
    pid: number | null;
    stderr: { on: jest.Mock };
    constructor() {
      this.pid = currentTestPid;
      this.stderr = { on: jest.fn() };
      stdioInstances.push(this);
    }
    close = mockStdioTransportClose;
  }
  return { StdioClientTransport: FakeStdioClientTransport };
});

const mockTreeKill = jest.fn((_pid: number, _signal: string, cb?: (err?: Error) => void) => {
  if (cb) cb();
});
jest.mock('tree-kill', () => mockTreeKill);

// Mutable holder for the process-lister availability probe (issue #1072).
// The jest.mock factory must be self-contained, hence the wrapper object.
const mockProcessTreeKillAvailability = { value: true };
// The tree the snapshot reports, and the start times a later identity check
// reads back. Both are wrapper objects for the same reason: the jest.mock
// factory has to be self-contained. A null start-time map is "the process
// table could not be read", which is not the same as "none of them match".
const mockCapturedTree: {
  value: {
    rootStartedAt?: string;
    rootUnknown?: boolean;
    descendants: Array<{ pid: number; startedAt: string }>;
  };
  // The capture is a synchronous call at the top of the only shutdown path, so
  // the suite has to be able to make it fail.
  throws?: boolean;
} = { value: { descendants: [] } };
const mockCurrentStartTimes: { value: Map<number, string> | null } = { value: new Map() };
jest.mock('../../src/utils/processTree', () => ({
  // Must match the real module's value. Left out, it imports as undefined, and
  // every absent pid then compares equal to it.
  UNKNOWN_START_TIME: 'unknown',
  isProcessTreeKillAvailable: () => mockProcessTreeKillAvailability.value,
  captureProcessTreeSync: () => {
    mockCallOrder.push('capture');
    if (mockCapturedTree.throws) {
      throw new Error('the process table exploded');
    }
    return mockCapturedTree.value;
  },
  readProcessStartTimesSync: () => mockCurrentStartTimes.value,
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  registerOAuthClient: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(),
}));

const mockServerDao = {
  findById: jest.fn(),
  findAll: jest.fn(() => Promise.resolve([] as any[])),
  setEnabled: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
  exists: jest.fn().mockResolvedValue(false),
  create: jest.fn().mockResolvedValue(true),
  update: jest.fn().mockResolvedValue(true),
};

jest.mock('../../src/dao/DaoFactory.js', () => ({
  ...jest.requireActual('../../src/dao/DaoFactory.js'),
  getCredentialBindingDao: jest.fn(() => ({
    delete: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(),
  })),
  getGroupDao: jest.fn(),
  getBuiltinPromptDao: jest.fn(),
  getBuiltinResourceDao: jest.fn(),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(),
  getSmartRoutingTools: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn().mockResolvedValue(undefined),
  removeServerToolEmbeddings: mockRemoveServerToolEmbeddings,
}));

jest.mock('../../src/config/index.js', () => ({
  loadSettings: jest.fn(),
  expandEnvVars: jest.fn((val: string) => val),
  replaceEnvVars: jest.fn((val: any) => val),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
  },
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logActivity: jest.fn(),
  })),
}));

// The drain names the pids it could not confirm, and a refused signal is only
// visible as a warning, so both are assertable rather than printed.
jest.mock('../../src/utils/logger.js', () => {
  const mockLogger = {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return { logger: mockLogger, default: mockLogger };
});

// Suppress process.kill(pid, 0) "liveness" probe from warning on the live PID
// we hand to the helper. We just want to verify the call was attempted.
const originalProcessKill = process.kill.bind(process);
const installProcessKillMock = (): void => {
  jest.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    // Pretend the live pid is dead, so the SIGKILL fallback is NOT triggered
    // in tests by default — we only want to assert SIGTERM was sent.
    if (pid === currentTestPid && (signal === 0 || signal === undefined)) {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    }
    return originalProcessKill(pid, signal as any);
  }) as any);
};

// Import after mocks
import {
  addServer,
  cleanupAllServers,
  deleteMcpServer,
  drainStdioTerminations,
  removeServer,
  resetStdioTerminationsForTest,
  setIsolatedClientForTest,
  setServerInfosForTest,
  STDIO_TERMINATION_DRAIN_BUDGET_MS,
  toggleServerStatus,
} from '../../src/services/mcpService.js';
import { logger } from '../../src/utils/logger.js';
import type { ServerInfo } from '../../src/types/index.js';
const makeStdioServerInfo = (name: string): ServerInfo =>
  ({
    name,
    status: 'connected',
    error: null,
    tools: [],
    prompts: [],
    resources: [],
    enabled: true,
    createTime: Date.now(),
    client: new (Client as any)(),
    transport: new (StdioClientTransport as any)({ command: 'noop' }),
  }) as unknown as ServerInfo;

describe('orphan stdio process cleanup (issue #920)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentTestPid = 12345;
    mockProcessTreeKillAvailability.value = true;
    mockCapturedTree.value = { descendants: [] };
    mockCapturedTree.throws = false;
    mockCallOrder.length = 0;
    mockCurrentStartTimes.value = new Map();
    setServerInfosForTest([]);
    resetStdioTerminationsForTest();
    installProcessKillMock();
  });

  afterEach(() => {
    // Each `closeServer` schedules a 2-second setTimeout for the SIGKILL
    // fallback. Use fake timers to make sure those don't keep the event loop
    // alive between tests. Also restore process.kill so the spy doesn't leak
    // into other test files in the same process.
    jest.useFakeTimers();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    installProcessKillMock();
  });

  describe('removeServer', () => {
    it('closes the client and transport when a server is deleted', async () => {
      const info = makeStdioServerInfo('orphan-server', 9999);
      setServerInfosForTest([info]);

      const result = await removeServer('orphan-server');

      expect(result.success).toBe(true);
      expect(mockClientClose).toHaveBeenCalledTimes(1);
      expect(mockStdioTransportClose).toHaveBeenCalledTimes(1);
    });

    it('sends SIGTERM to the full stdio process tree on delete (not just the wrapper)', async () => {
      currentTestPid = 9999;
      const info = makeStdioServerInfo('orphan-server');
      setServerInfosForTest([info]);

      await removeServer('orphan-server');

      expect(mockTreeKill).toHaveBeenCalledWith(9999, 'SIGTERM', expect.any(Function));
    });

    it('does not attempt tree-kill for non-stdio transports', async () => {
      const info = makeStdioServerInfo('orphan-server');
      // Replace the stdio transport with a non-stdio one (plain object that
      // is NOT an instance of StdioClientTransport and has no `pid` getter).
      info.transport = {
        close: jest.fn(),
      } as any;
      setServerInfosForTest([info]);

      await removeServer('orphan-server');

      expect(mockTreeKill).not.toHaveBeenCalled();
      expect(mockClientClose).toHaveBeenCalledTimes(1);
    });

    it('kicks in for any transport with a numeric `pid` (duck-typing, not instanceof)', async () => {
      // A non-SDK transport with a `pid` getter should still be tree-killed.
      // This guards against the "dual package hazard" where pnpm loads two
      // copies of @modelcontextprotocol/client and `instanceof` returns false.
      currentTestPid = 8686;
      const info = makeStdioServerInfo('duck-server');
      info.transport = {
        close: jest.fn(),
        get pid() {
          return currentTestPid;
        },
      } as any;
      setServerInfosForTest([info]);

      await removeServer('duck-server');

      expect(mockTreeKill).toHaveBeenCalledWith(8686, 'SIGTERM', expect.any(Function));
    });

    it('does not throw when the serverInfo has no transport or client', async () => {
      // Edge case: server was created via addServer() but never connected.
      mockServerDao.delete.mockResolvedValueOnce(true);

      const result = await removeServer('never-connected');

      expect(result.success).toBe(true);
      expect(mockTreeKill).not.toHaveBeenCalled();
    });

    it('falls back to SIGKILL if the process is still alive after the grace period', async () => {
      jest.useFakeTimers();
      try {
        // Make the "is alive?" probe say the process is still alive, so the
        // SIGKILL fallback fires.
        (process.kill as jest.Mock).mockImplementation(((
          _pid: number,
          signal?: string | number,
        ) => {
          if (signal === 0 || signal === undefined) {
            return true;
          }
          return true;
        }) as any);

        currentTestPid = 4242;
        const info = makeStdioServerInfo('stubborn-server');
        setServerInfosForTest([info]);

        await removeServer('stubborn-server');

        expect(mockTreeKill).toHaveBeenCalledWith(4242, 'SIGTERM', expect.any(Function));
        mockTreeKill.mockClear();

        jest.advanceTimersByTime(2000);

        expect(mockTreeKill).toHaveBeenCalledWith(4242, 'SIGKILL', expect.any(Function));
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it('treats EPERM from the liveness probe as "still alive" and falls back to SIGKILL', async () => {
      jest.useFakeTimers();
      try {
        // process.kill(pid, 0) throws EPERM when the process exists but we
        // can't signal it. isProcessAlive() should count that as alive.
        (process.kill as jest.Mock).mockImplementation(((
          _pid: number,
          signal?: string | number,
        ) => {
          if (signal === 0 || signal === undefined) {
            throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
          }
          return true;
        }) as any);

        currentTestPid = 5151;
        const info = makeStdioServerInfo('eperm-server');
        setServerInfosForTest([info]);

        await removeServer('eperm-server');

        expect(mockTreeKill).toHaveBeenCalledWith(5151, 'SIGTERM', expect.any(Function));
        mockTreeKill.mockClear();

        jest.advanceTimersByTime(2000);

        expect(mockTreeKill).toHaveBeenCalledWith(5151, 'SIGKILL', expect.any(Function));
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });
  });

  // The drain is what a caller about to call process.exit() relies on. These
  // cases are driven with fake timers, so they measure the logic rather than
  // how fast the host happens to be.
  describe('drainStdioTerminations', () => {
    const reportProcessAlive = (alive: boolean): void => {
      (process.kill as jest.Mock).mockImplementation(((_pid: number, signal?: string | number) => {
        if (signal === 0 || signal === undefined) {
          if (alive) {
            return true;
          }
          throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        }
        return true;
      }) as any);
    };

    it('ends as soon as the process is gone, without waiting out the grace period', async () => {
      jest.useFakeTimers();
      try {
        reportProcessAlive(false);
        currentTestPid = 3131;
        setServerInfosForTest([makeStdioServerInfo('already-gone')]);

        await removeServer('already-gone');

        const drain = drainStdioTerminations(10_000);
        // One probe interval is enough; the 2000 ms escalation never runs.
        await jest.advanceTimersByTimeAsync(100);

        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it('keeps waiting while the process is still there, then reports it gone', async () => {
      jest.useFakeTimers();
      try {
        reportProcessAlive(true);
        currentTestPid = 3232;
        setServerInfosForTest([makeStdioServerInfo('stubborn-drain')]);

        await removeServer('stubborn-drain');

        let outcome: boolean | undefined;
        const drain = drainStdioTerminations(60_000).then((value) => {
          outcome = value;
          return value;
        });

        // Past SIGTERM, past the SIGKILL escalation: still not finished,
        // because the pid is still answering.
        await jest.advanceTimersByTimeAsync(5000);
        expect(outcome).toBeUndefined();

        reportProcessAlive(false);
        await jest.advanceTimersByTimeAsync(100);

        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it('reports the pid as not gone when the budget runs out', async () => {
      jest.useFakeTimers();
      try {
        reportProcessAlive(true);
        currentTestPid = 3333;
        setServerInfosForTest([makeStdioServerInfo('never-dies')]);

        await removeServer('never-dies');

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);

        await expect(drain).resolves.toBe(false);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it('falls back to the default budget instead of giving up at once on a bad one', async () => {
      jest.useFakeTimers();
      try {
        reportProcessAlive(true);
        currentTestPid = 3434;
        setServerInfosForTest([makeStdioServerInfo('bad-budget')]);

        await removeServer('bad-budget');

        let outcome: boolean | undefined;
        const drain = drainStdioTerminations(Number.NaN).then((value) => {
          outcome = value;
          return value;
        });

        // A NaN budget reaches setTimeout as 1 ms, so an unvalidated budget
        // would already have reported failure here.
        await jest.advanceTimersByTimeAsync(100);
        expect(outcome).toBeUndefined();

        await jest.advanceTimersByTimeAsync(STDIO_TERMINATION_DRAIN_BUDGET_MS);

        await expect(drain).resolves.toBe(false);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it('reports true, and says so, when nothing is pending', async () => {
      setServerInfosForTest([]);
      await expect(drainStdioTerminations(0)).resolves.toBe(true);
    });

    // Per-session isolated clients close through their own path, which has the
    // same reparenting problem and needs the same snapshot.
    it('captures the tree of a per-session isolated client too', async () => {
      jest.useFakeTimers();
      try {
        const startedAt = 'Mon Nov 16 02:00:00 2026';
        mockCapturedTree.value = {
          rootStartedAt: startedAt,
          descendants: [{ pid: 4445, startedAt }],
        };
        mockCurrentStartTimes.value = new Map([[4445, startedAt]]);
        // The isolated wrapper is gone; its grandchild is not.
        (process.kill as jest.Mock).mockImplementation(((pid: number, signal?: string | number) => {
          if (signal === 0 || signal === undefined) {
            if (pid === 4444) {
              throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
            }
            return true;
          }
          return true;
        }) as any);
        setServerInfosForTest([]);
        setIsolatedClientForTest('session-1', 'isolated-server', {
          client: new (Client as any)(),
          transport: { pid: 4444, close: jest.fn() },
        });

        cleanupAllServers();

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(2100);

        expect(process.kill as jest.Mock).toHaveBeenCalledWith(4445, 'SIGKILL');
        await jest.advanceTimersByTimeAsync(2000);
        await drain;
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
        resetStdioTerminationsForTest();
      }
    });

    // The cap exists so a pid that cannot be signalled at all leaves the
    // pending list. It also has to take the probes with it: one 50 ms loop per
    // disable/reconnect, running for as long as the hub does, is the leak.
    it('stops probing once the termination reaches its cap', async () => {
      jest.useFakeTimers();
      try {
        reportProcessAlive(true);
        currentTestPid = 3535;
        setServerInfosForTest([makeStdioServerInfo('cannot-be-signalled')]);

        await removeServer('cannot-be-signalled');

        // Past the 62-second cap: the entry is gone from the pending list.
        await jest.advanceTimersByTimeAsync(63_000);
        await expect(drainStdioTerminations(0)).resolves.toBe(true);

        (process.kill as jest.Mock).mockClear();
        await jest.advanceTimersByTimeAsync(5000);

        // Nothing is waiting on this pid any more, so nothing may still be
        // asking whether it is alive.
        const probesForThisPid = (process.kill as jest.Mock).mock.calls.filter(
          ([probedPid, signal]) => probedPid === 3535 && (signal === 0 || signal === undefined),
        );
        expect(probesForThisPid).toHaveLength(0);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // A wrapper that honours SIGTERM dies on the first signal, and its
    // children are reparented: the root pid going away says nothing about
    // them, and tree-kill can no longer walk to them either.
    it('escalates to the captured descendants when the root pid is already gone', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 3636;
        mockCapturedTree.value = {
          rootStartedAt: 'Mon Nov 16 01:59:00 2026',
          descendants: [{ pid: 3637, startedAt: 'Mon Nov 16 02:00:00 2026' }],
        };
        mockCurrentStartTimes.value = new Map([
          [3636, 'Mon Nov 16 01:59:00 2026'],
          [3637, 'Mon Nov 16 02:00:00 2026'],
        ]);
        // The wrapper is gone; the grandchild is not.
        (process.kill as jest.Mock).mockImplementation(((pid: number, signal?: string | number) => {
          if (signal === 0 || signal === undefined) {
            if (pid === 3636) {
              throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
            }
            return true;
          }
          return true;
        }) as any);
        setServerInfosForTest([makeStdioServerInfo('wrapper-server')]);

        await removeServer('wrapper-server');

        let outcome: boolean | undefined;
        const drain = drainStdioTerminations(60_000).then((value) => {
          outcome = value;
          return value;
        });

        // The root is already gone, so without the captured pid this would
        // have reported success here.
        await jest.advanceTimersByTimeAsync(100);
        expect(outcome).toBeUndefined();

        await jest.advanceTimersByTimeAsync(2000);

        expect(process.kill as jest.Mock).toHaveBeenCalledWith(3637, 'SIGKILL');
        // tree-kill is not asked to walk a dead wrapper's tree.
        expect(mockTreeKill).not.toHaveBeenCalledWith(3636, 'SIGKILL', expect.any(Function));

        (process.kill as jest.Mock).mockImplementation(((
          _pid: number,
          signal?: string | number,
        ) => {
          if (signal === 0 || signal === undefined) {
            throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
          }
          return true;
        }) as any);
        await jest.advanceTimersByTimeAsync(100);

        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // The guard has to fail closed. An empty start-time map would read as
    // "none of these match", which is the same shape as "every one of them is
    // a stranger", so the util says null when it could not look and nothing is
    // signalled by pid on that path.
    it('does not signal captured pids when the process table cannot be read', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 3838;
        mockCapturedTree.value = {
          rootStartedAt: 'Mon Nov 16 01:59:00 2026',
          descendants: [{ pid: 3839, startedAt: 'Mon Nov 16 02:00:00 2026' }],
        };
        mockCurrentStartTimes.value = null;
        reportProcessAlive(true);
        setServerInfosForTest([makeStdioServerInfo('no-ps-at-escalation')]);

        await removeServer('no-ps-at-escalation');

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);

        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(3839, 'SIGKILL');
        // Not signalled and not confirmed gone: the honest answer, and the
        // drain says so rather than claiming success.
        await expect(drain).resolves.toBe(false);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // process.kill() reads a negative pid as a whole process group, and in a
    // container pid 1 is MCPHub itself. Neither may ever be signalled, however
    // a malformed listing got them into the captured set.
    it('refuses to signal pid 1, a negative pid, or the hub itself', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 3939;
        const startedAt = 'Mon Nov 16 02:00:00 2026';
        mockCapturedTree.value = {
          rootStartedAt: startedAt,
          descendants: [
            { pid: 1, startedAt },
            { pid: -2, startedAt },
            { pid: process.pid, startedAt },
          ],
        };
        mockCurrentStartTimes.value = new Map([
          [3939, startedAt],
          [1, startedAt],
          [-2, startedAt],
          [process.pid, startedAt],
        ]);
        reportProcessAlive(true);
        setServerInfosForTest([makeStdioServerInfo('bad-pids-server')]);

        await removeServer('bad-pids-server');

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);
        await expect(drain).resolves.toBe(false);

        const signalled = (process.kill as jest.Mock).mock.calls.filter(
          ([, signal]) => signal === 'SIGKILL' || signal === 'SIGTERM',
        );
        expect(signalled.map(([pid]) => pid)).not.toContain(1);
        expect(signalled.map(([pid]) => pid)).not.toContain(-2);
        expect(signalled.map(([pid]) => pid)).not.toContain(process.pid);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // Every exit path has to take the probes with it, and the test-only reset
    // helper is one of them: without it, one test's abandoned poll loop keeps
    // answering for a pid the next test reuses.
    it('stops probing when the terminations are reset', async () => {
      jest.useFakeTimers();
      try {
        reportProcessAlive(true);
        currentTestPid = 4040;
        setServerInfosForTest([makeStdioServerInfo('reset-while-waiting')]);

        await removeServer('reset-while-waiting');
        await jest.advanceTimersByTimeAsync(100);

        resetStdioTerminationsForTest();
        (process.kill as jest.Mock).mockClear();
        await jest.advanceTimersByTimeAsync(5000);

        const probes = (process.kill as jest.Mock).mock.calls.filter(
          ([probedPid, signal]) => probedPid === 4040 && (signal === 0 || signal === undefined),
        );
        expect(probes).toHaveLength(0);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // Nothing may be left scheduled once the outcome is known. The escalation
    // timer is the one that does not announce itself: `settled` makes it a
    // no-op if it fires, so only the handle count shows it was left behind.
    it('leaves no timer scheduled once the wait has finished', async () => {
      jest.useFakeTimers();
      try {
        reportProcessAlive(false);
        currentTestPid = 4141;
        setServerInfosForTest([makeStdioServerInfo('clean-exit')]);

        await removeServer('clean-exit');

        const drain = drainStdioTerminations(10_000);
        await jest.advanceTimersByTimeAsync(100);
        await expect(drain).resolves.toBe(true);

        // The poll loop, the 2 s escalation and the 62 s cap are all gone,
        // well before either of the last two would have fired.
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // tree-kill walks whatever children the pid has NOW, so a recycled root
    // would hand it a stranger's subtree. The check guards the FIRST signal as
    // well as the escalation: transport.close() has already sent SIGTERM by the
    // time this runs, so the wrapper may be gone and its pid reused already.
    it('neither signals nor waits for a root pid that is no longer the upstream process', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 4242;
        mockCapturedTree.value = {
          rootStartedAt: 'Mon Nov 16 02:00:00 2026',
          descendants: [],
        };
        // Same pid, started half an hour later: not our wrapper.
        mockCurrentStartTimes.value = new Map([[4242, 'Mon Nov 16 02:30:00 2026']]);
        reportProcessAlive(true);
        setServerInfosForTest([makeStdioServerInfo('recycled-root-server')]);

        await removeServer('recycled-root-server');

        // Not even the opening SIGTERM.
        expect(mockTreeKill).not.toHaveBeenCalled();

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);

        expect(mockTreeKill).not.toHaveBeenCalled();
        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(4242, 'SIGKILL');
        // The pid being reusable means the captured process already exited, so
        // this wait is over. Reporting it unconfirmed would be a stranger
        // holding the drain open to its cap for a process that died.
        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // Same recycled root, but a captured descendant is still running. The root
    // leaves the wait; the descendant is still signalled on its own identity
    // and is the only pid the drain reports.
    it('drops a recycled root from the wait but still ends its captured descendant', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 4545;
        const descendantStartedAt = 'Mon Nov 16 02:00:00 2026';
        mockCapturedTree.value = {
          rootStartedAt: descendantStartedAt,
          descendants: [{ pid: 4546, startedAt: descendantStartedAt }],
        };
        mockCurrentStartTimes.value = new Map([
          // Root recycled, descendant untouched.
          [4545, 'Mon Nov 16 02:30:00 2026'],
          [4546, descendantStartedAt],
        ]);
        reportProcessAlive(true);
        setServerInfosForTest([makeStdioServerInfo('recycled-root-live-child')]);

        await removeServer('recycled-root-live-child');
        expect(mockTreeKill).not.toHaveBeenCalled();

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);

        expect(process.kill as jest.Mock).toHaveBeenCalledWith(4546, 'SIGKILL');
        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(4545, 'SIGKILL');
        await expect(drain).resolves.toBe(false);

        const warned = (logger.warn as jest.Mock).mock.calls.find(
          ([message]: [string]) =>
            message === 'Upstream stdio process trees were not confirmed gone',
        );
        expect(warned?.[1].pending[0].pids).toEqual([4546]);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // The survivors have to be named on the CAP path as well, and that is the
    // path the entry has already removed itself from pendingStdioTerminations
    // on. Reading the survivor list off that set logged an empty one here,
    // which is where an operator most needs the pid: the drain gave up on a
    // process it could not signal. A budget longer than the 62 s cap is what
    // separates this from the timeout path.
    it('names the survivors when the cap wins rather than the drain budget', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 4646;
        const startedAt = 'Mon Nov 16 02:00:00 2026';
        mockCapturedTree.value = {
          rootStartedAt: startedAt,
          descendants: [{ pid: 4647, startedAt }],
        };
        mockCurrentStartTimes.value = new Map([
          [4646, startedAt],
          [4647, startedAt],
        ]);
        // Nothing ever dies, so neither the probe nor the escalation can settle
        // this and the cap is the only thing left to end it.
        reportProcessAlive(true);
        setServerInfosForTest([makeStdioServerInfo('capped-server')]);

        await removeServer('capped-server');

        const drain = drainStdioTerminations(90_000);
        await jest.advanceTimersByTimeAsync(62_100);

        await expect(drain).resolves.toBe(false);
        const warned = (logger.warn as jest.Mock).mock.calls.find(
          ([message]: [string]) =>
            message === 'Upstream stdio process trees were not confirmed gone',
        );
        expect(warned?.[1].timedOut).toBe(false);
        expect(warned?.[1].pending).toHaveLength(1);
        expect(warned?.[1].pending[0]).toMatchObject({
          serverName: 'capped-server',
          pid: 4646,
          pids: [4646, 4647],
        });
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // On the budget-timeout path there are no outcomes to read, so each entry
    // has to answer for itself. Naming an entry that had already settled gone
    // sends whoever reads the log after a process that stopped on its own.
    it('names only the unfinished entries when the drain gives up on its budget', async () => {
      jest.useFakeTimers();
      try {
        const startedAt = 'Mon Nov 16 02:00:00 2026';
        // Both pids are in the drain's snapshot and both are alive when it
        // starts. One then exits DURING the wait, which is the case that
        // separates the two filters: an entry that settled before the drain
        // began is not in the snapshot at all and proves nothing.
        const dead = new Set<number>();
        (process.kill as jest.Mock).mockImplementation(((pid: number, signal?: string | number) => {
          if (signal === 0 || signal === undefined) {
            if (dead.has(pid)) {
              throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
            }
            return true;
          }
          return true;
        }) as any);
        mockCurrentStartTimes.value = new Map([
          [5454, startedAt],
          [5555, startedAt],
        ]);

        currentTestPid = 5454;
        mockCapturedTree.value = { rootStartedAt: startedAt, descendants: [] };
        setServerInfosForTest([makeStdioServerInfo('exits-during-drain')]);
        await removeServer('exits-during-drain');

        currentTestPid = 5555;
        mockCapturedTree.value = { rootStartedAt: startedAt, descendants: [] };
        setServerInfosForTest([makeStdioServerInfo('stays-alive')]);
        await removeServer('stays-alive');

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(100);

        // 5454 goes away mid-drain; its probe settles it 'gone' well inside
        // the budget, which also removes it from pendingStdioTerminations.
        dead.add(5454);
        await jest.advanceTimersByTimeAsync(1000);

        // 5555 never dies, so the budget is what ends this.
        await jest.advanceTimersByTimeAsync(3100);
        await expect(drain).resolves.toBe(false);

        const warned = (logger.warn as jest.Mock).mock.calls.find(
          ([message]: [string]) =>
            message === 'Upstream stdio process trees were not confirmed gone',
        );
        expect(warned?.[1].timedOut).toBe(true);
        expect(
          warned?.[1].pending.map((entry: { serverName: string }) => entry.serverName),
        ).toEqual(['stays-alive']);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // A token was captured and the lookup that would check it failed. That is
    // "could not verify", not "verified": treating it as confirmation is how a
    // reused pid gets its whole tree signalled.
    it('does not signal the tree when the root identity lookup fails outright', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 5757;
        mockCapturedTree.value = {
          rootStartedAt: 'Mon Nov 16 02:00:00 2026',
          descendants: [],
        };
        // null is "the table could not be consulted at all".
        mockCurrentStartTimes.value = null;
        reportProcessAlive(true);
        setServerInfosForTest([makeStdioServerInfo('lookup-failed')]);

        await removeServer('lookup-failed');

        expect(mockTreeKill).not.toHaveBeenCalled();
        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(5757, 'SIGKILL');
        expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
          'Could not verify the identity of an stdio root pid, not signalling its tree',
          expect.objectContaining({ pid: 5757 }),
        );

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);
        // Not forgotten either: unknown is not gone.
        await expect(drain).resolves.toBe(false);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // A root that exists but cannot be described is neither ours nor a
    // stranger. Its tree is not signalled, and it is NOT dropped from the wait:
    // calling it gone would be a claim the lookup cannot support.
    it('neither signals nor forgets a root whose identity cannot be read', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 5656;
        mockCapturedTree.value = {
          rootStartedAt: 'Mon Nov 16 02:00:00 2026',
          descendants: [],
        };
        mockCurrentStartTimes.value = new Map([[5656, 'unknown']]);
        reportProcessAlive(true);
        setServerInfosForTest([makeStdioServerInfo('unknown-root')]);

        await removeServer('unknown-root');

        expect(mockTreeKill).not.toHaveBeenCalled();
        expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
          'Cannot confirm the identity of an stdio root pid, not signalling its tree',
          expect.objectContaining({ pid: 5656 }),
        );

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);
        // Still watched, so unconfirmed rather than gone.
        await expect(drain).resolves.toBe(false);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // The one assertion that pins the ordering this whole approach rests on.
    // client.close() sends the SIGTERM that makes an `npx` wrapper exit and
    // reparent its children, after which no walk can find them, so a capture
    // taken after it is worthless. Both closes are no-ops in this suite, so
    // without this the capture could move below them and everything stays green.
    it('captures the tree before either close, on both close paths', async () => {
      currentTestPid = 5353;
      reportProcessAlive(false);
      setServerInfosForTest([makeStdioServerInfo('order-on-remove')]);

      await removeServer('order-on-remove');

      expect(mockCallOrder).toEqual(['capture', 'client.close', 'transport.close']);

      // And the per-session isolated path, which has its own close pair.
      mockCallOrder.length = 0;
      setIsolatedClientForTest('session-order', 'order-on-cleanup', {
        client: new (Client as any)(),
        transport: new (StdioClientTransport as any)({ command: 'noop' }),
      });

      deleteMcpServer('session-order');

      expect(mockCallOrder).toEqual(['capture', 'client.close', 'transport.close']);
    });

    // The liveness probe sends nothing, but it still names a pid to the kernel,
    // and the real kernel answers for pid 0: process.kill(0, 0) succeeds on
    // both Windows and Linux, because it means "the caller's own process
    // group". A captured pid 0 would therefore read alive for as long as the
    // hub runs and the wait could never end. Modelled here rather than with
    // reportProcessAlive, which would have pid 0 throw ESRCH like any other
    // dead pid and hide the whole thing.
    it('does not probe pid 0, which the kernel answers for forever', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 5050;
        mockCapturedTree.value = {
          rootStartedAt: 'Mon Nov 16 02:00:00 2026',
          descendants: [{ pid: 0, startedAt: 'Mon Nov 16 02:00:00 2026' }],
        };
        mockCurrentStartTimes.value = new Map([[5050, 'Mon Nov 16 02:00:00 2026']]);
        (process.kill as jest.Mock).mockImplementation(((pid: number, signal?: string | number) => {
          if (signal === 0 || signal === undefined) {
            // The hub's own process group, exactly as the OS reports it.
            if (pid === 0) {
              return true;
            }
            throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
          }
          return true;
        }) as any);
        setServerInfosForTest([makeStdioServerInfo('zero-in-capture')]);

        await removeServer('zero-in-capture');

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);

        // The guard is observed directly, because its end state is not its own:
        // were pid 0 probed and found alive, the identity check would forget it
        // at the escalation and the wait would still finish. So assert the
        // probe never happens, rather than a drain result another mechanism
        // also produces.
        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(0, 0);
        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // Distinct from the case above it: here a start time WAS captured and the
    // later lookup does not list the pid. Absent is "the kernel says gone", and
    // a gone pid loses nothing by not being signalled, while under /proc
    // hidepid a live process owned by someone else reads absent the same way.
    it('does not tree-kill a root the later lookup did not list', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 5151;
        mockCapturedTree.value = {
          rootStartedAt: 'Mon Nov 16 02:00:00 2026',
          descendants: [],
        };
        // Readable table, root simply not in it.
        mockCurrentStartTimes.value = new Map();
        reportProcessAlive(false);
        setServerInfosForTest([makeStdioServerInfo('root-unlisted-later')]);

        await removeServer('root-unlisted-later');

        expect(mockTreeKill).not.toHaveBeenCalled();
        expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
          'Not signalling the tree of a pid that is no longer the upstream process',
          expect.objectContaining({ pid: 5151, reason: 'not listed' }),
        );

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);
        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // The capture runs before anything else in the only shutdown path. If it
    // threw, the loop over the servers would abort, every server after this one
    // would stay open, and the caller's catch would skip the drain, abandoning
    // the terminations already started. It is total today; this makes sure a
    // regression there cannot reach that far.
    it('closes the server anyway when the process-table capture throws', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 4747;
        mockCapturedTree.throws = true;
        reportProcessAlive(false);
        setServerInfosForTest([makeStdioServerInfo('capture-throws')]);

        await expect(removeServer('capture-throws')).resolves.toMatchObject({ success: true });
        expect(mockClientClose).toHaveBeenCalledTimes(1);
        expect(mockStdioTransportClose).toHaveBeenCalledTimes(1);
        // Root-pid-only behaviour, which is the documented fallback.
        expect(mockTreeKill).toHaveBeenCalledWith(4747, 'SIGTERM', expect.any(Function));
        expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
          'Could not capture the stdio process tree, watching the root pid alone',
          expect.objectContaining({ pid: 4747 }),
        );

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);
        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // An unusable pid means cleanup silently does not happen, which in the log
    // is indistinguishable from cleanup that worked.
    it('says so rather than skipping quietly when the transport reports pid 0', async () => {
      currentTestPid = 0;
      reportProcessAlive(false);
      setServerInfosForTest([makeStdioServerInfo('zero-pid')]);

      await removeServer('zero-pid');

      expect(mockTreeKill).not.toHaveBeenCalled();
      expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
        'Not cleaning up an stdio process tree: unusable pid',
        expect.objectContaining({ pid: 0 }),
      );
    });

    // A readable table that does not list the root is not the same as a table
    // that could not be read. Both signal on trust, but only this one is worth
    // saying, because silence here reads as a check that passed.
    it('says when it signals a tree whose root the process table did not list', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 4848;
        mockCapturedTree.value = {
          rootUnknown: true,
          descendants: [{ pid: 4849, startedAt: 'Mon Nov 16 02:00:00 2026' }],
        };
        mockCurrentStartTimes.value = new Map();
        reportProcessAlive(false);
        setServerInfosForTest([makeStdioServerInfo('root-not-listed')]);

        await removeServer('root-not-listed');

        expect(mockTreeKill).toHaveBeenCalledWith(4848, 'SIGTERM', expect.any(Function));
        const said = (logger.warn as jest.Mock).mock.calls.filter(
          ([message]: [string]) =>
            message === 'Signalling an stdio process tree without checking its identity',
        );
        // Once for this termination, not once per signal.
        expect(said).toHaveLength(1);

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);
        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // A hung taskkill is the real case for this. Waiting on the signalling
    // spawn as well as on the pids turned a shutdown where everything had been
    // seen to exit into a reported orphan.
    it('reports gone when every pid exited even though tree-kill never called back', async () => {
      jest.useFakeTimers();
      const callsBack = mockTreeKill.getMockImplementation();
      try {
        mockTreeKill.mockImplementation(() => undefined);
        currentTestPid = 4949;
        mockCapturedTree.value = { descendants: [] };
        reportProcessAlive(false);
        setServerInfosForTest([makeStdioServerInfo('hung-treekill')]);

        await removeServer('hung-treekill');

        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);

        await expect(drain).resolves.toBe(true);
        expect(logger.warn as jest.Mock).not.toHaveBeenCalledWith(
          'Upstream stdio process trees were not confirmed gone',
          expect.anything(),
        );
      } finally {
        // mockClear does not put an implementation back, and a tree-kill that
        // never calls back would leak into every later case in this file.
        mockTreeKill.mockImplementation(callsBack as never);
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // tree-kill signals a whole tree, so it needs the same pid guard the direct
    // kill has. A caller that only tested the pid for truthiness lets pid 1
    // through, and in a container pid 1 is the hub itself.
    it.each([
      ['pid 1', 1],
      ['a negative pid', -5],
    ])('refuses to signal %s, and says so', async (_label, badPid) => {
      jest.useFakeTimers();
      try {
        currentTestPid = badPid as number;
        mockCapturedTree.value = { descendants: [] };
        mockCurrentStartTimes.value = new Map();
        reportProcessAlive(false);
        setServerInfosForTest([makeStdioServerInfo(`guarded-${badPid}`)]);

        await removeServer(`guarded-${badPid}`);
        await jest.advanceTimersByTimeAsync(4100);

        expect(mockTreeKill).not.toHaveBeenCalled();
        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(badPid, 'SIGTERM');
        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(badPid, 'SIGKILL');
        // Refused at the door, where the pid is first read, so the kill path is
        // never entered at all. The guard inside safeTreeKill stays as defence
        // in depth and is no longer reachable from a production caller.
        expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
          'Not cleaning up an stdio process tree: unusable pid',
          expect.objectContaining({ pid: badPid }),
        );
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // Not a number at all. A replica or a disposed custom transport is
    // duck-typed in here, so the value is whatever that object returns.
    it.each([
      ['a string', '1234'],
      ['an object', {}],
    ])('refuses to signal a pid reported as %s', async (_label, badPid) => {
      currentTestPid = badPid as unknown as number;
      reportProcessAlive(false);
      setServerInfosForTest([makeStdioServerInfo('non-numeric-pid')]);

      await removeServer('non-numeric-pid');

      expect(mockTreeKill).not.toHaveBeenCalled();
      expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
        'Not cleaning up an stdio process tree: unusable pid',
        expect.objectContaining({ pid: badPid, type: typeof badPid }),
      );
    });

    // The pid is read through a getter on an object this code does not own.
    // A throw there used to abort the shutdown loop before either close.
    it('closes the server anyway when reading the transport pid throws', async () => {
      const info = makeStdioServerInfo('throwing-pid-getter');
      Object.defineProperty(info.transport as object, 'pid', {
        get() {
          throw new Error('this transport is disposed');
        },
      });
      setServerInfosForTest([info]);

      await expect(removeServer('throwing-pid-getter')).resolves.toMatchObject({ success: true });
      expect(mockClientClose).toHaveBeenCalledTimes(1);
      expect(mockStdioTransportClose).toHaveBeenCalledTimes(1);
      expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
        'Could not read the pid of an stdio transport, skipping process-tree cleanup',
        expect.objectContaining({ serverName: 'throwing-pid-getter' }),
      );
    });

    // One pid the kernel will not describe must not stop the others being
    // dealt with, or a stubborn orphan survives next to an unreadable stranger.
    it('still kills the survivors it can identify when another cannot be read', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 5252;
        const startedAt = 'Mon Nov 16 02:00:00 2026';
        mockCapturedTree.value = {
          rootStartedAt: startedAt,
          descendants: [
            { pid: 5253, startedAt },
            { pid: 5254, startedAt },
          ],
        };
        mockCurrentStartTimes.value = new Map([
          [5252, startedAt],
          [5253, startedAt],
          // Exists, kernel will not say what it is.
          [5254, 'unknown'],
        ]);
        reportProcessAlive(true);
        setServerInfosForTest([makeStdioServerInfo('mixed-batch')]);

        await removeServer('mixed-batch');
        const drain = drainStdioTerminations(4000);
        await jest.advanceTimersByTimeAsync(4100);

        expect(process.kill as jest.Mock).toHaveBeenCalledWith(5253, 'SIGKILL');
        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(5254, 'SIGKILL');
        expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
          'Cannot confirm the identity of a captured pid, not signalling it',
          expect.objectContaining({ pid: 5254 }),
        );
        // 5254 is not forgotten either: unconfirmed, not gone.
        await expect(drain).resolves.toBe(false);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // The escalation yields while tree-kill's own child runs, and the cap or a
    // reset can land inside that window. A signal sent afterwards belongs to a
    // wait nobody is reading any more.
    it('sends no further signals when the wait is abandoned during the escalation', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 4343;
        const startedAt = 'Mon Nov 16 02:00:00 2026';
        mockCapturedTree.value = {
          rootStartedAt: startedAt,
          descendants: [{ pid: 4344, startedAt }],
        };
        mockCurrentStartTimes.value = new Map([
          [4343, startedAt],
          [4344, startedAt],
        ]);
        reportProcessAlive(true);

        // Hold the SIGKILL tree-kill open so the abandonment lands mid-await.
        let releaseTreeKill: (() => void) | undefined;
        mockTreeKill.mockImplementation(((
          _pid: number,
          signal: string,
          cb?: (err?: Error) => void,
        ) => {
          if (signal === 'SIGKILL') {
            releaseTreeKill = () => cb?.();
            return;
          }
          cb?.();
        }) as any);

        setServerInfosForTest([makeStdioServerInfo('abandoned-mid-escalation')]);
        await removeServer('abandoned-mid-escalation');

        await jest.advanceTimersByTimeAsync(2100);
        expect(releaseTreeKill).toBeDefined();

        resetStdioTerminationsForTest();
        (process.kill as jest.Mock).mockClear();
        releaseTreeKill?.();
        await jest.advanceTimersByTimeAsync(100);

        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(4344, 'SIGKILL');
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    // Pid reuse is the risk that comes with signalling pids directly instead
    // of walking a live tree, so a pid whose start time no longer matches is
    // dropped rather than killed.
    it('does not signal a captured pid that has been recycled', async () => {
      jest.useFakeTimers();
      try {
        currentTestPid = 3737;
        mockCapturedTree.value = {
          rootStartedAt: 'Mon Nov 16 01:59:00 2026',
          descendants: [{ pid: 3738, startedAt: 'Mon Nov 16 02:00:00 2026' }],
        };
        // Same pid, different process.
        mockCurrentStartTimes.value = new Map([
          [3737, 'Mon Nov 16 01:59:00 2026'],
          [3738, 'Mon Nov 16 02:30:00 2026'],
        ]);
        (process.kill as jest.Mock).mockImplementation(((pid: number, signal?: string | number) => {
          if (signal === 0 || signal === undefined) {
            if (pid === 3737) {
              throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
            }
            return true;
          }
          return true;
        }) as any);
        setServerInfosForTest([makeStdioServerInfo('recycled-pid-server')]);

        await removeServer('recycled-pid-server');

        const drain = drainStdioTerminations(60_000);
        await jest.advanceTimersByTimeAsync(2100);

        expect(process.kill as jest.Mock).not.toHaveBeenCalledWith(3738, 'SIGKILL');
        // Dropped, not waited on: the stranger's pid would otherwise keep the
        // drain unconfirmed until the cap.
        await expect(drain).resolves.toBe(true);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });
  });

  describe('toggleServerStatus (disable)', () => {
    it('sends SIGTERM to the full stdio process tree when a server is disabled', async () => {
      currentTestPid = 7777;
      const info = makeStdioServerInfo('disable-me');
      setServerInfosForTest([info]);

      const result = await toggleServerStatus('disable-me', false);

      expect(result.success).toBe(true);
      expect(mockClientClose).toHaveBeenCalledTimes(1);
      expect(mockStdioTransportClose).toHaveBeenCalledTimes(1);
      expect(mockTreeKill).toHaveBeenCalledWith(7777, 'SIGTERM', expect.any(Function));
    });
  });

  describe('when the process lister (ps) is unavailable (issue #1072)', () => {
    beforeEach(() => {
      mockProcessTreeKillAvailability.value = false;
    });

    // Replace the liveness-probe-aware mock with a plain recording mock so we
    // never signal real PIDs on the host machine.
    const recordProcessKills = (): jest.Mock => {
      const kill = jest.fn(() => true);
      (process.kill as jest.Mock).mockImplementation(kill as any);
      return kill;
    };

    it('does not call tree-kill and signals only the direct child', async () => {
      const kill = recordProcessKills();
      currentTestPid = 6161;
      const info = makeStdioServerInfo('no-ps-server');
      setServerInfosForTest([info]);

      await removeServer('no-ps-server');

      expect(mockTreeKill).not.toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith(6161, 'SIGTERM');
    });

    it('still escalates to SIGKILL on the direct child after the grace period', async () => {
      jest.useFakeTimers();
      try {
        const kill = recordProcessKills();
        currentTestPid = 6262;
        const info = makeStdioServerInfo('stubborn-no-ps-server');
        setServerInfosForTest([info]);

        await removeServer('stubborn-no-ps-server');

        expect(kill).toHaveBeenCalledWith(6262, 'SIGTERM');
        kill.mockClear();

        jest.advanceTimersByTime(2000);

        expect(mockTreeKill).not.toHaveBeenCalled();
        expect(kill).toHaveBeenCalledWith(6262, 'SIGKILL');
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it('does not throw when the direct child no longer exists', async () => {
      const kill = recordProcessKills();
      kill.mockImplementation(((pid: number, signal?: string | number) => {
        if (signal !== 0 && signal !== undefined && pid === currentTestPid) {
          throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        }
        return true;
      }) as any);
      currentTestPid = 6363;
      const info = makeStdioServerInfo('gone-no-ps-server');
      setServerInfosForTest([info]);

      await expect(removeServer('gone-no-ps-server')).resolves.toEqual(
        expect.objectContaining({ success: true }),
      );
      expect(mockTreeKill).not.toHaveBeenCalled();
    });
  });
});

describe('addServer does not leak transports', () => {
  it('returns success without touching the process tree (no in-memory transport yet)', async () => {
    const result = await addServer('fresh-server', {
      type: 'stdio',
      command: 'noop',
      args: [],
    });

    expect(result.success).toBe(true);
    expect(mockTreeKill).not.toHaveBeenCalled();
  });
});
