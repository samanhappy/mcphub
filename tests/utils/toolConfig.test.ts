jest.mock('../../src/config/index.js', () => ({
  getNameSeparator: jest.fn(() => '-'),
}));

import {
  applyHiddenParams,
  findToolConfig,
  findToolConfigKey,
  resolveRuntimeToolName,
  getEffectiveHiddenParams,
  removeHiddenArguments,
} from '../../src/utils/toolConfig.js';

const schema = {
  type: 'object',
  properties: { url: { type: 'string' }, profile: { type: 'object' }, mobile: { type: 'boolean' } },
  required: ['url'],
};

// Server `fc` with upstream tools `scrape` and `fc-scrape`: runtime names
// `fc-scrape` and `fc-fc-scrape`, so `fc-scrape` is both the first tool's
// runtime name and the second tool's bare name.
const oneTool = ['fc-scrape'];
const twoTools = ['fc-scrape', 'fc-fc-scrape'];

describe('findToolConfig', () => {
  it('finds a config stored under the runtime or the bare name, runtime first', () => {
    const bare = { enabled: true, description: 'bare' };
    const runtime = { enabled: true, description: 'runtime' };

    expect(findToolConfig({ scrape: bare }, 'fc', 'fc-scrape', oneTool)).toBe(bare);
    expect(findToolConfig({ 'fc-scrape': runtime }, 'fc', 'scrape', oneTool)).toBe(runtime);
    expect(findToolConfig({ scrape: bare, 'fc-scrape': runtime }, 'fc', 'fc-scrape', oneTool)).toBe(
      runtime,
    );
  });

  it("never reads another tool's runtime key as a bare name", () => {
    const first = { enabled: false };
    const tools = { 'fc-scrape': first };

    expect(findToolConfig(tools, 'fc', 'fc-scrape', twoTools)).toBe(first);
    expect(findToolConfig(tools, 'fc', 'fc-fc-scrape', twoTools)).toBeUndefined();
    // Alone on its server, `fc-scrape` is the bare name of `fc-fc-scrape`
    expect(findToolConfig(tools, 'fc', 'fc-fc-scrape', ['fc-fc-scrape'])).toBe(first);
  });

  it('ignores inherited object keys', () => {
    expect(findToolConfig({}, 'fc', 'constructor')).toBeUndefined();
    expect(findToolConfig(undefined, 'fc', 'scrape')).toBeUndefined();
  });
});

describe('resolveRuntimeToolName', () => {
  it('prefers a runtime name, then a bare name, and is undefined for an unknown tool', () => {
    expect(resolveRuntimeToolName('fc', 'fc-scrape', twoTools)).toBe('fc-scrape');
    expect(resolveRuntimeToolName('fc', 'scrape', twoTools)).toBe('fc-scrape');
    expect(resolveRuntimeToolName('fc', 'fc-fc-scrape', twoTools)).toBe('fc-fc-scrape');
    expect(resolveRuntimeToolName('fc', 'other', twoTools)).toBeUndefined();
  });
});

describe('findToolConfigKey', () => {
  it("reuses the requested tool's existing entry under either of its names", () => {
    expect(findToolConfigKey({ scrape: { enabled: true } }, 'fc', 'fc-scrape', oneTool)).toBe(
      'scrape',
    );
    expect(findToolConfigKey({ 'fc-scrape': { enabled: true } }, 'fc', 'scrape', oneTool)).toBe(
      'fc-scrape',
    );
    // Upstream `fc-scrape` alone: runtime `fc-fc-scrape`, stored under the bare name
    expect(
      findToolConfigKey({ 'fc-scrape': { enabled: true } }, 'fc', 'fc-fc-scrape', ['fc-fc-scrape']),
    ).toBe('fc-scrape');
  });

  it("never writes to another tool's entry", () => {
    // Only the second tool has an entry; the dashboard addresses the first one
    expect(
      findToolConfigKey({ 'fc-fc-scrape': { enabled: true } }, 'fc', 'fc-scrape', twoTools),
    ).toBe('fc-scrape');
    expect(
      findToolConfigKey({ 'fc-scrape': { enabled: true } }, 'fc', 'fc-fc-scrape', twoTools),
    ).toBe('fc-fc-scrape');
  });

  it('writes an unresolved tool under the name as given, ignoring inherited keys', () => {
    expect(findToolConfigKey({ scrape: { enabled: true } }, 'fc', 'fc-scrape', [])).toBe(
      'fc-scrape',
    );
    expect(findToolConfigKey(undefined, 'fc', 'scrape', oneTool)).toBe('scrape');
    expect(findToolConfigKey({}, 'fc', 'constructor', ['fc-constructor'])).toBe('constructor');
  });
});

describe('hidden parameters', () => {
  const config = { hiddenParams: ['profile', 'url', 'unknown'] };

  it('never hides a required parameter', () => {
    expect(getEffectiveHiddenParams(schema, config)).toEqual(['profile', 'unknown']);
  });

  it('removes hidden properties from the schema and keeps required', () => {
    const tool = applyHiddenParams({ name: 'scrape', inputSchema: schema }, config);

    expect(Object.keys(tool.inputSchema.properties as object)).toEqual(['url', 'mobile']);
    expect(tool.inputSchema.required).toEqual(['url']);
    expect(Object.keys(schema.properties)).toEqual(['url', 'profile', 'mobile']);
  });

  it('returns the same tool when nothing is hidden', () => {
    const tool = { name: 'scrape', inputSchema: schema };

    expect(applyHiddenParams(tool, undefined)).toBe(tool);
    expect(applyHiddenParams(tool, { hiddenParams: [] })).toBe(tool);
  });

  it('drops hidden arguments and leaves anything else alone', () => {
    expect(removeHiddenArguments({ url: 'u', profile: {}, mobile: true }, schema, config)).toEqual({
      url: 'u',
      mobile: true,
    });
    expect(removeHiddenArguments(undefined, schema, config)).toBeUndefined();
    expect(removeHiddenArguments(['profile'], schema, config)).toEqual(['profile']);
  });
});
