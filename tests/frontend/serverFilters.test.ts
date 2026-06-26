import { filterServers, getServerFilterCounts, selectServerPage } from '../../frontend/src/utils/serverFilters';

describe('serverFilters', () => {
  const servers = [
    {
      name: 'online-server',
      status: 'connected' as const,
      enabled: true,
      tools: [{ name: 'search' }],
    },
    {
      name: 'issue-server',
      status: 'disconnected' as const,
      enabled: true,
      tools: [{ name: 'fetch' }],
    },
    {
      name: 'disabled-online-server',
      status: 'connected' as const,
      enabled: false,
      tools: [{ name: 'analyze' }],
    },
    {
      name: 'disabled-offline-server',
      status: 'disconnected' as const,
      enabled: false,
      tools: [{ name: 'archive' }],
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
  const online = (name: string) => ({ name, status: 'connected' as const, enabled: true, tools: [] });
  const disabled = (name: string) => ({ name, status: 'disconnected' as const, enabled: false, tools: [] });

  const allServers = [
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
