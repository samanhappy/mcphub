import * as call from '../../../src/cli/commands/call.js';
import { ApiClient } from '../../../src/cli/http.js';

function makeClient(response: unknown) {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  const fetchImpl = (async (url: any, init: any) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (body?.method === 'tools/call') {
      calls.push({ method: init.method, url: String(url), body: { ...body, id: 1 } });
      return Response.json({ ...(response as object), id: body.id });
    }
    if (body?.method === 'initialize') {
      return Response.json(
        {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'test', version: '1.0.0' },
          },
        },
        { headers: { 'mcp-session-id': 'test-session' } },
      );
    }
    return new Response(null, { status: init.method === 'GET' ? 405 : 202 });
  }) as unknown as typeof fetch;
  return { client: new ApiClient({ baseUrl: 'http://hub.test', token: 't', fetchImpl }), calls };
}

describe('call command', () => {
  it('defaults to /mcp/$smart and builds tools/call JSON-RPC body', async () => {
    const { client, calls } = makeClient({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'hi' }] },
    });
    await call.run(['echo', 'msg=hello', 'n=5'], {}, { client });
    expect(calls[0].url).toBe('http://hub.test/mcp/%24smart');
    expect(calls[0].body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: { msg: 'hello', n: 5 } },
    });
  });

  it('--group routes to /mcp/<group>', async () => {
    const { client, calls } = makeClient({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    await call.run(['echo', '--group', 'dev'], {}, { client });
    expect(calls[0].url).toBe('http://hub.test/mcp/dev');
  });

  it('--server routes to /mcp/<server> (same wire surface as --group)', async () => {
    const { client, calls } = makeClient({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    await call.run(['echo', '--server', 'fetch'], {}, { client });
    expect(calls[0].url).toBe('http://hub.test/mcp/fetch');
  });

  it('--server wins over --group when both are present', async () => {
    const { client, calls } = makeClient({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    await call.run(['echo', '--group', 'dev', '--server', 'fetch'], {}, { client });
    expect(calls[0].url).toBe('http://hub.test/mcp/fetch');
  });

  it('--smart wins over --group', async () => {
    const { client, calls } = makeClient({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    await call.run(['echo', '--group', 'dev', '--smart'], {}, { client });
    expect(calls[0].url).toBe('http://hub.test/mcp/%24smart');
  });

  it('--params-json overrides positional args', async () => {
    const { client, calls } = makeClient({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    await call.run(['echo', 'ignored=1', '--params-json', '{"deep":{"v":1}}'], {}, { client });
    expect(calls[0].body.params.arguments).toEqual({ deep: { v: 1 } });
  });

  it('throws CliUsageError on MCP error response', async () => {
    const { client } = makeClient({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    });
    await expect(call.run(['nosuch'], {}, { client })).rejects.toThrow(/MCP error -32601/);
  });

  it('missing tool name throws usage error', async () => {
    const { client } = makeClient({});
    await expect(call.run([], {}, { client })).rejects.toThrow(/Usage: mcphub call/);
  });

  it('--no-coerce keeps string values', async () => {
    const { client, calls } = makeClient({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    await call.run(['echo', 'n=42', '--no-coerce'], {}, { client });
    expect(calls[0].body.params.arguments).toEqual({ n: '42' });
  });
});
