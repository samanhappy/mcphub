const apiGet = jest.fn();
const apiPost = jest.fn();

type EffectRecord = {
  callback: () => void | (() => void);
  deps?: unknown[];
};

const states: unknown[] = [];
const refs: Array<{ current: unknown }> = [];
const prevEffects: Array<EffectRecord | undefined> = [];
let pendingEffects: Array<{ index: number; record: EffectRecord }> = [];
let stateCursor = 0;
let refCursor = 0;
let effectCursor = 0;

const resetHookRuntime = () => {
  states.length = 0;
  refs.length = 0;
  prevEffects.length = 0;
  pendingEffects = [];
  stateCursor = 0;
  refCursor = 0;
  effectCursor = 0;
};

const beginRender = () => {
  stateCursor = 0;
  refCursor = 0;
  effectCursor = 0;
  pendingEffects = [];
};

const flushEffects = () => {
  const queue = pendingEffects;
  pendingEffects = [];
  for (const { index, record } of queue) {
    prevEffects[index] = record;
    record.callback();
  }
};

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
  useRef: (initial: unknown) => {
    const idx = refCursor++;
    if (!(idx in refs)) {
      refs[idx] = { current: initial };
    }
    return refs[idx];
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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../frontend/src/utils/fetchInterceptor', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
}));

import { MARKET_PER_PAGE_KEY } from '../../frontend/src/utils/marketPagination';
import { useMarketData } from '../../frontend/src/hooks/useMarketData';
import { useRegistryData } from '../../frontend/src/hooks/useRegistryData';

const createMockWindowStorage = () => {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: jest.fn((key: string) => store.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
    }),
    clear: jest.fn(() => {
      store.clear();
    }),
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  });
  return localStorage;
};

const renderHook = <T,>(render: () => T): T => {
  beginRender();
  const result = render();
  flushEffects();
  return result;
};

