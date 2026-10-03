import { recordListFreshness, remainingListTtl } from './listFreshness.js';

describe('private list freshness budget', () => {
  it('uses original discovery age and the shortest dependency, including empty lists', () => {
    const a = [];
    const b = [];
    recordListFreshness(a, 10000, 100);
    recordListFreshness(b, 2000, 100);
    expect(remainingListTtl([a, b], 1000, 1100)).toBe(1000);
    expect(remainingListTtl([a, b], 1500, 1600)).toBe(500);
    expect(remainingListTtl([a, b], 2100, 2100)).toBe(0);
  });

  it('caps projection reuse at five seconds and subtracts build time', () => {
    const snapshot = [];
    recordListFreshness(snapshot, 60000, 0);
    expect(remainingListTtl([snapshot], 1000, 1041.2)).toBe(4958);
    expect(remainingListTtl([snapshot], 1000, 6000)).toBe(0);
  });

  it.each([undefined, -1, 0, 1.5, Infinity, '1000', Number.MAX_SAFE_INTEGER + 1])(
    'invalidates previous freshness for an unknown or invalid envelope (%p)',
    (ttl) => {
      const snapshot = [];
      recordListFreshness(snapshot, 10000, 0);
      recordListFreshness(snapshot, ttl, 100);
      expect(remainingListTtl([snapshot], 100, 100)).toBe(0);
    },
  );

  it('cannot establish freshness for missing dependencies or replacement snapshots', () => {
    const known = [];
    recordListFreshness(known, 10000, 0);
    expect(remainingListTtl([known, []], 0, 0)).toBe(0);
    expect(remainingListTtl([], 0, 0)).toBe(0);
    expect(remainingListTtl([[]], 0, 0)).toBe(0);
  });
});
