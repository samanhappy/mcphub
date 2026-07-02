import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setupClientKeepAlive } from '../../src/services/keepAliveService.js';
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
    jest.useRealTimers();
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
    const error = Object.assign(
      new Error('Streamable HTTP error: Error POSTing to endpoint: '),
      { code: 502 },
    );
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
