// Tests that stdio MCP server child processes are fully terminated on
// delete/disable — not just the direct child wrapper, but the whole process
// tree. Regression coverage for issue #920.

const mockRemoveServerToolEmbeddings = jest.fn().mockResolvedValue(undefined);
const mockClientConnect = jest.fn().mockResolvedValue(undefined);
const mockClientClose = jest.fn();
const mockListTools = jest.fn().mockResolvedValue({ tools: [] });

const mockStdioTransportClose = jest.fn();

// Per-instance PID. The mock factory stores a fresh instance in this map so
// tests can look up / set PIDs from the outside.
const stdioInstances: Array<{ pid: number | null }> = [];

// IMPORTANT: the jest.mock factory must be self-contained. ESM hoists
// `jest.mock` calls above all imports and the factory runs before any module
// is loaded, so it cannot reference top-level consts defined in the test
// file. We expose a setter that the test can call after import.
let currentTestPid: number | null = 12345;

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    close: mockClientClose,
    getServerCapabilities: jest.fn(() => ({})),
    listTools: mockListTools,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
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

// Suppress process.kill(pid, 0) "liveness" probe from warning on the live PID
// we hand to the helper. We just want to verify the call was attempted.
const originalProcessKill = process.kill.bind(process);
const installProcessKillMock = (): void => {
  jest.spyOn(process, 'kill').mockImplementation(
    ((pid: number, signal?: string | number) => {
      // Pretend the live pid is dead, so the SIGKILL fallback is NOT triggered
      // in tests by default — we only want to assert SIGTERM was sent.
      if (pid === currentTestPid && (signal === 0 || signal === undefined)) {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
      return originalProcessKill(pid, signal as any);
    }) as any,
  );
};

// Import after mocks
import {
  addServer,
  removeServer,
  setServerInfosForTest,
  toggleServerStatus,
} from '../../src/services/mcpService.js';
import type { ServerInfo } from '../../src/types/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

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
    setServerInfosForTest([]);
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
      // copies of @modelcontextprotocol/sdk and `instanceof` returns false.
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
        (process.kill as jest.Mock).mockImplementation(
          ((_pid: number, signal?: string | number) => {
            if (signal === 0 || signal === undefined) {
              return true;
            }
            return true;
          }) as any,
        );

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
        (process.kill as jest.Mock).mockImplementation(
          ((_pid: number, signal?: string | number) => {
            if (signal === 0 || signal === undefined) {
              throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
            }
            return true;
          }) as any,
        );

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