describe('Market pagination hooks', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    resetHookRuntime();
    apiGet.mockReset();
    apiPost.mockReset();
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

  describe('useMarketData', () => {
    const makeServers = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        name: `server-${i + 1}`,
        display_name: `Server ${i + 1}`,
        description: '',
        categories: [],
        tags: [],
      }));

    it('restores saved page size from localStorage and persists updates', async () => {
      const storage = createMockWindowStorage();
      storage.setItem(MARKET_PER_PAGE_KEY, '24');

      apiGet.mockImplementation(async (url: string) => {
        if (url === '/market/servers') return { success: true, data: makeServers(30) };
        if (url === '/market/categories') return { success: true, data: [] };
        if (url === '/market/tags') return { success: true, data: [] };
        if (url === '/servers') return { success: true, data: [] };
        return { success: false };
      });

      renderHook(() => useMarketData());
      await Promise.resolve();
      let hook = renderHook(() => useMarketData());

      expect(hook.serversPerPage).toBe(24);
      expect(hook.servers).toHaveLength(24);
      expect(hook.totalPages).toBe(2);

      hook.changeServersPerPage(12);
      hook = renderHook(() => useMarketData());

      expect(storage.setItem).toHaveBeenCalledWith(MARKET_PER_PAGE_KEY, '12');
      expect(hook.serversPerPage).toBe(12);
      expect(hook.servers).toHaveLength(12);

      // Re-fetching (e.g. clearing a filter) must keep the updated page size instead of a stale closure.
      await hook.fetchMarketServers();
      hook = renderHook(() => useMarketData());

      expect(hook.serversPerPage).toBe(12);
      expect(hook.servers).toHaveLength(12);
    });

    it('syncs in-memory pagination when shared external page size changes', async () => {
      createMockWindowStorage();

      apiGet.mockImplementation(async (url: string) => {
        if (url === '/market/servers') return { success: true, data: makeServers(30) };
        return { success: true, data: [] };
      });

      renderHook(() => useMarketData(9));
      await Promise.resolve();
      let hook = renderHook(() => useMarketData(9));
      expect(hook.servers).toHaveLength(9);

      renderHook(() => useMarketData(24));
      hook = renderHook(() => useMarketData(24));
      expect(hook.serversPerPage).toBe(24);
      expect(hook.servers).toHaveLength(24);
    });
  });

  describe('useRegistryData', () => {
    const makeRegistryResponse = (count: number, nextCursor?: string, prefix = 'p') => ({
      success: true,
      data: {
        servers: Array.from({ length: count }, (_, i) => ({
          server: { name: `io.example/${prefix}-server-${i + 1}` },
        })),
        metadata: { count, nextCursor },
      },
    });

    it('immediately requests with the new limit and persists it on changeServersPerPage', async () => {
      const storage = createMockWindowStorage();
      storage.setItem(MARKET_PER_PAGE_KEY, '24');

      apiGet.mockResolvedValue(makeRegistryResponse(24, 'cursor-1'));

      renderHook(() => useRegistryData({ active: true }));
      await Promise.resolve();
      let hook = renderHook(() => useRegistryData({ active: true }));

      expect(apiGet).toHaveBeenCalledWith('/registry/servers?limit=24');
      expect(hook.serversPerPage).toBe(24);

      apiGet.mockClear();
      apiGet.mockResolvedValue(makeRegistryResponse(12, 'cursor-2'));

      await hook.changeServersPerPage(12);
      hook = renderHook(() => useRegistryData({ active: true }));

      expect(storage.setItem).toHaveBeenCalledWith(MARKET_PER_PAGE_KEY, '12');
      expect(apiGet).toHaveBeenCalledTimes(1);
      expect(apiGet).toHaveBeenCalledWith('/registry/servers?limit=12');
      expect(hook.serversPerPage).toBe(12);
    });

    it('defers registry fetch while inactive and syncs to the updated shared page size on activation', async () => {
      createMockWindowStorage();
      apiGet.mockResolvedValue(makeRegistryResponse(24, 'cursor-1'));

      // Inactive while user is on the local tab.
      renderHook(() => useRegistryData({ serversPerPage: 9, active: false }));
      expect(apiGet).not.toHaveBeenCalled();

      // User changes page size on the local tab: still no network call for registry.
      renderHook(() => useRegistryData({ serversPerPage: 24, active: false }));
      expect(apiGet).not.toHaveBeenCalled();

      // User switches to the registry tab: fetches once with the updated shared page size.
      renderHook(() => useRegistryData({ serversPerPage: 24, active: true }));
      await Promise.resolve();

      expect(apiGet).toHaveBeenCalledTimes(1);
      expect(apiGet).toHaveBeenCalledWith('/registry/servers?limit=24');

      // Switching away and back with the same page size does not trigger a redundant fetch.
      apiGet.mockClear();
      renderHook(() => useRegistryData({ serversPerPage: 24, active: false }));
      renderHook(() => useRegistryData({ serversPerPage: 24, active: true }));
      expect(apiGet).not.toHaveBeenCalled();
    });

    it('restores exact page cursors on Prev from page 3 without duplicating allServers', async () => {
      createMockWindowStorage();

      apiGet.mockImplementation(async (url: string) => {
        if (url === '/registry/servers?limit=9') return makeRegistryResponse(9, 'c1', 'p1');
        if (url === '/registry/servers?limit=9&cursor=c1') return makeRegistryResponse(9, 'c2', 'p2');
        if (url === '/registry/servers?limit=9&cursor=c2') return makeRegistryResponse(4, undefined, 'p3');
        return { success: false };
      });

      // Page 1
      renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      await Promise.resolve();
      let hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      expect(hook.currentPage).toBe(1);
      expect(hook.allServers).toHaveLength(9);

      // Page 1 -> Page 2 (cursor=c1)
      await hook.goToNextPage();
      hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      expect(hook.currentPage).toBe(2);
      expect(hook.servers[0].server.name).toBe('io.example/p2-server-1');
      expect(hook.allServers).toHaveLength(18);

      // Page 2 -> Page 3 (cursor=c2)
      await hook.goToNextPage();
      hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      expect(hook.currentPage).toBe(3);
      expect(hook.servers[0].server.name).toBe('io.example/p3-server-1');
      expect(hook.allServers).toHaveLength(22);

      // Page 3 -> Page 2 must request cursor=c1 (not page 1) and keep allServers at 22
      apiGet.mockClear();
      await hook.goToPreviousPage();
      hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      expect(apiGet).toHaveBeenCalledWith('/registry/servers?limit=9&cursor=c1');
      expect(hook.currentPage).toBe(2);
      expect(hook.servers[0].server.name).toBe('io.example/p2-server-1');
      expect(hook.allServers).toHaveLength(22);

      // Page 2 -> Page 1 must omit cursor
      apiGet.mockClear();
      await hook.goToPreviousPage();
      hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      expect(apiGet).toHaveBeenCalledWith('/registry/servers?limit=9');
      expect(hook.currentPage).toBe(1);
      expect(hook.servers[0].server.name).toBe('io.example/p1-server-1');
      expect(hook.allServers).toHaveLength(9);
    });

    it('keeps currentPage and cursor history intact when a Next/Prev request fails', async () => {
      createMockWindowStorage();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      apiGet
        .mockResolvedValueOnce(makeRegistryResponse(9, 'c1', 'p1'))
        .mockResolvedValueOnce(makeRegistryResponse(9, 'c2', 'p2'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(makeRegistryResponse(9, 'c3', 'p3'));

      renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      await Promise.resolve();
      let hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));

      await hook.goToNextPage();
      hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      expect(hook.currentPage).toBe(2);

      // Failed Next should keep currentPage at 2 so retry still advances to Page 3 with cursor=c2.
      await hook.goToNextPage();
      hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      expect(hook.currentPage).toBe(2);

      await hook.goToNextPage();
      hook = renderHook(() => useRegistryData({ serversPerPage: 9, active: true }));
      expect(apiGet).toHaveBeenLastCalledWith('/registry/servers?limit=9&cursor=c2');
      expect(hook.currentPage).toBe(3);

      errorSpy.mockRestore();
    });
  });
});
