import * as tools from '../../../src/cli/commands/tools.js';
import { ApiClient } from '../../../src/cli/http.js';

function makeClient(body: unknown) {
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    } as unknown as Response)) as unknown as typeof fetch;
  return new ApiClient({ baseUrl: 'http://hub.test', token: 't', fetchImpl });
}

const SERVERS_RESPONSE = {
  success: true,
  data: [
    {
      name: 'fetch',
      status: 'connected',
      tools: [
        {
          name: 'fetch_url',
          description: 'Fetch a URL',
          enabled: true,
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Target URL' },
              timeout: { type: 'number', description: 'Timeout in ms' },
            },
            required: ['url'],
          },
        },
      ],
    },
    {
      name: 'time',
      status: 'connected',
      tools: [
        {
          name: 'current_time',
          description: 'Current time',
          enabled: true,
          inputSchema: { type: 'object', properties: {} },
        },
        {
          // Same tool name as fetch.fetch_url — disambiguation case.
          name: 'fetch_url',
          description: 'Fetch a URL (time-version)',
          enabled: false,
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    },
  ],
};

describe('tools command', () => {
  it('list --json returns the flattened tools without schemas by default', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    const captured: string[] = [];
    const orig = process.stdout.write;
    (process.stdout as any).write = (c: any) => {
      captured.push(String(c));
      return true;
    };
    try {
      await tools.run(['list'], { json: true }, { client });
    } finally {
      (process.stdout as any).write = orig;
    }
    const parsed = JSON.parse(captured.join(''));
    expect(parsed).toEqual([
      { server: 'fetch', serverStatus: 'connected', name: 'fetch_url', description: 'Fetch a URL', enabled: true },
      { server: 'time', serverStatus: 'connected', name: 'current_time', description: 'Current time', enabled: true },
      { server: 'time', serverStatus: 'connected', name: 'fetch_url', description: 'Fetch a URL (time-version)', enabled: false },
    ]);
  });

  it('list --schema includes the inputSchema field', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    const captured: string[] = [];
    const orig = process.stdout.write;
    (process.stdout as any).write = (c: any) => {
      captured.push(String(c));
      return true;
    };
    try {
      await tools.run(['list', '--schema'], { json: true }, { client });
    } finally {
      (process.stdout as any).write = orig;
    }
    const parsed = JSON.parse(captured.join(''));
    expect(parsed[0].inputSchema).toBeDefined();
  });

  it('list --server filters to one server', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    const captured: string[] = [];
    const orig = process.stdout.write;
    (process.stdout as any).write = (c: any) => {
      captured.push(String(c));
      return true;
    };
    try {
      await tools.run(['list', '--server', 'fetch'], { json: true }, { client });
    } finally {
      (process.stdout as any).write = orig;
    }
    const parsed = JSON.parse(captured.join(''));
    expect(parsed.every((t: any) => t.server === 'fetch')).toBe(true);
  });

  it('list --enabled-only drops disabled tools', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    const captured: string[] = [];
    const orig = process.stdout.write;
    (process.stdout as any).write = (c: any) => {
      captured.push(String(c));
      return true;
    };
    try {
      await tools.run(['list', '--enabled-only'], { json: true }, { client });
    } finally {
      (process.stdout as any).write = orig;
    }
    const parsed = JSON.parse(captured.join(''));
    expect(parsed.find((t: any) => t.name === 'fetch_url' && t.server === 'time')).toBeUndefined();
  });

  it('get <name> returns the tool with schema when a single match exists', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    const captured: string[] = [];
    const orig = process.stdout.write;
    (process.stdout as any).write = (c: any) => {
      captured.push(String(c));
      return true;
    };
    try {
      await tools.run(['get', 'current_time'], { json: true }, { client });
    } finally {
      (process.stdout as any).write = orig;
    }
    const parsed = JSON.parse(captured.join(''));
    expect(parsed.name).toBe('current_time');
    expect(parsed.server).toBe('time');
    expect(parsed.inputSchema).toBeDefined();
  });

  it('get errors helpfully when the tool name is ambiguous', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    await expect(tools.run(['get', 'fetch_url'], {}, { client })).rejects.toThrow(
      /exists on multiple servers \(fetch, time\)/,
    );
  });

  it('get --server disambiguates', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    const captured: string[] = [];
    const orig = process.stdout.write;
    (process.stdout as any).write = (c: any) => {
      captured.push(String(c));
      return true;
    };
    try {
      await tools.run(['get', 'fetch_url', '--server', 'fetch'], { json: true }, { client });
    } finally {
      (process.stdout as any).write = orig;
    }
    const parsed = JSON.parse(captured.join(''));
    expect(parsed.server).toBe('fetch');
    expect(parsed.inputSchema.required).toEqual(['url']);
  });

  it('get on a missing tool suggests `tools list`', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    await expect(tools.run(['get', 'nosuch'], {}, { client })).rejects.toThrow(/mcphub tools list/);
  });

  it('schema is an alias for get', async () => {
    const client = makeClient(SERVERS_RESPONSE);
    const captured: string[] = [];
    const orig = process.stdout.write;
    (process.stdout as any).write = (c: any) => {
      captured.push(String(c));
      return true;
    };
    try {
      await tools.run(['schema', 'current_time'], { json: true }, { client });
    } finally {
      (process.stdout as any).write = orig;
    }
    const parsed = JSON.parse(captured.join(''));
    expect(parsed.name).toBe('current_time');
  });
});
