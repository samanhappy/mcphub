import { DataService } from '../../src/services/dataService.js';
import { IUser } from '../../src/types/index.js';

const admin: IUser = { username: 'admin', isAdmin: true, password: '' };
const alice: IUser = { username: 'alice', isAdmin: false, password: '' };
const bob: IUser = { username: 'bob', isAdmin: false, password: '' };

// One row per (owner, visibility) cell so each test can name what it expects directly.
const rows = {
  alicePrivate: { name: 'alicePrivate', owner: 'alice', visibility: 'private' },
  alicePublic: { name: 'alicePublic', owner: 'alice', visibility: 'public' },
  aliceGroup: { name: 'aliceGroup', owner: 'alice', visibility: 'group' },
  bobPrivate: { name: 'bobPrivate', owner: 'bob', visibility: 'private' },
  bobPublic: { name: 'bobPublic', owner: 'bob', visibility: 'public' },
  bobGroup: { name: 'bobGroup', owner: 'bob', visibility: 'group' },
  systemPrivate: { name: 'systemPrivate', owner: undefined, visibility: 'private' },
  systemPublic: { name: 'systemPublic', owner: undefined, visibility: 'public' },
  systemGroup: { name: 'systemGroup', owner: undefined, visibility: 'group' },
  // Pre-migration / legacy row that doesn't have visibility set yet. The DAO
  // defaults this to 'private' on read, but the filter should also be defensive
  // about rows that come from non-DAO paths (in-memory tests, raw queries).
  legacyNoVisibility: { name: 'legacyNoVisibility', owner: undefined },
};

const allRows = Object.values(rows);

describe('DataService.filterData (visibility, #817)', () => {
  const dataService = new DataService();

  describe('admin', () => {
    it('returns every row regardless of visibility', () => {
      const result = dataService.filterData(allRows, admin);
      expect(result.map((r) => r.name).sort()).toEqual(allRows.map((r) => r.name).sort());
    });
  });

  describe('no user supplied (unscoped fallback)', () => {
    it('returns every row (callers that pass no user expect un-filtered data)', () => {
      const result = dataService.filterData(allRows);
      expect(result.map((r) => r.name).sort()).toEqual(allRows.map((r) => r.name).sort());
    });
  });

  describe('non-admin user (alice)', () => {
    it('sees her own private rows', () => {
      expect(dataService.filterData([rows.alicePrivate], alice)).toEqual([rows.alicePrivate]);
    });

    it('sees her own public rows', () => {
      expect(dataService.filterData([rows.alicePublic], alice)).toEqual([rows.alicePublic]);
    });

    it('sees her own group rows (owner match takes precedence over the group implementation gap)', () => {
      // Once user→group membership ships and the filter learns to check it, this
      // case stays correct because the owner-match branch fires before the
      // visibility branch.
      expect(dataService.filterData([rows.aliceGroup], alice)).toEqual([rows.aliceGroup]);
    });

    it('does NOT see another user\'s private rows', () => {
      expect(dataService.filterData([rows.bobPrivate], alice)).toEqual([]);
    });

    it('sees another user\'s public rows', () => {
      expect(dataService.filterData([rows.bobPublic], alice)).toEqual([rows.bobPublic]);
    });

    it('does NOT see another user\'s group rows yet (reserved value, not implemented)', () => {
      expect(dataService.filterData([rows.bobGroup], alice)).toEqual([]);
    });

    it('does NOT see system (owner=null) private rows', () => {
      expect(dataService.filterData([rows.systemPrivate], alice)).toEqual([]);
    });

    it('sees system (owner=null) public rows', () => {
      expect(dataService.filterData([rows.systemPublic], alice)).toEqual([rows.systemPublic]);
    });

    it('does NOT see system group rows (reserved value)', () => {
      expect(dataService.filterData([rows.systemGroup], alice)).toEqual([]);
    });

    it('does NOT see legacy rows whose visibility is undefined', () => {
      // Pre-migration safety: if a row somehow reaches the filter without a
      // visibility column populated, treat it as private rather than leaking it.
      expect(dataService.filterData([rows.legacyNoVisibility], alice)).toEqual([]);
    });

    it('returns the union of owner-match and public when given the full dataset', () => {
      const result = dataService.filterData(allRows, alice);
      const names = result.map((r) => r.name).sort();
      expect(names).toEqual(
        ['alicePrivate', 'alicePublic', 'aliceGroup', 'bobPublic', 'systemPublic'].sort(),
      );
    });
  });

  describe('a different non-admin user (bob) sees the symmetric set', () => {
    it('symmetry check: bob sees his own rows + everyone\'s public rows', () => {
      const result = dataService.filterData(allRows, bob);
      const names = result.map((r) => r.name).sort();
      expect(names).toEqual(
        ['bobPrivate', 'bobPublic', 'bobGroup', 'alicePublic', 'systemPublic'].sort(),
      );
    });
  });
});
