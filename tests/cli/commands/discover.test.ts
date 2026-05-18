import * as discover from '../../../src/cli/commands/discover.js';
import { ApiClient } from '../../../src/cli/http.js';

function makeClient(handler: (url: string) => { status?: number; body?: unknown }) {
  const calls: string[] = [];
  const fetchImpl = (async (url: any) => {
    const s = String(url);
    calls.push(s);
    const { status = 200, body } = handler(s);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body !== undefined ? JSON.stringify(body) : ''),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { client: new ApiClient({ baseUrl: 'http://hub.test', fetchImpl }), calls };
}

describe('discover command', () => {
  it('list passes through query params', async () => {
    const { client, calls } = makeClient(() => ({
      body: { success: true, data: { total: 0, servers: [] } },
    }));
    await discover.run(
      ['--remote', 'http://hub.test', '--search', 'github', '--limit', '5'],
      {},
      { client },
    );
    expect(calls[0]).toBe('http://hub.test/discovery/servers?search=github&limit=5');
  });

  it('list returns a helpful message when discovery is disabled (404)', async () => {
    const { client } = makeClient(() => ({
      status: 404,
      body: { success: false, message: 'Not found' },
    }));
    await expect(discover.run([], {}, { client })).rejects.toThrow(/Discovery is not enabled/);
  });

  it('info <name> calls /discovery/servers/:name', async () => {
    const { client, calls } = makeClient(() => ({
      body: { success: true, data: { name: 'amap-maps' } },
    }));
    await discover.run(['info', 'amap-maps'], {}, { client });
    expect(calls[0]).toBe('http://hub.test/discovery/servers/amap-maps');
  });

  it('categories subcommand hits /discovery/categories', async () => {
    const { client, calls } = makeClient(() => ({ body: { success: true, data: ['dev'] } }));
    await discover.run(['categories'], {}, { client });
    expect(calls[0]).toBe('http://hub.test/discovery/categories');
  });
});
