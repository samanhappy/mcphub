import { Server } from '@/types';

export type ServerFilter = 'all' | 'online' | 'issues' | 'disabled';

export interface ServerPageInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export const getServerFilterCounts = (servers: Server[]) => ({
  all: servers.length,
  online: servers.filter((server) => server.status === 'connected').length,
  issues: servers.filter((server) => server.status !== 'connected' && server.enabled !== false).length,
  disabled: servers.filter((server) => server.enabled === false).length,
});

export const filterServers = (
  servers: Server[],
  filter: ServerFilter,
  search = '',
): Server[] => {
  const query = search.trim().toLowerCase();

  return servers.filter((server) => {
    if (filter === 'online' && server.status !== 'connected') return false;
    if (filter === 'issues' && (server.status === 'connected' || server.enabled === false)) return false;
    if (filter === 'disabled' && server.enabled !== false) return false;
    if (!query) return true;

    const haystack = (
      server.name +
      ' ' +
      (server.config?.description || '') +
      ' ' +
      (server.tools?.map((tool) => tool.name).join(' ') || '')
    ).toLowerCase();

    return haystack.includes(query);
  });
};

// Filters the full server list then paginates the filtered result client-side.
// Filtering must run against the complete list, not a single pagination page, so
// that servers on other pages remain reachable when a status filter is active.
export const selectServerPage = (
  allServers: Server[],
  filter: ServerFilter,
  search: string,
  page: number,
  limit: number,
): { servers: Server[]; pagination: ServerPageInfo } => {
  const filtered = filterServers(allServers, filter, search);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * limit;

  return {
    servers: filtered.slice(start, start + limit),
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
    },
  };
};
