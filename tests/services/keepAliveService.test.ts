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
