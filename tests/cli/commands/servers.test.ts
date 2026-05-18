import * as servers from '../../../src/cli/commands/servers.js';
import { ApiClient } from '../../../src/cli/http.js';

type Captured = { method: string; url: string; body?: any };

function makeClient(handler: (req: Captured) => any): { client: ApiClient; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const captured: Captured = { method: init.method, url: String(url), body };
    calls.push(captured);
    const result = handler(captured);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(result ?? { success: true }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { client: new ApiClient({ baseUrl: 'http://hub.test', token: 't', fetchImpl }), calls };
}

describe('servers command', () => {
  it('list calls GET /api/servers and prints table', async () => {
    const { client, calls } = makeClient(() => ({
      success: true,
      data: [
        { name: 'a', status: 'connected', tools: [{}, {}], owner: 'admin', error: null },
        { name: 'b', status: 'disconnected', tools: [], owner: 'admin', error: 'oops' },
      ],
    }));
    await servers.run(['list'], {}, { client });
    expect(calls).toEqual([{ method: 'GET', url: 'http://hub.test/api/servers', body: undefined }]);
  });

  it('add --from-file POSTs the parsed JSON', async () => {
    const { client, calls } = makeClient(() => ({ success: true, data: {} }));
    const fakeFs = {
      readFileSync: () =>
        JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'foo'] }),
    } as any;
    await servers.run(['add', 'foo', '--from-file', '/tmp/foo.json'], {}, {
      client,
      fs: fakeFs,
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('http://hub.test/api/servers');
    expect(calls[0].body).toEqual({
      name: 'foo',
      config: { type: 'stdio', command: 'npx', args: ['-y', 'foo'] },
    });
  });

  it('add inline collects repeated --arg and --env entries', async () => {
    const { client, calls } = makeClient(() => ({ success: true, data: {} }));
    await servers.run(
      [
        'add',
        'foo',
        '--type',
        'stdio',
        '--command',
        'npx',
        '--arg',
        '-y',
        '--arg',
        'pkg',
        '--env',
        'KEY=A',
        '--env',
        'OTHER=B',
      ],
      {},
      { client },
    );
    expect(calls[0].body.config).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { KEY: 'A', OTHER: 'B' },
      enabled: true,
    });
  });

  it('add inline preserves --arg values that look like flags', async () => {
    // Regression: collectRepeated used to skip values starting with "--", which
    // broke wrapped CLIs (`python --arg --version`). Now we consume the value
    // verbatim and advance past it.
    const { client, calls } = makeClient(() => ({ success: true, data: {} }));
    await servers.run(
      [
        'add',
        'wrapped',
        '--type',
        'stdio',
        '--command',
        'python',
        '--arg',
        '--version',
        '--arg',
        '-m',
        '--arg',
        'pkg',
      ],
      {},
      { client },
    );
    expect(calls[0].body.config.args).toEqual(['--version', '-m', 'pkg']);
  });

  it('remove calls DELETE with URL-encoded name', async () => {
    const { client, calls } = makeClient(() => ({ success: true }));
    await servers.run(['remove', 'my server'], {}, { client });
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: 'http://hub.test/api/servers/my%20server',
    });
  });

  it('toggle --on includes enabled:true', async () => {
    const { client, calls } = makeClient(() => ({ success: true }));
    await servers.run(['toggle', 'foo', '--on'], {}, { client });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://hub.test/api/servers/foo/toggle',
      body: { enabled: true },
    });
  });

  it('reload POSTs an empty body to /reload', async () => {
    const { client, calls } = makeClient(() => ({ success: true }));
    await servers.run(['reload', 'foo'], {}, { client });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://hub.test/api/servers/foo/reload',
    });
  });

  it('unknown subcommand throws', async () => {
    const { client } = makeClient(() => ({}));
    await expect(servers.run(['bogus'], {}, { client })).rejects.toThrow(/Unknown servers/);
  });
});
