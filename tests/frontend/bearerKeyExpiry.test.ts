import {
  formatBearerKeyLastUsed,
  getBearerKeyExpiryState,
  sortBearerKeys,
  validateExpiresInDaysInput,
} from '../../frontend/src/utils/bearerKeyExpiry.js';
import type { BearerKey } from '../../frontend/src/types/index.js';

const baseKey = (overrides: Partial<BearerKey>): BearerKey => ({
  id: 'id-1',
  name: 'key',
  token: 'mcphub_ab...cd',
  enabled: true,
  kind: 'system',
  accessType: 'all',
  ...overrides,
});

describe('frontend bearerKeyExpiry helpers', () => {
  const now = new Date('2026-11-27T12:00:00.000Z');

  it('computes active, 7-day warning, expired, and disabled states accurately', () => {
    expect(getBearerKeyExpiryState(baseKey({}), now)).toMatchObject({
      status: 'active',
      expired: false,
      expiringSoon: false,
      daysRemaining: null,
    });

    expect(
      getBearerKeyExpiryState(baseKey({ expiresAt: '2026-11-27T12:00:00.000Z' }), now),
    ).toMatchObject({
      status: 'expired',
      expired: true,
      expiringSoon: false,
      daysRemaining: 0,
    });

    // Exactly 7 days left -> warning
    expect(
      getBearerKeyExpiryState(baseKey({ expiresAt: '2026-12-04T12:00:00.000Z' }), now),
    ).toMatchObject({
      status: 'expiring_soon',
      expired: false,
      expiringSoon: true,
      daysRemaining: 7,
    });

    // 8 days left -> active without warning
    expect(
      getBearerKeyExpiryState(baseKey({ expiresAt: '2026-12-05T12:00:00.000Z' }), now),
    ).toMatchObject({
      status: 'active',
      expired: false,
      expiringSoon: false,
      daysRemaining: 8,
    });

    // Disabled key with future expiry stays disabled
    expect(
      getBearerKeyExpiryState(
        baseKey({ enabled: false, expiresAt: '2026-11-30T12:00:00.000Z' }),
        now,
      ),
    ).toMatchObject({
      status: 'disabled',
      expired: false,
      expiringSoon: false,
      daysRemaining: 3,
    });
  });

  it('sorts keys by status/expiry and by lastUsedAt', () => {
    const expired = baseKey({
      id: '1',
      name: 'expired',
      expiresAt: '2026-11-26T00:00:00.000Z',
      lastUsedAt: '2026-11-25T10:00:00.000Z',
    });
    const soon = baseKey({
      id: '2',
      name: 'soon',
      expiresAt: '2026-11-30T00:00:00.000Z',
      lastUsedAt: '2026-11-27T11:55:00.000Z',
    });
    const neverExpires = baseKey({
      id: '3',
      name: 'never-expires',
      lastUsedAt: null,
    });
    const disabled = baseKey({
      id: '4',
      name: 'disabled',
      enabled: false,
      lastUsedAt: '2026-11-20T00:00:00.000Z',
    });

    expect(
      sortBearerKeys([neverExpires, disabled, soon, expired], 'status', 'asc', now).map(
        (k) => k.name,
      ),
    ).toEqual(['expired', 'soon', 'never-expires', 'disabled']);

    expect(
      sortBearerKeys([neverExpires, disabled, soon, expired], 'lastUsed', 'desc', now).map(
        (k) => k.name,
      ),
    ).toEqual(['soon', 'expired', 'disabled', 'never-expires']);
  });

  it('formats lastUsedAt and validates expiresInDays input', () => {
    const t = (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key;
    expect(formatBearerKeyLastUsed(null, t, 'en', now)).toBe('settings.bearerKeyLastUsedNever');
    expect(formatBearerKeyLastUsed('2026-11-27T11:59:30.000Z', t, 'en', now)).toBe(
      'settings.bearerKeyLastUsedJustNow',
    );
    expect(formatBearerKeyLastUsed('2026-11-27T11:50:00.000Z', t, 'en', now)).toBe(
      'settings.bearerKeyLastUsedMinutesAgo:10',
    );

    expect(validateExpiresInDaysInput('')).toBeNull();
    expect(validateExpiresInDaysInput('30')).toBe(30);
    expect(Number.isNaN(validateExpiresInDaysInput('0'))).toBe(true);
    expect(Number.isNaN(validateExpiresInDaysInput('3651'))).toBe(true);
    expect(Number.isNaN(validateExpiresInDaysInput('2.5'))).toBe(true);
  });
});
