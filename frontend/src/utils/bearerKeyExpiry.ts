import type { BearerKey } from '@/types';

export const BEARER_KEY_MIN_EXPIRES_IN_DAYS = 1;
export const BEARER_KEY_MAX_EXPIRES_IN_DAYS = 3650;
export const BEARER_KEY_EXPIRY_WARNING_DAYS = 7;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export type BearerKeyExpiryStatus = 'expired' | 'expiring_soon' | 'active' | 'disabled';

export interface BearerKeyExpiryState {
  status: BearerKeyExpiryStatus;
  expired: boolean;
  expiringSoon: boolean;
  daysRemaining: number | null;
  expiresAtMs: number | null;
}

export type BearerKeySortField = 'none' | 'status' | 'lastUsed';
export type SortDirection = 'asc' | 'desc';

export const getBearerKeyExpiryState = (
  key: Pick<BearerKey, 'enabled' | 'expiresAt'>,
  now: Date = new Date(),
): BearerKeyExpiryState => {
  const nowMs = now.getTime();
  const parsed = key.expiresAt ? Date.parse(key.expiresAt) : Number.NaN;
  const expiresAtMs = Number.isNaN(parsed) ? null : parsed;

  if (expiresAtMs === null) {
    return {
      status: key.enabled ? 'active' : 'disabled',
      expired: false,
      expiringSoon: false,
      daysRemaining: null,
      expiresAtMs: null,
    };
  }

  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) {
    return {
      status: 'expired',
      expired: true,
      expiringSoon: false,
      daysRemaining: 0,
      expiresAtMs,
    };
  }

  const daysRemaining = Math.max(1, Math.ceil(remainingMs / MS_PER_DAY));
  const expiringSoon = key.enabled && daysRemaining <= BEARER_KEY_EXPIRY_WARNING_DAYS;

  return {
    status: !key.enabled ? 'disabled' : expiringSoon ? 'expiring_soon' : 'active',
    expired: false,
    expiringSoon,
    daysRemaining,
    expiresAtMs,
  };
};

const getStatusSortKey = (
  key: Pick<BearerKey, 'enabled' | 'expiresAt'>,
  now: Date,
): [number, number] => {
  const state = getBearerKeyExpiryState(key, now);
  if (state.expired) {
    // Expired keys sort first, most recently expired / earliest timestamp first.
    return [0, state.expiresAtMs ?? 0];
  }
  if (!key.enabled) {
    return [3, state.expiresAtMs ?? Number.MAX_SAFE_INTEGER];
  }
  if (state.expiresAtMs !== null) {
    // Active keys with expiry sort by soonest expiration (including <= 7d warnings).
    return [1, state.expiresAtMs];
  }
  // Active non-expiring keys.
  return [2, Number.MAX_SAFE_INTEGER];
};

export const sortBearerKeys = (
  keys: BearerKey[],
  sortBy: BearerKeySortField,
  direction: SortDirection,
  now: Date = new Date(),
): BearerKey[] => {
  if (sortBy === 'none') {
    return keys;
  }

  const multiplier = direction === 'asc' ? 1 : -1;

  return [...keys].sort((a, b) => {
    if (sortBy === 'status') {
      const [rankA, timeA] = getStatusSortKey(a, now);
      const [rankB, timeB] = getStatusSortKey(b, now);
      if (rankA !== rankB) {
        return (rankA - rankB) * multiplier;
      }
      if (timeA !== timeB) {
        return (timeA - timeB) * multiplier;
      }
      return a.name.localeCompare(b.name);
    }

    const parsedA = a.lastUsedAt ? Date.parse(a.lastUsedAt) : Number.NaN;
    const parsedB = b.lastUsedAt ? Date.parse(b.lastUsedAt) : Number.NaN;
    const hasA = !Number.isNaN(parsedA);
    const hasB = !Number.isNaN(parsedB);

    if (hasA && hasB) {
      if (parsedA !== parsedB) {
        return (parsedA - parsedB) * multiplier;
      }
      return a.name.localeCompare(b.name);
    }
    if (hasA !== hasB) {
      // Keep keys with a recorded timestamp before "Never" in both directions.
      return hasA ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
};

export const formatBearerKeyLastUsed = (
  lastUsedAt: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale?: string,
  now: Date = new Date(),
): string => {
  if (!lastUsedAt) {
    return t('settings.bearerKeyLastUsedNever');
  }
  const ms = Date.parse(lastUsedAt);
  if (Number.isNaN(ms)) {
    return t('settings.bearerKeyLastUsedNever');
  }

  const diffMs = Math.max(0, now.getTime() - ms);
  if (diffMs < MS_PER_MINUTE) {
    return t('settings.bearerKeyLastUsedJustNow');
  }
  if (diffMs < MS_PER_HOUR) {
    const minutes = Math.floor(diffMs / MS_PER_MINUTE);
    return t('settings.bearerKeyLastUsedMinutesAgo', { count: minutes });
  }
  if (diffMs < MS_PER_DAY) {
    const hours = Math.floor(diffMs / MS_PER_HOUR);
    return t('settings.bearerKeyLastUsedHoursAgo', { count: hours });
  }
  const days = Math.floor(diffMs / MS_PER_DAY);
  if (days < 30) {
    return t('settings.bearerKeyLastUsedDaysAgo', { count: days });
  }
  return new Date(ms).toLocaleDateString(locale || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const validateExpiresInDaysInput = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (
    !Number.isInteger(parsed) ||
    parsed < BEARER_KEY_MIN_EXPIRES_IN_DAYS ||
    parsed > BEARER_KEY_MAX_EXPIRES_IN_DAYS
  ) {
    return Number.NaN;
  }
  return parsed;
};
