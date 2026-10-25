import {
  bearerKeyMatches,
  hashBearerToken,
  maskBearerKey,
  toStoredToken,
} from './bearerKeyToken.js';

const key = (extra: object) => ({
  id: '1',
  name: 'k',
  enabled: true,
  accessType: 'all' as const,
  ...extra,
});

describe('bearerKeyToken', () => {
  it('hashes to a stable 64-char hex digest and keeps an 8-char prefix', () => {
    const stored = toStoredToken('mcphub_abcdef');
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).toBe(hashBearerToken('mcphub_abcdef'));
    expect(stored.tokenPrefix).toBe('mcphub_a');
  });

  it('matches hashed keys only on the exact token', () => {
    const k = key(toStoredToken('mcphub_abcdef'));
    expect(bearerKeyMatches(k, 'mcphub_abcdef')).toBe(true);
    expect(bearerKeyMatches(k, 'mcphub_abcdeg')).toBe(false);
    expect(bearerKeyMatches(k, '')).toBe(false);
  });

  it('still matches a legacy key that has only a raw token', () => {
    const k = key({ token: 'legacy' });
    expect(bearerKeyMatches(k, 'legacy')).toBe(true);
    expect(bearerKeyMatches(k, 'other')).toBe(false);
  });

  it('never matches a key with neither hash nor token', () => {
    expect(bearerKeyMatches(key({}), '')).toBe(false);
  });

  it('masks with the prefix only', () => {
    expect(maskBearerKey({ tokenPrefix: 'mcphub_a' })).toBe('mcphub_a...');
    expect(maskBearerKey({ token: 'legacy-token-value' })).toBe('legacy-t...');
  });
});
