import type { BearerKey, User } from '@/types';

type ScopeFilterTranslator = (key: string, options?: { defaultValue?: string }) => string;

export type BearerKeyScopeFilterValue = 'all' | 'system' | `user:${string}`;

type BearerKeyScopeFilterOption = {
  value: BearerKeyScopeFilterValue;
  label: string;
};

const getBearerKeyKind = (key: BearerKey): 'system' | 'user' => (key.kind === 'user' ? 'user' : 'system');

const getUserScopedOwners = (bearerKeys: BearerKey[], users: User[]): string[] => {
  const knownUsers = new Set(users.map((user) => user.username));
  const owners = Array.from(new Set(
    bearerKeys
      .filter((key) => getBearerKeyKind(key) === 'user' && typeof key.owner === 'string' && key.owner.trim().length > 0)
      .map((key) => key.owner!.trim()),
  ));

  owners.sort((left, right) => {
    const leftKnown = knownUsers.has(left);
    const rightKnown = knownUsers.has(right);
    if (leftKnown !== rightKnown) {
      return leftKnown ? -1 : 1;
    }
    return left.localeCompare(right);
  });

  return owners;
};

export const getBearerKeyScopeFilterOptions = (
  t: ScopeFilterTranslator,
  bearerKeys: BearerKey[],
  users: User[] = [],
): BearerKeyScopeFilterOption[] => {
  const options: BearerKeyScopeFilterOption[] = [
    {
      value: 'all',
      label: t('settings.bearerKeyAccessAll', { defaultValue: 'All' }),
    },
  ];

  if (bearerKeys.some((key) => getBearerKeyKind(key) === 'system')) {
    options.push({
      value: 'system',
      label: t('settings.bearerKeyKindSystem', { defaultValue: 'System-level' }),
    });
  }

  const userLabel = t('settings.bearerKeyKindUser', { defaultValue: 'User-level' });
  for (const owner of getUserScopedOwners(bearerKeys, users)) {
    options.push({
      value: `user:${owner}`,
      label: `${userLabel} · ${owner}`,
    });
  }

  return options;
};

export const filterBearerKeysByScopeFilter = (
  bearerKeys: BearerKey[],
  scopeFilter: BearerKeyScopeFilterValue,
): BearerKey[] => {
  if (scopeFilter === 'all') {
    return bearerKeys;
  }

  if (scopeFilter === 'system') {
    return bearerKeys.filter((key) => getBearerKeyKind(key) === 'system');
  }

  const owner = scopeFilter.slice('user:'.length);
  return bearerKeys.filter((key) => getBearerKeyKind(key) === 'user' && key.owner === owner);
};
