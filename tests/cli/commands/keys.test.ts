import * as keys from '../../../src/cli/commands/keys.js';
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

describe('keys command', () => {
  it('list calls GET /api/auth/keys', async () => {
    const { client, calls } = makeClient(() => ({
      success: true,
      data: [{ id: '1', name: 'ci', enabled: true, accessType: 'all', token: 'abc12345' }],
    }));
    await keys.run(['list'], {}, { client });
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://hub.test/api/auth/keys' });
  });

  it('create posts name and default access-type all', async () => {
    const { client, calls } = makeClient(() => ({
      success: true,
      data: { id: 'new-id', name: 'ci', token: 'fresh-token' },
    }));
    await keys.run(['create', '--name', 'ci'], {}, { client });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://hub.test/api/auth/keys',
      body: { name: 'ci', enabled: true, accessType: 'all' },
    });
  });

  it('create with --access-type groups and --groups parses CSV', async () => {
    const { client, calls } = makeClient(() => ({
      success: true,
      data: { id: 'x', name: 'g-only' },
    }));
    await keys.run(
      ['create', '--name', 'g-only', '--access-type', 'groups', '--groups', 'dev, prod'],
      {},
      { client },
    );
    expect(calls[0].body).toEqual({
      name: 'g-only',
      enabled: true,
      accessType: 'groups',
      allowedGroups: ['dev', 'prod'],
    });
  });

  it('create with invalid --access-type throws CliUsageError', async () => {
    const { client } = makeClient(() => ({}));
    await expect(
      keys.run(['create', '--name', 'x', '--access-type', 'bogus'], {}, { client }),
    ).rejects.toThrow(/Invalid --access-type/);
  });

  it('delete calls DELETE /api/auth/keys/:id', async () => {
    const { client, calls } = makeClient(() => ({ success: true }));
    await keys.run(['delete', 'abc'], {}, { client });
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: 'http://hub.test/api/auth/keys/abc',
    });
  });
});
