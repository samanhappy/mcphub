/// <reference types="jest" />

// Regression tests for issue #1029: startOnDemand servers could never be woken.
// The wake-up went through reconnectServer -> initializeClientsFromSettings,
// which skips the connect for on-demand servers, resolves before the
// fire-and-forget handshake completes, and rebuilds serverInfos (leaving the
// caller with a stale object). These tests exercise the fixed regular tool-call
// path and tool-list visibility through the public handleCallToolRequest /
// handleListToolsRequest entry points.

const mockCallTool = jest.fn();
const mockListTools = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);

const mockClient = {
  connect: mockConnect,
  close: jest.fn(),
  getServerVersion: jest.fn(() => ({ version: '1.0.0' })),
  getInstructions: jest.fn(() => undefined),
  getServerCapabilities: jest.fn(() => ({ tools: {} })),
  listTools: mockListTools,
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
  callTool: mockCallTool,
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn(),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  registerOAuthClient: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

const mockLogToolCall = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: mockLogToolCall,
  })),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(() => jest.fn()),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

const mockFindAll = jest.fn(async () => []);
const mockFindById = jest.fn();
jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findAll: mockFindAll,
    findById: mockFindById,
  })),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(async () => ({})),
  })),
  getGroupDao: jest.fn(() => ({
    findByName: jest.fn(async () => undefined),
    findById: jest.fn(async () => undefined),
  })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
    findByName: jest.fn(async () => undefined),
  })),
  getBuiltinResourceDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
  getUserDao: jest.fn(() => ({
    findByUsername: jest.fn(async () => undefined),
  })),
}));

