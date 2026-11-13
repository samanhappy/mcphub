import { remainingListTtl, preserveListFreshness } from '../../src/utils/listFreshness.js';
import { InMemoryTransport, Server } from '@modelcontextprotocol/server';
import { LegacyMcpClient } from '../../src/clients/legacyMcpClient.js';
import { LEGACY_PROTOCOL_VERSIONS } from '../../src/utils/mcpProtocol.js';
import { ResilientJsonSchemaValidator } from '../../src/utils/jsonSchemaValidator.js';

describe('SDK v2 with legacy protocol behavior', () => {
  let server: Server;
  let client: LegacyMcpClient;
  const listTools = jest.fn();
  const callTool = jest.fn();
  const requests: string[] = [];

  beforeEach(async () => {
    requests.length = 0;
    listTools.mockReset().mockResolvedValue({
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
    });
    callTool.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    server = new Server(
      { name: 'legacy-upstream', version: '1' },
      {
        supportedProtocolVersions: LEGACY_PROTOCOL_VERSIONS,
        capabilities: { tools: { listChanged: true }, prompts: {}, resources: {} },
      },
    );
    server.setRequestHandler('tools/list', listTools);
    server.setRequestHandler('tools/call', callTool);
    server.setRequestHandler('prompts/list', async () => ({ prompts: [] }));
    server.setRequestHandler('resources/list', async () => ({ resources: [] }));
    server.setRequestHandler('resources/templates/list', async () => ({
      resourceTemplates: [],
    }));
    client = new LegacyMcpClient(
      { name: 'mcphub', version: '1' },
      {
        jsonSchemaValidator: new ResilientJsonSchemaValidator(),
        listChanged: { tools: { debounceMs: 0, onChanged: jest.fn() } },
      },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const onmessage = serverTransport.onmessage!;
    serverTransport.onmessage = (message, extra) => {
      if ('method' in message) requests.push(message.method);
      onmessage(message, extra);
    };
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('does not certify an obsolete discovery response that finishes after a newer refresh', async () => {
    let finish!: (result: { tools: []; ttlMs: number }) => void;
    listTools.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    listTools.mockResolvedValue({ tools: [], ttlMs: 60000 });
    const pending = client.listTools({});
    for (let i = 0; i < 100 && !finish; i++) await Promise.resolve();
    expect(finish).toBeDefined();
    const newest = await client.listTools({});
    finish({ tools: [], ttlMs: 60000 });
    const obsolete = await pending;
    const now = performance.now();
    expect(remainingListTtl([obsolete.tools], now, now)).toBe(0);
    expect(remainingListTtl([newest.tools], now, now)).toBe(5000);
  });

  it('tracks all four list envelopes and refuses cyclic pagination', async () => {
    listTools.mockResolvedValue({ tools: [], ttlMs: 60000 });
    server.setRequestHandler('prompts/list', async () => ({ prompts: [], ttlMs: 60000 }));
    server.setRequestHandler('resources/list', async () => ({ resources: [], ttlMs: 60000 }));
    server.setRequestHandler('resources/templates/list', async () => ({
      resourceTemplates: [],
      ttlMs: 60000,
    }));
    const snapshots = [
      (await client.listTools({})).tools,
      (await client.listPrompts({})).prompts,
      (await client.listResources({})).resources,
      (await client.listResourceTemplates({})).resourceTemplates,
    ];
    const now = performance.now();
    expect(remainingListTtl(snapshots, now, now)).toBe(5000);
    listTools.mockResolvedValue({ tools: [], ttlMs: 60000, nextCursor: 'more' });
    await expect(client.listTools({})).rejects.toThrow('Invalid tools pagination');
  });

  it('revokes discovery freshness while a list-change refresh is still running', async () => {
    listTools.mockResolvedValue({ tools: [], ttlMs: 60000 });
    const { tools } = await client.listTools({});
    const normalized = preserveListFreshness(tools, [...tools]);
    let finish!: (result: { tools: []; ttlMs: number }) => void;
    listTools.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await server.sendToolListChanged();
    for (let i = 0; i < 100 && !finish; i++) await Promise.resolve();
    expect(finish).toBeDefined();
    const now = performance.now();
    expect(remainingListTtl([normalized], now, now)).toBe(0);
    finish({ tools: [], ttlMs: 60000 });
  });

  it('captures real discovery envelopes and invalidates normalized snapshots on refresh and close', async () => {
    listTools.mockResolvedValue({
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
      ttlMs: 60000,
    });
    const result = await client.listTools({});
    const normalized = preserveListFreshness(result.tools, [...result.tools]);
    const now = performance.now();
    expect(remainingListTtl([normalized], now, now)).toBe(5000);
    listTools.mockRejectedValueOnce(new Error('refresh failed'));
    await expect(client.listTools({})).rejects.toThrow('refresh failed');
    expect(remainingListTtl([normalized], now, performance.now())).toBe(0);
    const fresh = await client.listTools({});
    await client.close();
    expect(remainingListTtl([fresh.tools], now, performance.now())).toBe(0);
  });

  it.each([
    ['tools/list', 'tools', (entry: LegacyMcpClient) => entry.listTools({})],
    ['prompts/list', 'prompts', (entry: LegacyMcpClient) => entry.listPrompts({})],
    ['resources/list', 'resources', (entry: LegacyMcpClient) => entry.listResources({})],
    [
      'resources/templates/list',
      'resourceTemplates',
      (entry: LegacyMcpClient) => entry.listResourceTemplates({}),
    ],
  ] as const)(
    'reads every page of %s, including empty intermediate pages',
    async (method, field, list) => {
      const cursors: unknown[] = [];
      const tool = {
        name: 'last-page',
        ...(field === 'tools' ? { inputSchema: { type: 'object' } } : {}),
        ...(field === 'resources' ? { uri: 'test://last-page' } : {}),
        ...(field === 'resourceTemplates' ? { uriTemplate: 'test://{name}' } : {}),
      };
      server.setRequestHandler(method, async (request) => {
        const cursor = request.params?.cursor;
        cursors.push(cursor);
        if (!cursor) return { [field]: [tool], nextCursor: 'page-2', ttlMs: 60000 };
        if (cursor === 'page-2') return { [field]: [], nextCursor: 'page-3' };
        return { [field]: [tool] };
      });
      const result = await list(client);
      expect(result).toMatchObject({ [field]: [tool, tool] });
      expect(result.nextCursor).toBeUndefined();
      expect(cursors).toEqual([undefined, 'page-2', 'page-3']);
      const now = performance.now();
      expect(
        remainingListTtl([(result as Record<string, unknown>)[field] as object], now, now),
      ).toBe(0);
    },
  );

  it('rejects excessive pagination instead of publishing a truncated list', async () => {
    let page = 0;
    listTools.mockImplementation(async () => ({ tools: [], nextCursor: String(++page) }));
    await expect(client.listTools()).rejects.toThrow('Invalid tools pagination');
    expect(listTools).toHaveBeenCalledTimes(101);
  });

  it('preserves request options and rejects a failed later page', async () => {
    const failure = new Error('page failed');
    const request = jest.spyOn(client, 'request');
    listTools.mockResolvedValueOnce({ tools: [], nextCursor: 'page-2' });
    listTools.mockRejectedValueOnce(failure);
    const options = { timeout: 1234, signal: new AbortController().signal };
    await expect(client.listTools({ cursor: 'start' }, options)).rejects.toThrow('page failed');
    expect(request).toHaveBeenNthCalledWith(
      1,
      { method: 'tools/list', params: { cursor: 'start' } },
      options,
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      { method: 'tools/list', params: { cursor: 'page-2' } },
      options,
    );
    request.mockRestore();
  });

  it('keeps initialize/initialized and unpaginated discovery for every list method', async () => {
    expect(requests).toEqual(['initialize', 'notifications/initialized']);
    expect(client.getProtocolEra()).toBe('legacy');
    expect((await client.listTools({})).nextCursor).toBeUndefined();
    expect((await client.listPrompts({})).nextCursor).toBeUndefined();
    expect((await client.listResources({})).nextCursor).toBeUndefined();
    expect((await client.listResourceTemplates({})).nextCursor).toBeUndefined();
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'prompts/list',
      'resources/list',
      'resources/templates/list',
    ]);
  });

  it('retains output validation for tools discovered on later pages', async () => {
    listTools.mockResolvedValue({
      tools: [
        {
          name: 'echo',
          inputSchema: { type: 'object' },
          outputSchema: {
            type: 'object',
            properties: { value: { type: 'number' } },
            required: ['value'],
          },
        },
      ],
    });
    listTools.mockResolvedValueOnce({ tools: [], nextCursor: 'page-2' });
    await client.listTools();
    callTool.mockResolvedValue({ content: [], structuredContent: { value: 'invalid' } });
    await expect(client.callTool({ name: 'echo' })).rejects.toMatchObject({ code: -32602 });
    callTool.mockResolvedValue({ content: [], structuredContent: { value: 42 } });
    await expect(client.callTool({ name: 'echo' })).resolves.toMatchObject({
      structuredContent: { value: 42 },
    });
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it('continues calling tools whose output schema cannot compile', async () => {
    listTools.mockResolvedValue({
      tools: [
        {
          name: 'echo',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object', properties: { value: { $ref: '#/$defs/Missing' } } },
        },
      ],
    });
    await client.listTools();
    callTool.mockResolvedValue({ content: [], structuredContent: { value: 42 } });
    await expect(client.callTool({ name: 'echo' })).resolves.toMatchObject({
      structuredContent: { value: 42 },
    });
  });
});

describe('opt-in modern upstream negotiation', () => {
  it('probes in auto mode and falls back to the legacy preference list', async () => {
    const server = new Server(
      { name: 'modern', version: '1' },
      {
        supportedProtocolVersions: ['2026-07-28', ...LEGACY_PROTOCOL_VERSIONS],
        capabilities: { tools: {} },
      },
    );
    server.setRequestHandler('tools/list', async () => ({ tools: [], ttlMs: 1000 }));
    const client = new LegacyMcpClient(
      { name: 'hub', version: '1' },
      {
        versionNegotiation: { mode: 'auto' },
      },
    );
    const [upstream, downstream] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(downstream);
      const methods: string[] = [];
      const receive = downstream.onmessage!;
      downstream.onmessage = (message, extra) => {
        if ('method' in message) methods.push(message.method);
        receive(message, extra);
      };
      await client.connect(upstream);
      expect(methods).toContain('server/discover');
      expect(client.getProtocolEra()).toBe('legacy');
      expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
      await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
