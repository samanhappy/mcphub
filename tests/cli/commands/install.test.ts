import * as install from '../../../src/cli/commands/install.js';
import { ApiClient } from '../../../src/cli/http.js';

type Captured = { method: string; url: string; body?: any };

function makeClient(
  handler: (req: Captured) => { status?: number; body?: unknown },
): { client: ApiClient; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const captured: Captured = { method: init.method, url: String(url), body };
    calls.push(captured);
    const { status = 200, body: respBody } = handler(captured);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (respBody !== undefined ? JSON.stringify(respBody) : ''),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { client: new ApiClient({ baseUrl: 'http://hub.test', token: 't', fetchImpl }), calls };
}

const INSTALL_RESPONSE = {
  success: true,
  data: {
    name: 'amap-maps',
    installationType: 'npm',
    availableTypes: ['npm', 'docker'],
    mcpServers: {
      'amap-maps': {
        command: 'npx',
        args: ['-y', '@amap/mcp-server-amap'],
        env: { AMAP_MAPS_API_KEY: '<your-api-key>' },
      },
    },
    arguments: {
      AMAP_MAPS_API_KEY: { description: 'AMap API key', required: true, example: '<your-api-key>' },
    },
  },
};

describe('install command', () => {
  it('--dry-run prints snippet to stdout without writing anywhere', async () => {
    const { client: source } = makeClient(() => ({ body: INSTALL_RESPONSE }));
    const writes: string[] = [];
    const origWrite = process.stdout.write;
    (process.stdout as any).write = (chunk: any) => {
      writes.push(String(chunk));
      return true;
    };
    try {
      await install.run(
        ['amap-maps', '--dry-run', '--env', 'AMAP_MAPS_API_KEY=abc'],
        {},
        { sourceClient: source },
      );
    } finally {
      (process.stdout as any).write = origWrite;
    }
    const json = JSON.parse(writes.join('').trim());
    expect(json.mcpServers['amap-maps'].env.AMAP_MAPS_API_KEY).toBe('abc');
  });

  it('--to hub POSTs the resolved snippet to /api/servers', async () => {
    const { client: source } = makeClient(() => ({ body: INSTALL_RESPONSE }));
    const { client: dest, calls: destCalls } = makeClient(() => ({
      body: { success: true },
    }));
    await install.run(
      ['amap-maps', '--to', 'hub', '--env', 'AMAP_MAPS_API_KEY=secret'],
      {},
      { sourceClient: source, destClient: dest },
    );
    expect(destCalls[0]).toMatchObject({
      method: 'POST',
      url: 'http://hub.test/api/servers',
    });
    expect(destCalls[0].body.name).toBe('amap-maps');
    expect(destCalls[0].body.config.command).toBe('npx');
    expect(destCalls[0].body.config.env.AMAP_MAPS_API_KEY).toBe('secret');
  });

  it('--to file merges into existing mcpServers JSON and writes atomically', async () => {
    const { client: source } = makeClient(() => ({ body: INSTALL_RESPONSE }));
    let lastWrite: { path: string; data: string } | undefined;
    let lastRename: { from: string; to: string } | undefined;
    const fakeFs = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ mcpServers: { other: { command: 'foo' } } }),
      writeFileSync: (p: any, d: any) => {
        lastWrite = { path: String(p), data: String(d) };
      },
      renameSync: (from: any, to: any) => {
        lastRename = { from: String(from), to: String(to) };
      },
    } as any;
    await install.run(
      ['amap-maps', '--to', 'file', '--out', '/tmp/claude.json', '--env', 'AMAP_MAPS_API_KEY=k'],
      {},
      { sourceClient: source, fs: fakeFs },
    );
    // Write goes to a temp file, then rename to the final path.
    expect(lastWrite?.path).toMatch(/^\/tmp\/claude\.json\.tmp\./);
    expect(lastRename).toEqual({ from: lastWrite?.path, to: '/tmp/claude.json' });
    const merged = JSON.parse(lastWrite!.data);
    expect(merged.mcpServers.other).toEqual({ command: 'foo' });
    expect(merged.mcpServers['amap-maps']).toBeDefined();
  });

  it('--to file refuses to overwrite without --force', async () => {
    const { client: source } = makeClient(() => ({ body: INSTALL_RESPONSE }));
    const fakeFs = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ mcpServers: { 'amap-maps': { command: 'old' } } }),
      writeFileSync: () => {
        throw new Error('should not be called');
      },
      renameSync: () => {
        throw new Error('should not be called');
      },
    } as any;
    await expect(
      install.run(
        ['amap-maps', '--to', 'file', '--out', '/tmp/claude.json', '--env', 'AMAP_MAPS_API_KEY=k'],
        {},
        { sourceClient: source, fs: fakeFs },
      ),
    ).rejects.toThrow(/Pass --force/);
  });

  it('--env merges additional keys not declared by the marketplace', async () => {
    const { client: source } = makeClient(() => ({ body: INSTALL_RESPONSE }));
    const { client: dest, calls: destCalls } = makeClient(() => ({
      body: { success: true },
    }));
    await install.run(
      [
        'amap-maps',
        '--to',
        'hub',
        '--env',
        'AMAP_MAPS_API_KEY=secret',
        '--env',
        'DEBUG=1',
      ],
      {},
      { sourceClient: source, destClient: dest },
    );
    expect(destCalls[0].body.config.env).toEqual({
      AMAP_MAPS_API_KEY: 'secret',
      DEBUG: '1',
    });
  });

  it('--yes with missing required env throws with actionable message', async () => {
    const { client: source } = makeClient(() => ({ body: INSTALL_RESPONSE }));
    await expect(
      install.run(['amap-maps', '--to', 'stdout', '--yes'], {}, { sourceClient: source }),
    ).rejects.toThrow(/Missing required env values: AMAP_MAPS_API_KEY/);
  });

  it('surfaces "no <type> installation" 404 from the marketplace', async () => {
    const { client: source } = makeClient(() => ({
      status: 404,
      body: { success: false, message: "Server has no 'docker' installation method" },
    }));
    await expect(
      install.run(['amap-maps', '--type', 'docker', '--to', 'stdout', '--yes'], {}, {
        sourceClient: source,
      }),
    ).rejects.toThrow(/no 'docker' installation method/);
  });
});
