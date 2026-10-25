import { SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { setupClientKeepAlive, clearClientKeepAlive } from '../../src/services/keepAliveService.js';
import { ServerConfig, ServerInfo } from '../../src/types/index.js';

const makeServerInfo = (
  transport: ServerInfo['transport'],
  ping: jest.Mock,
  status: ServerInfo['status'] = 'connected',
): ServerInfo =>
  ({
    name: 'remote-server',
    status,
    enabled: true,
    error: null,
    tools: [],
    prompts: [],
    resources: [],
    createTime: Date.now(),
    transport,
    client: {
      ping,
    },
    options: {},
  }) as unknown as ServerInfo;

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

describe('setupClientKeepAlive', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('uses uncached discovery for modern servers without requiring tools or ping', async () => {
    jest.useFakeTimers();
    const ping = jest.fn().mockRejectedValue(new Error('Method not found'));
    const info = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      ping,
    );
    const discover = jest.fn().mockResolvedValue({});
    Object.assign(info.client!, { getProtocolEra: () => 'modern', discover });
    await setupClientKeepAlive(info, { type: 'streamable-http', enableKeepAlive: true });
    await jest.advanceTimersByTimeAsync(60000);
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5000 }));
    expect(ping).not.toHaveBeenCalled();
    expect(info.status).toBe('connected');
  });

  it('marks failed streamable-http servers disconnected when keep-alive is enabled', async () => {
    jest.useFakeTimers();
    const ping = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const serverInfo = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      ping,
    );

    await setupClientKeepAlive(serverInfo, {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: true,
    });

    expect(serverInfo.keepAliveIntervalId).toBeDefined();

    await jest.advanceTimersByTimeAsync(60000);

    expect(ping).toHaveBeenCalledTimes(1);
    expect(serverInfo.status).toBe('disconnected');
    expect(serverInfo.error).toContain('connect ECONNREFUSED');
  });

  it('includes HTTP error metadata in the displayed keep-alive error', async () => {
    jest.useFakeTimers();
    const error = Object.assign(new Error('Streamable HTTP error: Error POSTing to endpoint: '), {
      code: 502,
    });
    const ping = jest.fn().mockRejectedValue(error);
    const serverInfo = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      ping,
    );

    await setupClientKeepAlive(serverInfo, {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: true,
    });

    await jest.advanceTimersByTimeAsync(60000);

    expect(serverInfo.error).toContain('Streamable HTTP error: Error POSTing to endpoint:');
    expect(serverInfo.error).toContain('502');
  });

  it('does not start a second remote health check while one is still running', async () => {
    jest.useFakeTimers();
    const deferred = createDeferred<unknown>();
    const ping = jest.fn(() => deferred.promise);
    const serverInfo = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      ping,
    );

    await setupClientKeepAlive(serverInfo, {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: true,
    });

    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    jest.advanceTimersByTime(60000);
    await Promise.resolve();

    expect(ping).toHaveBeenCalledTimes(1);

    deferred.resolve({});
    await jest.advanceTimersByTimeAsync(0);
    jest.advanceTimersByTime(60000);
    await Promise.resolve();

    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('ignores stale health check results after the client is cleared', async () => {
    jest.useFakeTimers();
    const deferred = createDeferred<unknown>();
    const ping = jest.fn(() => deferred.promise);
    const serverInfo = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      ping,
    );

    await setupClientKeepAlive(serverInfo, {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: true,
    });

    jest.advanceTimersByTime(60000);
    await Promise.resolve();

    serverInfo.client = undefined;
    serverInfo.status = 'disconnected';
    serverInfo.error = 'Server disabled';

    deferred.resolve({});
    await jest.advanceTimersByTimeAsync(0);

    expect(serverInfo.status).toBe('disconnected');
    expect(serverInfo.error).toBe('Server disabled');
  });

  it('ignores stale health check failures after the client is cleared', async () => {
    jest.useFakeTimers();
    const deferred = createDeferred<unknown>();
    const ping = jest.fn(() => deferred.promise);
    const serverInfo = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      ping,
    );

    await setupClientKeepAlive(serverInfo, {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: true,
    });

    jest.advanceTimersByTime(60000);
    await Promise.resolve();

    serverInfo.client = undefined;
    serverInfo.status = 'disconnected';
    serverInfo.error = 'Server disabled';

    deferred.reject(new Error('late keep-alive failure'));
    await jest.advanceTimersByTimeAsync(0);

    expect(serverInfo.status).toBe('disconnected');
    expect(serverInfo.error).toBe('Server disabled');
  });

  it('restores connected status when a later SSE health check succeeds', async () => {
    jest.useFakeTimers();
    const ping = jest.fn().mockResolvedValue({});
    const serverInfo = makeServerInfo(
      new SSEClientTransport(new URL('https://example.com/sse')),
      ping,
      'disconnected',
    );
    serverInfo.error = 'Keep-alive failed: previous outage';

    await setupClientKeepAlive(serverInfo, {
      type: 'sse',
      url: 'https://example.com/sse',
      enableKeepAlive: true,
    });

    await jest.advanceTimersByTimeAsync(60000);

    expect(ping).toHaveBeenCalledTimes(1);
    expect(serverInfo.status).toBe('connected');
    expect(serverInfo.error).toBeNull();
  });

  it('reconnects disconnected enabled remote servers on the next keep-alive check', async () => {
    jest.useFakeTimers();
    const ping = jest.fn();
    const reconnectServer = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const serverInfo = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      ping,
      'disconnected',
    );
    serverInfo.client = undefined;
    serverInfo.error = 'Failed to connect: timeout';

    await setupClientKeepAlive(
      serverInfo,
      {
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        enableKeepAlive: true,
      },
      { reconnectServer },
    );

    await jest.advanceTimersByTimeAsync(10000);

    expect(reconnectServer).toHaveBeenCalledWith('remote-server');
    expect(ping).not.toHaveBeenCalled();
  });

  it('does not overwrite a concurrent successful reconnect with a stale reconnect failure', async () => {
    jest.useFakeTimers();
    const ping = jest.fn();
    const serverInfo = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      ping,
      'disconnected',
    );
    serverInfo.client = undefined;
    serverInfo.error = 'Failed to connect: timeout';
    const reconnectServer = jest.fn(async () => {
      serverInfo.status = 'connected';
      serverInfo.error = null;
      throw new Error('stale reconnect failure');
    });

    await setupClientKeepAlive(
      serverInfo,
      {
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        enableKeepAlive: true,
      },
      { reconnectServer },
    );

    await jest.advanceTimersByTimeAsync(10000);

    expect(reconnectServer).toHaveBeenCalledWith('remote-server');
    expect(serverInfo.status).toBe('connected');
    expect(serverInfo.error).toBeNull();
  });

  it('does not schedule checks when remote keep-alive is explicitly disabled', async () => {
    jest.useFakeTimers();
    const serverInfo = makeServerInfo(
      new SSEClientTransport(new URL('https://example.com/sse')),
      jest.fn(),
    );

    await setupClientKeepAlive(serverInfo, {
      type: 'sse',
      url: 'https://example.com/sse',
      enableKeepAlive: false,
    });

    expect(serverInfo.keepAliveIntervalId).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not schedule checks for remote servers by default', async () => {
    jest.useFakeTimers();
    const serverInfo = makeServerInfo(
      new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
      jest.fn(),
    );

    await setupClientKeepAlive(serverInfo, {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    });

    expect(serverInfo.keepAliveIntervalId).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([false, undefined])(
    'retries outages with backoff without health checks (%s)',
    async (enableKeepAlive) => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const info = makeServerInfo(
        new StreamableHTTPClientTransport(new URL('https://example.com/mcp')),
        jest.fn(),
        'disconnected',
      );
      const reconnectServer = jest.fn().mockRejectedValue(new Error('offline'));
      const config = { type: 'streamable-http' as const, enableKeepAlive };
      await setupClientKeepAlive(info, config, { reconnectServer });
      for (const delay of [5000, 10000, 20000, 40000, 80000, 150000, 150000]) {
        expect(info.recovery?.nextAttemptAt).toBe(Date.now() + delay);
        await jest.advanceTimersByTimeAsync(delay - 1);
        const attempts = reconnectServer.mock.calls.length;
        await jest.advanceTimersByTimeAsync(1);
        expect(reconnectServer).toHaveBeenCalledTimes(attempts + 1);
        expect(info.recovery?.lastAttemptAt).toBe(Date.now());
      }
      info.status = 'connected';
      await setupClientKeepAlive(info, config, { reconnectServer });
      expect(info.recovery).toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('does not postpone an existing recovery after another failed call', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const info = makeServerInfo(
      new SSEClientTransport(new URL('https://example.com/sse')),
      jest.fn(),
      'disconnected',
    );
    const reconnectServer = jest.fn().mockResolvedValue(undefined);
    await setupClientKeepAlive(info, { type: 'sse' }, { reconnectServer });
    const scheduled = info.recovery?.nextAttemptAt;
    await jest.advanceTimersByTimeAsync(4000);
    await setupClientKeepAlive(info, { type: 'sse' }, { reconnectServer });
    expect(info.recovery?.nextAttemptAt).toBe(scheduled);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(reconnectServer).toHaveBeenCalledTimes(1);
  });

  it.each(['disabled', 'oauth', 'connected', 'cleared'])(
    'cancels scheduled recovery when %s',
    async (state) => {
      jest.useFakeTimers();
      const info = makeServerInfo(
        new SSEClientTransport(new URL('https://example.com/sse')),
        jest.fn(),
        'disconnected',
      );
      const reconnectServer = jest.fn();
      await setupClientKeepAlive(info, { type: 'sse' }, { reconnectServer });
      if (state === 'disabled') info.enabled = false;
      if (state === 'oauth') info.status = 'oauth_required';
      if (state === 'connected') info.status = 'connected';
      if (state === 'cleared') clearClientKeepAlive(info);
      else await setupClientKeepAlive(info, { type: 'sse' }, { reconnectServer });
      await jest.advanceTimersByTimeAsync(300000);
      expect(reconnectServer).not.toHaveBeenCalled();
      expect(info.recovery).toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('does not schedule checks for stdio servers', async () => {
    jest.useFakeTimers();
    const serverInfo = makeServerInfo(undefined, jest.fn());
    const serverConfig: ServerConfig = {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    };

    await setupClientKeepAlive(serverInfo, serverConfig);

    expect(serverInfo.keepAliveIntervalId).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
