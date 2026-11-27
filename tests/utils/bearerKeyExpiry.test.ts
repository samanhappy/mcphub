import { jest } from '@jest/globals';
import {
  isBearerKeyExpired,
  normalizeBearerKeyTimestamp,
  parseBearerKeyExpiryInput,
} from '../../src/utils/bearerKeyExpiry.js';

const mockRecordLastUsed = jest.fn<() => Promise<boolean>>();

jest.mock('../../src/dao/index.js', () => ({
  getBearerKeyDao: () => ({
    recordLastUsed: mockRecordLastUsed,
  }),
}));

import {
  BEARER_KEY_LAST_USED_THROTTLE_MS,
  recordBearerKeyUsage,
  resetBearerKeyUsageThrottle,
} from '../../src/utils/bearerKeyUsage.js';

describe('bearerKeyExpiry utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetBearerKeyUsageThrottle();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('parseBearerKeyExpiryInput', () => {
    const fixedNow = new Date('2026-11-27T00:00:00.000Z');

    it('reports specified=false when both expiresInDays and expiresAt are omitted', () => {
      expect(parseBearerKeyExpiryInput({}, fixedNow)).toEqual({ ok: true, specified: false });
      expect(parseBearerKeyExpiryInput(undefined, fixedNow)).toEqual({
        ok: true,
        specified: false,
      });
    });

    it('computes UTC expiresAt for valid expiresInDays (1..3650)', () => {
      expect(parseBearerKeyExpiryInput({ expiresInDays: 1 }, fixedNow)).toEqual({
        ok: true,
        specified: true,
        expiresAt: '2026-11-28T00:00:00.000Z',
      });
      expect(parseBearerKeyExpiryInput({ expiresInDays: 3650 }, fixedNow)).toEqual({
        ok: true,
        specified: true,
        expiresAt: new Date(fixedNow.getTime() + 3650 * 86_400_000).toISOString(),
      });
    });

    it('treats explicit null or empty string as clearing expiry', () => {
      expect(parseBearerKeyExpiryInput({ expiresInDays: null }, fixedNow)).toEqual({
        ok: true,
        specified: true,
        expiresAt: null,
      });
      expect(parseBearerKeyExpiryInput({ expiresAt: null }, fixedNow)).toEqual({
        ok: true,
        specified: true,
        expiresAt: null,
      });
      expect(parseBearerKeyExpiryInput({ expiresInDays: '' }, fixedNow)).toEqual({
        ok: true,
        specified: true,
        expiresAt: null,
      });
    });

    it('accepts valid ISO expiresAt strings and normalizes to UTC', () => {
      expect(
        parseBearerKeyExpiryInput({ expiresAt: '2026-12-01T12:00:00+02:00' }, fixedNow),
      ).toEqual({
        ok: true,
        specified: true,
        expiresAt: '2026-12-01T10:00:00.000Z',
      });
    });

    it('rejects out-of-range, non-integer, invalid, or ambiguous expiry inputs', () => {
      expect(parseBearerKeyExpiryInput({ expiresInDays: 0 }, fixedNow).ok).toBe(false);
      expect(parseBearerKeyExpiryInput({ expiresInDays: -5 }, fixedNow).ok).toBe(false);
      expect(parseBearerKeyExpiryInput({ expiresInDays: 3651 }, fixedNow).ok).toBe(false);
      expect(parseBearerKeyExpiryInput({ expiresInDays: 1.5 }, fixedNow).ok).toBe(false);
      expect(parseBearerKeyExpiryInput({ expiresInDays: '30' }, fixedNow).ok).toBe(false);
      expect(parseBearerKeyExpiryInput({ expiresAt: 'not-a-date' }, fixedNow).ok).toBe(false);
      expect(
        parseBearerKeyExpiryInput(
          { expiresInDays: 7, expiresAt: '2026-12-05T00:00:00.000Z' },
          fixedNow,
        ).ok,
      ).toBe(false);
    });
  });

  describe('isBearerKeyExpired (fake timers boundary)', () => {
    it('treats legacy keys without expiresAt as non-expiring', () => {
      expect(isBearerKeyExpired({})).toBe(false);
      expect(isBearerKeyExpired({ expiresAt: null })).toBe(false);
      expect(isBearerKeyExpired({ expiresAt: undefined })).toBe(false);
    });

    it('accepts before expiresAt and rejects at/after expiresAt', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-27T00:00:00.000Z'));

      const parsed = parseBearerKeyExpiryInput({ expiresInDays: 1 });
      expect(parsed.ok && parsed.specified).toBe(true);
      const expiresAt = parsed.ok && parsed.specified ? parsed.expiresAt : null;

      expect(isBearerKeyExpired({ expiresAt })).toBe(false);

      // 1 ms before expiry: still valid
      jest.setSystemTime(new Date('2026-11-27T23:59:59.999Z'));
      expect(isBearerKeyExpired({ expiresAt })).toBe(false);

      // Exact expiry boundary: expired
      jest.setSystemTime(new Date('2026-11-28T00:00:00.000Z'));
      expect(isBearerKeyExpired({ expiresAt })).toBe(true);

      // After expiry: expired
      jest.setSystemTime(new Date('2026-11-28T00:00:01.000Z'));
      expect(isBearerKeyExpired({ expiresAt })).toBe(true);
    });

    it('normalizes timestamps safely', () => {
      expect(normalizeBearerKeyTimestamp(new Date('2026-11-27T01:02:03.000Z'))).toBe(
        '2026-11-27T01:02:03.000Z',
      );
      expect(normalizeBearerKeyTimestamp('invalid')).toBeUndefined();
      expect(normalizeBearerKeyTimestamp(null)).toBeUndefined();
    });
  });

  describe('recordBearerKeyUsage (1-minute throttle & best-effort)', () => {
    it('writes at most once per key per minute and allows writes after 60s', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-27T10:00:00.000Z'));
      mockRecordLastUsed.mockResolvedValue(true);

      await recordBearerKeyUsage('key-1');
      expect(mockRecordLastUsed).toHaveBeenCalledTimes(1);

      // 59 seconds later: throttled
      jest.advanceTimersByTime(BEARER_KEY_LAST_USED_THROTTLE_MS - 1000);
      await recordBearerKeyUsage('key-1');
      expect(mockRecordLastUsed).toHaveBeenCalledTimes(1);

      // Separate key is tracked independently
      await recordBearerKeyUsage('key-2');
      expect(mockRecordLastUsed).toHaveBeenCalledTimes(2);

      // 1 second later (60s elapsed for key-1): writes again
      jest.advanceTimersByTime(1000);
      await recordBearerKeyUsage('key-1');
      expect(mockRecordLastUsed).toHaveBeenCalledTimes(3);
    });

    it('swallows storage errors and allows retry on next call', async () => {
      mockRecordLastUsed.mockRejectedValueOnce(new Error('disk full'));
      await expect(recordBearerKeyUsage('key-err')).resolves.toBeUndefined();

      mockRecordLastUsed.mockResolvedValueOnce(true);
      await recordBearerKeyUsage('key-err');
      expect(mockRecordLastUsed).toHaveBeenCalledTimes(2);
    });
  });
});
