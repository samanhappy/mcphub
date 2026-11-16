import { compatibleToolNames } from './compatibleToolNames.js';

it('preserves valid names and bounds invalid, empty, unicode and long names', () => {
  const tools = ['users.list', 'users_list', 'a-b', '', '查询', 'a'.repeat(65)].map((name) => ({
    name,
  }));
  const aliases = compatibleToolNames(tools);
  expect(aliases.get('users_list')).toBe('users_list');
  expect(aliases.get('a-b')).toBe('a-b');
  expect(new Set(aliases.values()).size).toBe(tools.length);
  for (const alias of aliases.values()) expect(alias).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(compatibleToolNames([...tools].reverse())).toEqual(aliases);
});

it('reserves valid upstream names even when they match a generated alias', () => {
  const first = compatibleToolNames([{ name: 'users.list' }]).get('users.list')!;
  const aliases = compatibleToolNames([{ name: 'users.list' }, { name: first }]);
  expect(aliases.get(first)).toBe(first);
  expect(aliases.get('users.list')).not.toBe(first);
});

it('keeps generated aliases outside the staging namespace without renaming hub tools', () => {
  const aliases = compatibleToolNames([
    { name: 'mcphub.file_query' },
    { name: 'mcphub.file_' + 'q'.repeat(80) },
    { name: 'mcphub_file_status' },
  ]);
  for (const name of ['mcphub.file_query', 'mcphub.file_' + 'q'.repeat(80)]) {
    const alias = aliases.get(name)!;
    expect(alias).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(alias.startsWith('mcphub_file_')).toBe(false);
  }
  expect(aliases.get('mcphub_file_status')).toBe('mcphub_file_status');
});
