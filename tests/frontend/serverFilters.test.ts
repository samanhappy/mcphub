import { filterServers, getServerFilterCounts, selectServerPage } from '../../frontend/src/utils/serverFilters';
import type { Server, Tool } from '../../frontend/src/types';
import {
  buildTagFilterOptions,
  getServerTagOptions,
  isTagCommitKey,
  serverHasTag,
  shouldClearTagFilter,
} from '../../frontend/src/utils/serverTags';

const makeTool = (name: string): Tool => ({
  name,
  description: '',
  inputSchema: { type: 'object' },
});

describe('serverFilters', () => {
  const servers: Server[] = [
    {
      name: 'online-server',
      status: 'connected',
      enabled: true,
      tools: [makeTool('search')],
    },
    {
      name: 'issue-server',
      status: 'disconnected',
      enabled: true,
      tools: [makeTool('fetch')],
    },
    {
      name: 'disabled-online-server',
      status: 'connected',
      enabled: false,
      tools: [makeTool('analyze')],
    },
    {
      name: 'disabled-offline-server',
      status: 'disconnected',
      enabled: false,
      tools: [makeTool('archive')],
    },
  ];

  it('tracks disabled servers separately from issue servers', () => {
    expect(getServerFilterCounts(servers)).toEqual({
      all: 4,
      online: 2,
      issues: 1,
      disabled: 2,
    });
  });

  it('returns only disabled servers when the disabled filter is selected', () => {
    expect(filterServers(servers, 'disabled').map((server) => server.name)).toEqual([
      'disabled-online-server',
      'disabled-offline-server',
    ]);
  });

  it('still excludes disabled servers from the issues filter', () => {
    expect(filterServers(servers, 'issues').map((server) => server.name)).toEqual(['issue-server']);
  });

  it('applies search terms after the disabled filter', () => {
    expect(filterServers(servers, 'disabled', 'archive').map((server) => server.name)).toEqual([
      'disabled-offline-server',
    ]);
  });
});

describe('selectServerPage', () => {
  // Build a list where disabled servers do NOT land on page 1 (limit 5).
  const online = (name: string): Server => ({ name, status: 'connected', enabled: true, tools: [] });
  const disabled = (name: string): Server => ({ name, status: 'disconnected', enabled: false, tools: [] });

  const allServers: Server[] = [
    online('online-1'),
    online('online-2'),
    online('online-3'),
    online('online-4'),
    online('online-5'), // page 1 (limit 5) is entirely online
    disabled('disabled-6'), // lives on page 2 — never visible to a page-1-only filter
    disabled('disabled-7'),
  ];

  it('filters against the full list, not just the current page', () => {
    // Regression for #939: the Disabled filter used to narrow only the current
    // pagination page, so disabled servers on other pages were hidden even
    // though the badge counted them.
    const { servers, pagination } = selectServerPage(allServers, 'disabled', '', 1, 5);
    expect(servers.map((server) => server.name)).toEqual(['disabled-6', 'disabled-7']);
    expect(pagination.total).toBe(2);
    expect(pagination.totalPages).toBe(1);
    expect(pagination.page).toBe(1);
  });

  it('paginates the filtered result client-side', () => {
    const page1 = selectServerPage(allServers, 'all', '', 1, 5);
    expect(page1.servers.map((server) => server.name)).toEqual([
      'online-1',
      'online-2',
      'online-3',
      'online-4',
      'online-5',
    ]);
    expect(page1.pagination).toEqual({
      page: 1,
      limit: 5,
      total: 7,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });

    const page2 = selectServerPage(allServers, 'all', '', 2, 5);
    expect(page2.servers.map((server) => server.name)).toEqual(['disabled-6', 'disabled-7']);
    expect(page2.pagination.hasNextPage).toBe(false);
    expect(page2.pagination.hasPrevPage).toBe(true);
  });

  it('clamps the page when the filter reduces the result below the current page', () => {
    // Sitting on page 2 of 'all' (7 servers), switch to 'disabled' (2 results, 1 page).
    const { servers, pagination } = selectServerPage(allServers, 'disabled', '', 2, 5);
    expect(pagination.page).toBe(1);
    expect(servers.map((server) => server.name)).toEqual(['disabled-6', 'disabled-7']);
  });

  it('returns an empty page when no servers match the filter', () => {
    const { servers, pagination } = selectServerPage(allServers, 'disabled', 'nonexistent', 1, 5);
    expect(servers).toEqual([]);
    expect(pagination.total).toBe(0);
    expect(pagination.totalPages).toBe(1);
  });
});

