import { ApiClient } from '../../src/cli/http.js';
import { CliApiError } from '../../src/cli/errors.js';

type FetchCall = {
  url: string;
  init: RequestInit;
};

function mockFetch(response: {
  status?: number;
  body?: unknown;
  text?: string;
}): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const status = response.status ?? 200;
    const text =
      response.text !== undefined
        ? response.text
        : response.body !== undefined
        ? JSON.stringify(response.body)
        : '';
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('ApiClient', () => {
  it('injects x-auth-token for JWT tokens', async () => {
    const { fn, calls } = mockFetch({ body: { ok: true } });
    const client = new ApiClient({
      baseUrl: 'http://hub.test',
      token: 'jwt-abc',
      tokenKind: 'jwt',
      fetchImpl: fn,
    });
    await client.get('/api/servers');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://hub.test/api/servers');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-auth-token']).toBe('jwt-abc');
    expect(headers.Authorization).toBeUndefined();
  });

  it('injects Authorization: Bearer for bearer-kind tokens', async () => {
    const { fn, calls } = mockFetch({ body: { ok: true } });
    const client = new ApiClient({
      baseUrl: 'http://hub.test/',
      token: 'bearer-xyz',
      tokenKind: 'bearer',
      fetchImpl: fn,
    });
    await client.post('/api/servers', { name: 'a' });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer bearer-xyz');
    expect(headers['x-auth-token']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0].init.body).toBe(JSON.stringify({ name: 'a' }));
  });

  it('strips trailing slash from baseUrl', async () => {
    const { fn, calls } = mockFetch({ body: {} });
    const client = new ApiClient({ baseUrl: 'http://hub.test/', fetchImpl: fn });
    await client.get('/api/servers');
    expect(calls[0].url).toBe('http://hub.test/api/servers');
  });

  it('throws CliApiError on non-2xx and parses message from JSON body', async () => {
    const { fn } = mockFetch({
      status: 403,
      body: { success: false, message: 'forbidden' },
    });
    const client = new ApiClient({ baseUrl: 'http://hub.test', fetchImpl: fn });
    await expect(client.get('/api/servers')).rejects.toMatchObject({
      name: 'CliApiError',
      status: 403,
      message: 'forbidden',
    });
  });

  it('flags 401 errors as requiresLogin', async () => {
    const { fn } = mockFetch({
      status: 401,
      body: { success: false, message: 'No token, authorization denied' },
    });
    const client = new ApiClient({ baseUrl: 'http://hub.test', fetchImpl: fn });
    let caught: unknown;
    try {
      await client.get('/api/servers');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CliApiError);
    expect((caught as CliApiError).requiresLogin).toBe(true);
  });

  it('falls back to a synthetic message when body has none', async () => {
    const { fn } = mockFetch({ status: 500, text: 'oops' });
    const client = new ApiClient({ baseUrl: 'http://hub.test', fetchImpl: fn });
    await expect(client.get('/api/servers')).rejects.toThrow(/oops/);
  });

  it('omits auth headers when no token is configured', async () => {
    const { fn, calls } = mockFetch({ body: {} });
    const client = new ApiClient({ baseUrl: 'http://hub.test', fetchImpl: fn });
    await client.get('/discovery/servers');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-auth-token']).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it('mcpCall routes to /mcp and /mcp/<group>', async () => {
    const { fn, calls } = mockFetch({ body: { jsonrpc: '2.0' } });
    const client = new ApiClient({ baseUrl: 'http://hub.test', token: 't', fetchImpl: fn });
    await client.mcpCall(null, { method: 'tools/call' });
    await client.mcpCall('$smart', { method: 'tools/call' });
    await client.mcpCall('my-group', { method: 'tools/call' });
    expect(calls.map((c) => c.url)).toEqual([
      'http://hub.test/mcp',
      'http://hub.test/mcp/%24smart',
      'http://hub.test/mcp/my-group',
    ]);
  });
});
