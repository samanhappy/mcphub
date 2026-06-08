import { filterServers, getServerFilterCounts } from '../../frontend/src/utils/serverFilters';

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
