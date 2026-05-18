import * as exportCmd from '../../../src/cli/commands/export.js';
import { ApiClient } from '../../../src/cli/http.js';

function fakeClient(body: unknown): ApiClient {
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    } as unknown as Response)) as unknown as typeof fetch;
  return new ApiClient({ baseUrl: 'http://hub.test', token: 't', fetchImpl });
}

describe('export command', () => {
  it('--out writes JSON to the given path', async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const client = fakeClient({ mcpServers: { a: { command: 'npx' } } });
    await exportCmd.run(['--out', '/tmp/backup.json'], {}, {
      client,
      fs: {
        writeFileSync: (p: any, d: any) => {
          writes.push({ path: String(p), data: String(d) });
        },
      } as any,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('/tmp/backup.json');
    expect(JSON.parse(writes[0].data)).toEqual({ mcpServers: { a: { command: 'npx' } } });
  });

  it('without --out prints pretty JSON to stdout', async () => {
    const client = fakeClient({ mcpServers: {} });
    const writes: string[] = [];
    const orig = process.stdout.write;
    (process.stdout as any).write = (chunk: any) => {
      writes.push(String(chunk));
      return true;
    };
    try {
      await exportCmd.run([], {}, { client });
    } finally {
      (process.stdout as any).write = orig;
    }
    expect(writes.join('')).toMatch(/"mcpServers"/);
  });
});
