import {
  filterBearerKeysByScopeFilter,
  getBearerKeyScopeFilterOptions,
} from '../../frontend/src/utils/bearerKeyScopeFilter';

const t = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key;

describe('bearerKeyScopeFilter', () => {
  const bearerKeys = [
    {
      id: 'system-key',
      name: 'System Key',
      token: 'token-1',
      enabled: true,
      kind: 'system' as const,
      accessType: 'all' as const,
    },
    {
      id: 'alice-key',
      name: 'Alice Key',
      token: 'token-2',
      enabled: true,
      kind: 'user' as const,
      owner: 'alice',
      accessType: 'all' as const,
    },
    {
      id: 'bob-key',
      name: 'Bob Key',
      token: 'token-3',
      enabled: true,
      kind: 'user' as const,
      owner: 'bob',
      accessType: 'all' as const,
    },
  ];

  it('builds unique scope filter options for system and user owners', () => {
    expect(getBearerKeyScopeFilterOptions(t, bearerKeys, [
      { username: 'bob' },
      { username: 'alice' },
    ])).toEqual([
      { value: 'all', label: 'All' },
      { value: 'system', label: 'System-level' },
      { value: 'user:alice', label: 'User-level · alice' },
      { value: 'user:bob', label: 'User-level · bob' },
    ]);
  });

  it('filters keys by the selected scope filter', () => {
    expect(filterBearerKeysByScopeFilter(bearerKeys, 'all').map((key) => key.id)).toEqual([
      'system-key',
      'alice-key',
      'bob-key',
    ]);
    expect(filterBearerKeysByScopeFilter(bearerKeys, 'system').map((key) => key.id)).toEqual([
      'system-key',
    ]);
    expect(filterBearerKeysByScopeFilter(bearerKeys, 'user:alice').map((key) => key.id)).toEqual([
      'alice-key',
    ]);
  });
});
