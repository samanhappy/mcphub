import {
  getServerNamesFingerprint,
  shouldRefreshGroupsForServerNames,
} from '../../frontend/src/utils/groupCache';

describe('groupCache', () => {
  it('computes an order-independent fingerprint of server names', () => {
    const a = getServerNamesFingerprint([{ name: 'slack' }, { name: 'amap' }]);
    const b = getServerNamesFingerprint([{ name: 'amap' }, { name: 'slack' }]);
    expect(a).toBe(b);
  });

  it('triggers invalidation on server rename, addition, or removal, but not on initial load', () => {
    const initial = getServerNamesFingerprint([{ name: 'alpha' }, { name: 'beta' }]);
    const sameOrderChanged = getServerNamesFingerprint([{ name: 'beta' }, { name: 'alpha' }]);
    const renamed = getServerNamesFingerprint([{ name: 'alpha-v2' }, { name: 'beta' }]);
    const added = getServerNamesFingerprint([{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }]);
    const removed = getServerNamesFingerprint([{ name: 'alpha' }]);

    expect(shouldRefreshGroupsForServerNames(null, initial)).toBe(false);
    expect(shouldRefreshGroupsForServerNames(initial, sameOrderChanged)).toBe(false);
    expect(shouldRefreshGroupsForServerNames(initial, renamed)).toBe(true);
    expect(shouldRefreshGroupsForServerNames(initial, added)).toBe(true);
    expect(shouldRefreshGroupsForServerNames(initial, removed)).toBe(true);
  });
});
