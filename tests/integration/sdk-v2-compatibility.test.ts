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
      nextCursor: 'second-page',
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
    server.setRequestHandler('prompts/list', async () => ({ prompts: [], nextCursor: 'more' }));
    server.setRequestHandler('resources/list', async () => ({ resources: [], nextCursor: 'more' }));
    server.setRequestHandler('resources/templates/list', async () => ({
      resourceTemplates: [],
      nextCursor: 'more',
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

  it('tracks all four list envelopes and refuses TTL on incomplete pages', async () => {
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
    const partial = await client.listTools({});
    expect(remainingListTtl([partial.tools], now, performance.now())).toBe(0);
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

  it('keeps initialize/initialized and single-page discovery for every list method', async () => {
    expect(requests).toEqual(['initialize', 'notifications/initialized']);
    expect(client.getProtocolEra()).toBe('legacy');
    expect((await client.listTools({})).nextCursor).toBe('second-page');
    expect((await client.listPrompts({})).nextCursor).toBe('more');
    expect((await client.listResources({})).nextCursor).toBe('more');
    expect((await client.listResourceTemplates({})).nextCursor).toBe('more');
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

  it('retains output validation after single-page discovery', async () => {
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
    await client.listTools();
    callTool.mockResolvedValue({ content: [], structuredContent: { value: 'invalid' } });
    await expect(client.callTool({ name: 'echo' })).rejects.toMatchObject({ code: -32602 });
    callTool.mockResolvedValue({ content: [], structuredContent: { value: 42 } });
    await expect(client.callTool({ name: 'echo' })).resolves.toMatchObject({
      structuredContent: { value: 42 },
    });
    expect(listTools).toHaveBeenCalledTimes(1);
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
