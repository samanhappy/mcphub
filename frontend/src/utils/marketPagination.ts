export const MARKET_PER_PAGE_KEY = 'mcphub_market_per_page';
export const DEFAULT_MARKET_PER_PAGE = 9;
export const MARKET_PAGE_SIZE_OPTIONS = [6, 9, 12, 24] as const;

const VALID_MARKET_PAGE_SIZES = new Set<number>(MARKET_PAGE_SIZE_OPTIONS);

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

const getDefaultStorage = (): Storage | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const normalizeMarketPerPage = (value: number): number =>
  VALID_MARKET_PAGE_SIZES.has(value) ? value : DEFAULT_MARKET_PER_PAGE;

export const getInitialMarketPerPage = (storage: StorageReader | undefined = getDefaultStorage()): number => {
  if (!storage) {
    return DEFAULT_MARKET_PER_PAGE;
  }

  try {
    const saved = storage.getItem(MARKET_PER_PAGE_KEY);
    if (!saved) {
      return DEFAULT_MARKET_PER_PAGE;
    }

    return normalizeMarketPerPage(Number(saved));
  } catch {
    return DEFAULT_MARKET_PER_PAGE;
  }
};

export const saveMarketPerPage = (
  perPage: number,
  storage: StorageWriter | undefined = getDefaultStorage(),
): number => {
  const normalized = normalizeMarketPerPage(perPage);

  if (storage) {
    try {
      storage.setItem(MARKET_PER_PAGE_KEY, String(normalized));
    } catch {
      // Ignore storage write errors (e.g. private browsing or quota limits).
    }
  }

  return normalized;
};
