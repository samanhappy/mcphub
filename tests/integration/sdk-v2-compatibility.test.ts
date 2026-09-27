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
        capabilities: { tools: {}, prompts: {}, resources: {} },
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
      { jsonSchemaValidator: new ResilientJsonSchemaValidator() },
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