describe('server tag filtering (#1506)', () => {
  const tagged = (
    name: string,
    tags: string[] | undefined,
    status: Server['status'] = 'connected',
  ): Server => ({ name, status, enabled: true, config: tags ? { tags } : {} });

  const servers: Server[] = [
    tagged('mongo-test', ['DB', 'test']),
    tagged('mongo-prod', ['db', 'prod'], 'disconnected'),
    tagged('github', ['dev-tools']),
    tagged('plain', undefined),
  ];

  it('matches the tag filter case-insensitively and combines it with the status filter', () => {
    expect(filterServers(servers, 'all', '', 'db').map((s) => s.name)).toEqual([
      'mongo-test',
      'mongo-prod',
    ]);
    expect(filterServers(servers, 'online', '', 'DB').map((s) => s.name)).toEqual(['mongo-test']);
    expect(filterServers(servers, 'all', 'prod', 'db').map((s) => s.name)).toEqual(['mongo-prod']);
  });

  it('finds servers by tag text in the search box', () => {
    expect(filterServers(servers, 'all', 'dev-tools').map((s) => s.name)).toEqual(['github']);
    expect(filterServers(servers, 'all', 'TEST').map((s) => s.name)).toEqual(['mongo-test']);
  });

  it('applies the tag filter before pagination', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      tagged(`server-${index}`, index % 3 === 0 ? ['db'] : ['other']),
    );

    const { servers: page, pagination } = selectServerPage(many, 'all', '', 1, 5, 'db');

    expect(page.map((s) => s.name)).toEqual(['server-0', 'server-3', 'server-6', 'server-9']);
    expect(pagination.total).toBe(4);
    expect(pagination.totalPages).toBe(1);
  });

  it('lists every tag once with its server count, ignoring case', () => {
    expect(getServerTagOptions(servers)).toEqual([
      { tag: 'DB', count: 2 },
      { tag: 'dev-tools', count: 1 },
      { tag: 'prod', count: 1 },
      { tag: 'test', count: 1 },
    ]);
  });
});

describe('tag filter review fixes (#1506)', () => {
  const server = (name: string, tags: unknown, status: Server['status'] = 'connected'): Server =>
    ({ name, status, enabled: true, config: { tags } }) as Server;

  it('keeps the selected tag when its spelling differs between status tabs', () => {
    const online = server('online', ['DB']);
    const inactive = server('inactive', ['db'], 'disconnected');
    const all = [online, inactive];

    const inactiveOptions = buildTagFilterOptions(filterServers(all, 'issues'), all, 'db');

    expect(inactiveOptions).toEqual([{ value: 'db', label: 'db', count: 1 }]);
    expect(filterServers(all, 'issues', '', 'db').map((s) => s.name)).toEqual(['inactive']);
  });

  it('keeps a selected tag that is missing from the current tab with its original spelling', () => {
    const all = [server('online', ['DB']), server('other', ['web'], 'disconnected')];

    const options = buildTagFilterOptions(filterServers(all, 'issues'), all, 'db');

    expect(options).toEqual([
      { value: 'web', label: 'web', count: 1 },
      { value: 'db', label: 'DB', count: 0 },
    ]);
  });

  it('ignores malformed tags instead of breaking the page', () => {
    const all = [server('numbers', [123, 'db']), server('scalar', 'db'), server('none', undefined)];

    expect(() => filterServers(all, 'all', 'db', 'db')).not.toThrow();
    expect(filterServers(all, 'all', '', 'db').map((s) => s.name)).toEqual(['numbers']);
    expect(serverHasTag(all[1], 'db')).toBe(false);
    expect(getServerTagOptions(all)).toEqual([{ tag: 'db', count: 1 }]);
  });

  it('does not commit a tag while an IME composition is active', () => {
    expect(isTagCommitKey('Enter', true)).toBe(false);
    expect(isTagCommitKey(',', true)).toBe(false);
    expect(isTagCommitKey('Enter', false)).toBe(true);
    expect(isTagCommitKey(',', false)).toBe(true);
    expect(isTagCommitKey('a', false)).toBe(false);
  });
});

describe('shouldClearTagFilter (#1506)', () => {
  const options = [{ tag: 'DB', count: 1 }];

  it('keeps a shared ?tag= link until the first successful list load', () => {
    expect(shouldClearTagFilter('db', false, [])).toBe(false);
  });

  it('clears a stale tag after a successful load, including an empty list', () => {
    expect(shouldClearTagFilter('db', true, [])).toBe(true);
    expect(shouldClearTagFilter('missing', true, options)).toBe(true);
  });

  it('keeps a tag that still exists and ignores an empty selection', () => {
    expect(shouldClearTagFilter('db', true, options)).toBe(false);
    expect(shouldClearTagFilter('', true, [])).toBe(false);
  });
});
