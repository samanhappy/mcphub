import {
  DEFAULT_MARKET_PER_PAGE,
  MARKET_PAGE_SIZE_OPTIONS,
  MARKET_PER_PAGE_KEY,
  getInitialMarketPerPage,
  normalizeMarketPerPage,
  saveMarketPerPage,
} from '../../frontend/src/utils/marketPagination';

describe('marketPagination', () => {
  const createMemoryStorage = (initial: Record<string, string> = {}) => {
    const store = new Map<string, string>(Object.entries(initial));
    return {
      getItem: jest.fn((key: string) => store.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => {
        store.set(key, value);
      }),
    };
  };

  describe('normalizeMarketPerPage', () => {
    it('accepts all supported Market page sizes', () => {
      for (const size of MARKET_PAGE_SIZE_OPTIONS) {
        expect(normalizeMarketPerPage(size)).toBe(size);
      }
    });

    it('falls back to default for unsupported values', () => {
      for (const invalid of [0, -6, 5, 10, 15, 50, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(normalizeMarketPerPage(invalid)).toBe(DEFAULT_MARKET_PER_PAGE);
      }
    });
  });

  describe('getInitialMarketPerPage', () => {
    it('returns default when storage is unavailable or empty', () => {
      expect(getInitialMarketPerPage(undefined)).toBe(DEFAULT_MARKET_PER_PAGE);
      expect(getInitialMarketPerPage(createMemoryStorage())).toBe(DEFAULT_MARKET_PER_PAGE);
    });

    it('restores valid persisted page sizes', () => {
      for (const size of MARKET_PAGE_SIZE_OPTIONS) {
        const storage = createMemoryStorage({ [MARKET_PER_PAGE_KEY]: String(size) });
        expect(getInitialMarketPerPage(storage)).toBe(size);
      }
    });

    it('falls back to default when stored value is invalid or corrupted', () => {
      for (const raw of ['', 'abc', '10', '999', '-1']) {
        const storage = createMemoryStorage({ [MARKET_PER_PAGE_KEY]: raw });
        expect(getInitialMarketPerPage(storage)).toBe(DEFAULT_MARKET_PER_PAGE);
      }
    });

    it('falls back to default when reading storage throws', () => {
      const brokenStorage = {
        getItem: jest.fn(() => {
          throw new Error('storage blocked');
        }),
      };

      expect(getInitialMarketPerPage(brokenStorage)).toBe(DEFAULT_MARKET_PER_PAGE);
    });
  });

  describe('saveMarketPerPage', () => {
    it('persists valid page size and returns normalized value', () => {
      const storage = createMemoryStorage();

      expect(saveMarketPerPage(24, storage)).toBe(24);
      expect(storage.setItem).toHaveBeenCalledWith(MARKET_PER_PAGE_KEY, '24');
      expect(getInitialMarketPerPage(storage)).toBe(24);
    });

    it('normalizes invalid page size before persisting', () => {
      const storage = createMemoryStorage();

      expect(saveMarketPerPage(99, storage)).toBe(DEFAULT_MARKET_PER_PAGE);
      expect(storage.setItem).toHaveBeenCalledWith(
        MARKET_PER_PAGE_KEY,
        String(DEFAULT_MARKET_PER_PAGE),
      );
    });

    it('ignores storage write failures without throwing', () => {
      const brokenStorage = {
        setItem: jest.fn(() => {
          throw new Error('quota exceeded');
        }),
      };

      expect(saveMarketPerPage(12, brokenStorage)).toBe(12);
    });
  });
});
