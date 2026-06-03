import {
  countTokens,
  serializeToolDefinition,
  serializePromptDefinition,
  serializeResourceDefinition,
  itemCostForTool,
} from '../../src/utils/tokenCost.js';

describe('tokenCost', () => {
  it('counts tokens of a string with cl100k (non-zero, deterministic)', async () => {
    const a = await countTokens('hello world');
    const b = await countTokens('hello world');
    expect(a).toBeGreaterThan(0);
    expect(a).toBe(b);
  });

  it('counts more tokens for longer text', async () => {
    const short = await countTokens('a');
    const long = await countTokens('the quick brown fox jumps over the lazy dog repeatedly');
    expect(long).toBeGreaterThan(short);
  });

  it('serializes a tool definition as JSON of name, description, inputSchema', () => {
    const text = serializeToolDefinition({
      name: 'fetch_url',
      description: 'Fetch a URL',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    });
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({
      name: 'fetch_url',
      description: 'Fetch a URL',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    });
  });

  it('serializes a tool with a large schema to more characters than a small one', () => {
    const small = serializeToolDefinition({ name: 't', description: 'd', inputSchema: {} });
    const big = serializeToolDefinition({
      name: 't',
      description: 'd',
      inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } },
    });
    expect(big.length).toBeGreaterThan(small.length);
  });

  it('tolerates missing description/inputSchema', () => {
    const text = serializeToolDefinition({ name: 'bare' } as any);
    const parsed = JSON.parse(text);
    expect(parsed.name).toBe('bare');
    expect(parsed.description).toBe('');
    expect(parsed.inputSchema).toEqual({});
  });

  it('serializes prompt and resource definitions', () => {
    expect(JSON.parse(serializePromptDefinition({ name: 'p', description: 'pd', arguments: [] }))).toEqual({
      name: 'p',
      description: 'pd',
      arguments: [],
    });
    expect(
      JSON.parse(serializeResourceDefinition({ uri: 'file://x', name: 'r', description: 'rd', mimeType: 'text/plain' })),
    ).toEqual({ uri: 'file://x', name: 'r', description: 'rd', mimeType: 'text/plain' });
  });

  it('itemCostForTool returns an ItemCost with kind=tool and the tool token count', async () => {
    const tool = { name: 'fetch_url', description: 'Fetch a URL', inputSchema: { type: 'object' }, enabled: true };
    const item = await itemCostForTool(tool);
    expect(item.kind).toBe('tool');
    expect(item.name).toBe('fetch_url');
    expect(item.enabled).toBe(true);
    expect(item.cost).toBe(await countTokens(serializeToolDefinition(tool)));
  });

  it('treats enabled === undefined as exposed (enabled: true)', async () => {
    const item = await itemCostForTool({ name: 'x', description: '', inputSchema: {} } as any);
    expect(item.enabled).toBe(true);
  });
});
