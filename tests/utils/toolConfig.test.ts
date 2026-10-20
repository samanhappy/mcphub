jest.mock('../../src/config/index.js', () => ({
  getNameSeparator: jest.fn(() => '-'),
}));

import {
  applyHiddenParams,
  findToolConfig,
  findToolConfigKey,
  getEffectiveHiddenParams,
  removeHiddenArguments,
} from '../../src/utils/toolConfig.js';

const schema = {
  type: 'object',
  properties: { url: { type: 'string' }, profile: { type: 'object' }, mobile: { type: 'boolean' } },
  required: ['url'],
};

describe('findToolConfig', () => {
  it('finds a config stored under the prefixed or the bare name, prefixed first', () => {
    const bare = { enabled: true, description: 'bare' };
    const prefixed = { enabled: true, description: 'prefixed' };

    expect(findToolConfig({ scrape: bare }, 'fc', 'fc-scrape')).toBe(bare);
    expect(findToolConfig({ 'fc-scrape': prefixed }, 'fc', 'scrape')).toBe(prefixed);
    expect(findToolConfig({ scrape: bare, 'fc-scrape': prefixed }, 'fc', 'scrape')).toBe(prefixed);
  });

  it('ignores inherited object keys', () => {
    expect(findToolConfig({}, 'fc', 'constructor')).toBeUndefined();
    expect(findToolConfig(undefined, 'fc', 'scrape')).toBeUndefined();
  });
});

describe('findToolConfigKey', () => {
  it('returns the existing entry under any name the tool is addressed by', () => {
    expect(findToolConfigKey({ scrape: { enabled: true } }, 'fc', 'fc-scrape')).toBe('scrape');
    expect(findToolConfigKey({ 'fc-scrape': { enabled: true } }, 'fc', 'scrape')).toBe('fc-scrape');
    // Upstream `fc-scrape`: runtime `fc-fc-scrape`, stored under the bare name
    expect(findToolConfigKey({ 'fc-scrape': { enabled: true } }, 'fc', 'fc-fc-scrape')).toBe(
      'fc-scrape',
    );
  });

  it('falls back to the name as given, ignoring inherited keys', () => {
    expect(findToolConfigKey({}, 'fc', 'fc-scrape')).toBe('fc-scrape');
    expect(findToolConfigKey(undefined, 'fc', 'scrape')).toBe('scrape');
    expect(findToolConfigKey({}, 'fc', 'constructor')).toBe('constructor');
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
