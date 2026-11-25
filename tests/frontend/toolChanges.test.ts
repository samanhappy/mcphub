import {
  getToolNames,
  knownToolsFor,
  knownToolsStorageKey,
  readKnownTools,
  reconcileKnownTools,
  writeKnownTools,
} from '../../frontend/src/utils/toolChanges';

const server = (tools: string[]) => ({
  name: 'github',
  tools: tools.map((name) => ({ name: `github-${name}` })),
});

const names = (tools: string[]) => getToolNames(server(tools), '-');

const memoryStore = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

describe('reconcileKnownTools', () => {
  it('stores the first tool list as the baseline without new tools', () => {
    expect(reconcileKnownTools(undefined, names(['search', 'create_issue']))).toEqual({
      known: ['search', 'create_issue'],
      newTools: [],
    });
  });

  it('reports tools that are not in the baseline', () => {
    expect(reconcileKnownTools(['search'], names(['search', 'create_issue', 'merge']))).toEqual({
      known: ['search'],
      newTools: ['create_issue', 'merge'],
    });
  });

  it('reports nothing when a reconnect returns the same tools in another order', () => {
    expect(reconcileKnownTools(['a', 'b'], names(['b', 'a'])).newTools).toEqual([]);
  });

  it('does not report a removed tool', () => {
    expect(reconcileKnownTools(['a', 'b'], names(['a'])).newTools).toEqual([]);
  });

  it('keeps no baseline while a server has not reported tools', () => {
    expect(reconcileKnownTools(undefined, names([]))).toEqual({
      known: undefined,
      newTools: [],
    });
  });

  it('ignores disabled servers', () => {
    expect(reconcileKnownTools(['a'], names(['a', 'b']), false)).toEqual({
      known: ['a'],
      newTools: [],
    });
  });

  it('compares upstream names, so a separator change does not flag every tool', () => {
    const renamed = { name: 'github', tools: [{ name: 'github__a' }, { name: 'github__b' }] };
    expect(reconcileKnownTools(['a', 'b'], getToolNames(renamed, '__')).newTools).toEqual([]);
  });
});

describe('getToolNames', () => {
  it('keeps names that do not carry the server prefix', () => {
    expect(getToolNames({ name: 'x', tools: [{ name: 'plain' }] }, '-')).toEqual(['plain']);
  });

  it('uses the backend default separator when the separator is empty', () => {
    expect(getToolNames({ name: 'x', tools: [{ name: 'x-a' }] }, '')).toEqual(['a']);
  });
});

describe('knownToolsFor', () => {
  it('ignores inherited keys, so a server named constructor gets a baseline', () => {
    expect(knownToolsFor({}, 'constructor')).toBeUndefined();
    expect(knownToolsFor({ constructor: ['a'] }, 'constructor')).toEqual(['a']);
  });
});

describe('known tools storage', () => {
  it('scopes the key by user', () => {
    expect(knownToolsStorageKey('alice')).not.toBe(knownToolsStorageKey('bob'));
  });

  it('round-trips the baseline', () => {
    const store = memoryStore();
    writeKnownTools(store, 'k', { github: ['a'] });
    expect(readKnownTools(store, 'k')).toEqual({ github: ['a'] });
  });

  it('returns an empty baseline for missing or malformed data', () => {
    expect(readKnownTools(memoryStore(), 'k')).toEqual({});
    expect(readKnownTools(memoryStore({ k: 'not json' }), 'k')).toEqual({});
    expect(readKnownTools(memoryStore({ k: '{"github":[1]}' }), 'k')).toEqual({});
  });
});
