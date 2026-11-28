type EffectRecord = {
  callback: () => void | (() => void);
  deps?: unknown[];
};

const states: unknown[] = [];
const memos: Array<{ value: unknown; deps?: unknown[] }> = [];
const prevEffects: Array<EffectRecord | undefined> = [];
let pendingEffects: Array<{ index: number; record: EffectRecord }> = [];
let stateCursor = 0;
let memoCursor = 0;
let effectCursor = 0;

const depsChanged = (prev?: unknown[], next?: unknown[]) => {
  if (!prev || !next || prev.length !== next.length) {
    return true;
  }
  return next.some((value, i) => !Object.is(value, prev[i]));
};

jest.mock('react', () => ({
  useState: (initial: unknown) => {
    const idx = stateCursor++;
    if (!(idx in states)) {
      states[idx] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    }
    const setter = (next: unknown) => {
      states[idx] =
        typeof next === 'function' ? (next as (prev: unknown) => unknown)(states[idx]) : next;
    };
    return [states[idx], setter];
  },
  useMemo: (factory: () => unknown, deps?: unknown[]) => {
    const idx = memoCursor++;
    const previous = memos[idx];
    if (!previous || depsChanged(previous.deps, deps)) {
      memos[idx] = { value: factory(), deps };
    }
    return memos[idx].value;
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (callback: () => void | (() => void), deps?: unknown[]) => {
    const idx = effectCursor++;
    const previous = prevEffects[idx];
    if (!previous || depsChanged(previous.deps, deps)) {
      pendingEffects.push({ index: idx, record: { callback, deps } });
    }
  },
}));

import { useNewTools, useToolBaselines } from '../../frontend/src/hooks/useNewTools';
import { knownToolsStorageKey } from '../../frontend/src/utils/toolChanges';

const renderHook = <T>(render: () => T): T => {
  stateCursor = 0;
  memoCursor = 0;
  effectCursor = 0;
  pendingEffects = [];
  render();
  const queue = pendingEffects;
  pendingEffects = [];
  for (const { index, record } of queue) {
    prevEffects[index] = record;
    record.callback();
  }
  // Render again so the result shows the state that the effects set.
  stateCursor = 0;
  memoCursor = 0;
  effectCursor = 0;
  return render();
};

const installStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const localStorage = {
    getItem: jest.fn((key: string) => data.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  });
  return { localStorage, data };
};

const server = {
  name: 'github',
  tools: [{ name: 'github__search' }, { name: 'github__merge' }],
};
const key = knownToolsStorageKey('alice');

describe('useNewTools', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    states.length = 0;
    memos.length = 0;
    prevEffects.length = 0;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
  });

  it('does not store a baseline before settings and auth are loaded', () => {
    const { localStorage } = installStorage();
    // While /settings is in flight, the separator is still the '-' default.
    const result = renderHook(() => useNewTools(server, '-', undefined, false));
    expect(result.newTools).toEqual([]);
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('stores upstream names once the custom separator is loaded', () => {
    const { data } = installStorage();
    renderHook(() => useNewTools(server, '-', undefined, false));
    const result = renderHook(() => useNewTools(server, '__', 'alice', true));
    expect(result.newTools).toEqual([]);
    expect(JSON.parse(data.get(key) ?? '{}')).toEqual({ github: ['search', 'merge'] });
  });

  it('does not acknowledge before it is ready', () => {
    const { localStorage } = installStorage();
    const result = renderHook(() => useNewTools(server, '-', undefined, false));
    result.acknowledge();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not run again when a poll returns the same tools in a new array', () => {
    const { localStorage } = installStorage();
    renderHook(() => useNewTools(server, '__', 'alice', true));
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    const polled = { ...server, tools: server.tools.map((tool) => ({ ...tool })) };
    renderHook(() => useNewTools(polled, '__', 'alice', true));
    expect(localStorage.getItem).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('reports tools that are not in the stored baseline', () => {
    installStorage({ [key]: JSON.stringify({ github: ['search'] }) });
    const result = renderHook(() => useNewTools(server, '__', 'alice', true));
    expect(result.newTools).toEqual(['merge']);
  });
});

describe('useToolBaselines', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const servers = [server, { name: 'slack', tools: [{ name: 'slack__post' }] }];

  beforeEach(() => {
    states.length = 0;
    memos.length = 0;
    prevEffects.length = 0;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  it('waits until it is ready', () => {
    const { localStorage } = installStorage();
    renderHook(() => useToolBaselines(servers, '-', undefined, false));
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('sets a baseline for every server, also servers on other pages', () => {
    const { data } = installStorage({ [key]: JSON.stringify({ github: ['search'] }) });
    renderHook(() => useToolBaselines(servers, '__', 'alice', true));
    expect(JSON.parse(data.get(key) ?? '{}')).toEqual({ github: ['search'], slack: ['post'] });
  });
});
