import * as groups from '../../../src/cli/commands/groups.js';
import { ApiClient } from '../../../src/cli/http.js';

type Captured = { method: string; url: string; body?: any };

function makeClient(
  responder: (req: Captured) => any,
): { client: ApiClient; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const captured: Captured = { method: init.method, url: String(url), body };
    calls.push(captured);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responder(captured) ?? { success: true }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { client: new ApiClient({ baseUrl: 'http://hub.test', token: 't', fetchImpl }), calls };
}

const sampleGroups = [
  { id: 'uuid-1', name: 'dev', servers: ['a', 'b'], description: '' },
  { id: 'uuid-2', name: 'prod', servers: [], description: 'prod servers' },
];

describe('groups command', () => {
  it('list calls GET /api/groups', async () => {
    const { client, calls } = makeClient(() => ({ success: true, data: sampleGroups }));
    await groups.run(['list'], {}, { client });
    expect(calls[0].url).toBe('http://hub.test/api/groups');
  });

  it('add posts name + description', async () => {
    const { client, calls } = makeClient(() => ({
      success: true,
      data: { id: 'new-id', name: 'x', servers: [] },
    }));
    await groups.run(['add', 'x', '--description', 'a desc'], {}, { client });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ name: 'x', description: 'a desc' });
  });

  it('get by name resolves to UUID via list', async () => {
    const { client, calls } = makeClient((req) => {
      if (req.url.endsWith('/api/groups')) {
        return { success: true, data: sampleGroups };
      }
      return { success: true, data: sampleGroups[0] };
    });
    await groups.run(['get', 'dev'], {}, { client });
    expect(calls.map((c) => c.url)).toEqual([
      'http://hub.test/api/groups',
      'http://hub.test/api/groups/uuid-1',
    ]);
  });

  it('add-server posts to /servers under resolved group', async () => {
    const { client, calls } = makeClient((req) => {
      if (req.url.endsWith('/api/groups')) {
        return { success: true, data: sampleGroups };
      }
      return { success: true };
    });
    await groups.run(['add-server', 'prod', 'srv-1'], {}, { client });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'http://hub.test/api/groups/uuid-2/servers',
      body: { serverName: 'srv-1' },
    });
  });

  it('remove-server deletes by resolved id and server name', async () => {
    const { client, calls } = makeClient((req) => {
      if (req.url.endsWith('/api/groups')) {
        return { success: true, data: sampleGroups };
      }
      return { success: true };
    });
    await groups.run(['remove-server', 'prod', 'srv-2'], {}, { client });
    expect(calls[1]).toMatchObject({
      method: 'DELETE',
      url: 'http://hub.test/api/groups/uuid-2/servers/srv-2',
    });
  });

  it('resolveGroupId throws for unknown group ref', async () => {
    const { client } = makeClient(() => ({ success: true, data: [] }));
    await expect(groups.run(['get', 'missing'], {}, { client })).rejects.toThrow(/Group not found/);
  });
});
