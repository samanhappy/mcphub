import {
  deselectShareUsers,
  filterShareUsers,
  getSelectableShareUsers,
  selectShareUsers,
} from '../../frontend/src/utils/shareUserSelection.js';

describe('share user selection helpers', () => {
  it('combines current selections with candidates without dropping legacy selections', () => {
    expect(getSelectableShareUsers(['legacy-user', 'alice'], ['bob', 'alice'])).toEqual([
      'alice',
      'bob',
      'legacy-user',
    ]);
  });

  it('filters usernames by a case-insensitive substring while preserving their original values', () => {
    expect(filterShareUsers(['team-a-alice', 'Team-B-bob', 'admin'], 'TEAM-A-')).toEqual([
      'team-a-alice',
    ]);
  });

  it('returns all users for an empty search query', () => {
    const users = ['alice', 'bob'];

    expect(filterShareUsers(users, '  ')).toEqual(users);
  });

  it('selects only filtered users and preserves selections outside the filter', () => {
    expect(
      selectShareUsers(['team-a-alice', 'team-c-carol'], ['team-a-alice', 'team-b-bob']),
    ).toEqual(['team-a-alice', 'team-c-carol', 'team-b-bob']);
  });

  it('deselects only filtered users and preserves selections outside the filter', () => {
    expect(
      deselectShareUsers(
        ['team-a-alice', 'team-b-bob', 'team-c-carol'],
        ['team-a-alice', 'team-b-bob'],
      ),
    ).toEqual(['team-c-carol']);
  });
});