jest.mock('../../src/config/index.js', () => ({
  expandEnvVars: jest.fn((value: string) => value),
  replaceEnvVars: jest.fn((value: any) => value),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import * as mcpService from '../../src/services/mcpService.js';

const ON_DEMAND_CONFIG = {
  name: 'demo',
  type: 'stdio' as const,
  command: 'node',
  args: [],
  startOnDemand: true,
  enabled: true,
};

const createSleepingServerInfo = (overrides: Record<string, any> = {}) => ({
  name: 'demo',
  status: 'disconnected',
  enabled: true,
  error: null,
  tools: [{ name: 'demo::ping', description: 'ping', inputSchema: { type: 'object' } }],
  prompts: [],
  resources: [],
  options: {},
  config: { startOnDemand: true, type: 'stdio', command: 'node' },
  ...overrides,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('startOnDemand lifecycle', () => {
  let createTransportSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object' } }],
    });
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'pong' }],
      isError: false,
    });
    mockFindById.mockResolvedValue(ON_DEMAND_CONFIG);
    mockFindAll.mockResolvedValue([]);
    // Stub transport creation so the wake does not spawn a real child process.
    createTransportSpy = jest.spyOn(mcpService, 'createTransportFromConfig').mockResolvedValue({});
  });

  afterEach(() => {
    createTransportSpy.mockRestore();
  });

  it('wakes a sleeping on-demand server on a regular tools/call and arms idle shutdown', async () => {
    const serverInfo = createSleepingServerInfo();
    mcpService.setServerInfosForTest([serverInfo as any]);

    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'demo::ping', arguments: {} } },
      { sessionId: 'session-1' },
    );

    // The child was spawned (transport + connect) and the tool was invoked.
    expect(createTransportSpy).toHaveBeenCalledWith(
      'demo',
      expect.objectContaining({ command: 'node' }),
    );
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ping', arguments: {} }),
      undefined,
      expect.anything(),
    );

    // The existing serverInfo was mutated in place: live client + connected.
    expect(serverInfo.status).toBe('connected');
    expect(serverInfo.client).toBe(mockClient);

    // Idle-shutdown timer was armed so the child is eventually reclaimed.
    expect(serverInfo.idleTimeoutId).toBeTruthy();

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('pong');

    // Clean up the armed timer so jest can exit.
    if (serverInfo.idleTimeoutId) clearTimeout(serverInfo.idleTimeoutId);
  });

  it('returns an error result when the on-demand server fails to wake', async () => {
    mockConnect.mockRejectedValue(new Error('spawn failed'));
    const serverInfo = createSleepingServerInfo();
    mcpService.setServerInfosForTest([serverInfo as any]);

    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'demo::ping', arguments: {} } },
      { sessionId: 'session-1' },
    );

    expect(result.isError).toBe(true);
    // ensureServerReady rethrows the original spawn error after recording a
    // wrapped message on serverInfo.error.
    expect(result.content[0].text).toContain('spawn failed');
    expect(serverInfo.status).toBe('disconnected');
    expect(serverInfo.error).toContain('Failed to start on-demand server');
    expect(mockCallTool).not.toHaveBeenCalled();
    // A failed wake must not leave the idle timer armed.
    expect(serverInfo.idleTimeoutId).toBeFalsy();
  });

  describe.each(['direct', 'call_tool'])('idle shutdown during %s calls (issue #1163)', (route) => {
    const result = { content: [{ type: 'text', text: 'pong' }], isError: false };
    const config = { ...ON_DEMAND_CONFIG, idleTimeoutMs: 1000 };
    const call = () =>
      mcpService.handleCallToolRequest(
        route === 'direct'
          ? { params: { name: 'demo::ping', arguments: {} } }
          : { params: { name: 'call_tool', arguments: { toolName: 'demo::ping', arguments: {} } } },
        { sessionId: 'session-1' },
      );

    const startPendingCall = async () => {
      const started = deferred<void>();
      const completion = deferred<typeof result>();
      mockCallTool.mockImplementationOnce(() => {
        started.resolve();
        return completion.promise;
      });
      const pending = call();
      await started.promise;
      return { pending, completion };
    };

    beforeEach(() => {
      jest.useFakeTimers();
      mcpService.setServerInfosForTest([
        createSleepingServerInfo({
          status: 'connected',
          client: mockClient,
          config,
        }) as any,
      ]);
      mockFindById.mockResolvedValue(config);
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    const expectIdleShutdown = async () => {
      await jest.advanceTimersByTimeAsync(999);
      expect(mockClient.close).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(mockClient.close).toHaveBeenCalledTimes(1);
      expect(mcpService.getServerByName('demo')?.status).toBe('disconnected');
      expect(mcpService.getServerByName('demo')?.client).toBeUndefined();
      expect(mcpService.getServerByName('demo')?.tools.map((tool) => tool.name)).toContain(
        'demo::ping',
      );
    };

    it('keeps a new call alive past the previous idle deadline, then reclaims the idle child', async () => {
      await call();
      await jest.advanceTimersByTimeAsync(900);
      const active = await startPendingCall();
      try {
        // Also exceeds a full idle period: resetting the timer at call start is insufficient.
        await jest.advanceTimersByTimeAsync(2000);
        expect(mockClient.close).not.toHaveBeenCalled();
      } finally {
        active.completion.resolve(result);
        await active.pending;
      }
      await expectIdleShutdown();
    });

    it('waits for the last concurrent call before starting the idle period', async () => {
      const active = await startPendingCall();
      try {
        await jest.advanceTimersByTimeAsync(300);
        await call();
        await jest.advanceTimersByTimeAsync(2000);
        expect(mockClient.close).not.toHaveBeenCalled();
      } finally {
        active.completion.resolve(result);
        await active.pending;
      }
      await expectIdleShutdown();
    });

    it.each(['rejection', 'error result'])(
      'reclaims the child after a tool %s',
      async (failure) => {
        if (failure === 'rejection') {
          mockCallTool.mockRejectedValueOnce(new Error('tool failed'));
        } else {
          mockCallTool.mockResolvedValueOnce({ ...result, isError: true });
        }
        expect((await call()).isError).toBe(true);
        await expectIdleShutdown();
      },
    );

    it('preserves active calls and idle shutdown across a configuration reload', async () => {
      const active = await startPendingCall();
      try {
        mockFindAll.mockResolvedValue([config]);
        await mcpService.initializeClientsFromSettings(false, 'another-server');
        await call();
        await jest.advanceTimersByTimeAsync(2000);
        expect(mockClient.close).not.toHaveBeenCalled();
      } finally {
        active.completion.resolve(result);
        await active.pending;
      }
      await expectIdleShutdown();
    });

    it('clears the idle timer when the server is explicitly closed', async () => {
      await call();
      mcpService.closeServer('demo');
      expect(mcpService.getServerByName('demo')?.idleTimeoutId).toBeUndefined();
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockClient.close).toHaveBeenCalledTimes(1);
    });

    it('does not rearm idle shutdown when a closed runtime finishes a call', async () => {
      const active = await startPendingCall();
      mcpService.closeServer('demo');
      active.completion.reject(new Error('Connection closed'));
      expect((await active.pending).isError).toBe(true);
      expect(mcpService.getServerByName('demo')?.idleTimeoutId).toBeUndefined();
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockClient.close).toHaveBeenCalledTimes(1);
    });

    it('does not let discovery priming close a child being used by a tool call', async () => {
      const listing = deferred<void>();
      const prompts = deferred<{ prompts: [] }>();
      mockClient.getServerCapabilities.mockReturnValue({ tools: {}, prompts: {} } as any);
      mockClient.listPrompts.mockImplementationOnce(() => {
        listing.resolve();
        return prompts.promise;
      });
      mockFindAll.mockResolvedValue([config]);
      mcpService.setServerInfosForTest([]);
      const priming = mcpService.initializeClientsFromSettings(false, 'demo');
      await listing.promise;
      const active = await startPendingCall();
      try {
        prompts.resolve({ prompts: [] });
        await priming;
        await jest.advanceTimersByTimeAsync(2000);
        expect(mockClient.close).not.toHaveBeenCalled();
      } finally {
        prompts.resolve({ prompts: [] });
        active.completion.resolve(result);
        await Promise.all([priming, active.pending]);
        mockClient.getServerCapabilities.mockReturnValue({ tools: {} });
      }
      await expectIdleShutdown();
    });
  });

  it('does not select a disabled on-demand server for a tool call', async () => {
    const serverInfo = createSleepingServerInfo({ enabled: false });
    mcpService.setServerInfosForTest([serverInfo as any]);

    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'demo::ping', arguments: {} } },
      { sessionId: 'session-1' },
    );

    // Disabled server is skipped by getServerByTool -> unified "not available".
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockCallTool).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tool not available');
  });

  it('advertises a sleeping on-demand server cached tools via tools/list', async () => {
    const serverInfo = createSleepingServerInfo();
    mcpService.setServerInfosForTest([serverInfo as any]);

    const result = await mcpService.handleListToolsRequest({}, { sessionId: 'session-1' });

    const toolNames = result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('demo::ping');
  });

  it('coalesces an in-flight prime with tools/list so the cached tools are returned', async () => {
    // Simulate the startup prime mid-flight: spawningPromise set, tools still
    // empty, but the promise populates the cache when it resolves.
    const serverInfo = createSleepingServerInfo({ tools: [] });
    serverInfo.spawningPromise = Promise.resolve().then(() => {
      serverInfo.tools = [
        { name: 'demo::ping', description: 'ping', inputSchema: { type: 'object' } },
      ];
    });

    mcpService.setServerInfosForTest([serverInfo as any]);

    const result = await mcpService.handleListToolsRequest({}, { sessionId: 'session-1' });

    const toolNames = result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('demo::ping');
    // spawningPromise is cleared by ensureServerReady elsewhere; nothing to
    // assert here beyond the list reflecting the populated cache.
  });

  it('awaits prime on a targeted reload so the tool cache is populated before returning', async () => {
    // Regression for #1032: editing an already-connected server to enable
    // startOnDemand wiped its tool list (addOrUpdateServer removes the
    // serverInfo) and relied on fire-and-forget prime to repopulate it, so the
    // dashboard refresh that followed the PUT saw an empty list until the next
    // poll. A targeted initializeClientsFromSettings must await the prime so the
    // cache is populated by the time the caller (and the dashboard) reads it.
    mockFindAll.mockResolvedValue([ON_DEMAND_CONFIG]);
    mcpService.setServerInfosForTest([]);

    await mcpService.initializeClientsFromSettings(false, 'demo');

    const serverInfo = mcpService.getServerByName('demo');
    expect(serverInfo).toBeDefined();
    // Prime ran to completion (awaited): tools are cached and the child was put
    // back to sleep, so it is advertised as disconnected-with-cached-tools.
    expect(serverInfo?.tools.map((t) => t.name)).toContain('demo::ping');
    expect(serverInfo?.status).toBe('disconnected');
    expect(createTransportSpy).toHaveBeenCalledWith(
      'demo',
      expect.objectContaining({ command: 'node' }),
    );
  });
});
