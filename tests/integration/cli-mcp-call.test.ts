import { ApiClient } from '../../src/cli/http.js';
import { CliApiError } from '../../src/cli/errors.js';

// A protocol-enforcing hub fixture: unlike a fixed successful fetch mock,
// this rejects calls that skip initialization or omit the negotiated session.
function hub(options: { sse?: boolean; error?: boolean; unauthorized?: boolean } = {}) {
  const requests: Array<{
    method: string;
    url: string;
    headers: Headers;
    body?: Record<string, unknown>;
  }> = [];
  let initialized = false;
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method: init?.method ?? 'GET', url: String(url), headers, body });
    if (options.unauthorized) return Response.json({ error: 'invalid_token' }, { status: 401 });
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    if (body?.method === 'initialize') {
      return Response.json(
        {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'hub', version: '1.0.37' },
          },
        },
        { headers: { 'mcp-session-id': 'session-1302' } },
      );
    }
    if (headers.get('mcp-session-id') !== 'session-1302') {
      return Response.json({ error: 'No valid session ID provided' }, { status: 400 });
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 200 });
    if (body?.method === 'notifications/initialized') {
      initialized = true;
      return new Response(null, { status: 202 });
    }
    if (!initialized) return Response.json({ error: 'Not initialized' }, { status: 400 });
    const response = {
      jsonrpc: '2.0',
      id: body.id,
      ...(options.error
        ? { error: { code: -32601, message: 'Method not found' } }
        : { result: { content: [{ type: 'text', text: 'tool result' }] } }),
    };
    if (!options.sse) return Response.json(response);
    // Include a notification, CRLF and split chunks to exercise SDK framing.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const text =
          'event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"working"}}\r\n\r\n' +
          `event: message\r\ndata: ${JSON.stringify(response)}\r\n\r\n`;
        controller.enqueue(encoder.encode(text.slice(0, 31)));
        controller.enqueue(encoder.encode(text.slice(31)));
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { fetchImpl, requests };
}

const payload = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'echo', arguments: { msg: 'hello' } },
};

describe('CLI MCP session lifecycle', () => {
  it.each([null, '$smart', 'group name', 'server'])(
    'handshakes and cleans up route %s',
    async (route) => {
      const fixture = hub();
      const client = new ApiClient({
        baseUrl: 'http://hub.test/base',
        token: 'secret',
        tokenKind: 'bearer',
        fetchImpl: fixture.fetchImpl,
      });
      await expect(client.mcpCall(route, payload)).resolves.toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'tool result' }] },
      });
      const posts = fixture.requests.filter((request) => request.method === 'POST');
      expect(posts.map((request) => request.body?.method)).toEqual([
        'initialize',
        'notifications/initialized',
        'tools/call',
      ]);
      const suffix = route ? `/${encodeURIComponent(route)}` : '';
      for (const request of fixture.requests) {
        expect(request.url).toBe(`http://hub.test/base/mcp${suffix}`);
        expect(request.headers.get('authorization')).toBe('Bearer secret');
      }
      expect(posts[2].headers.get('mcp-session-id')).toBe('session-1302');
      expect(posts[2].headers.get('mcp-protocol-version')).toBe('2025-11-25');
      expect(posts[2].headers.get('accept')).toContain('text/event-stream');
      expect(posts[2].body?.params).toEqual(payload.params);
      expect(fixture.requests.at(-1)?.method).toBe('DELETE');
    },
  );

  it('parses SSE results and preserves JWT authentication', async () => {
    const fixture = hub({ sse: true });
    const client = new ApiClient({
      baseUrl: 'http://hub.test',
      token: 'jwt',
      fetchImpl: fixture.fetchImpl,
    });
    await expect(client.mcpCall('server', payload)).resolves.toMatchObject({
      result: { content: [{ text: 'tool result' }] },
    });
    expect(fixture.requests.every((request) => request.headers.get('x-auth-token') === 'jwt')).toBe(
      true,
    );
  });

  it('preserves MCP errors and deletes the session after a failed call', async () => {
    const fixture = hub({ error: true });
    const client = new ApiClient({ baseUrl: 'http://hub.test', fetchImpl: fixture.fetchImpl });
    await expect(client.mcpCall(null, payload)).resolves.toMatchObject({
      error: { code: -32601, message: expect.stringContaining('Method not found') },
    });
    expect(fixture.requests.at(-1)?.method).toBe('DELETE');
  });

  it('preserves HTTP authentication failures without calling the tool', async () => {
    const fixture = hub({ unauthorized: true });
    const client = new ApiClient({ baseUrl: 'http://hub.test', fetchImpl: fixture.fetchImpl });
    await expect(client.mcpCall(null, payload)).rejects.toBeInstanceOf(CliApiError);
    expect(fixture.requests).toHaveLength(1);
  });
});
