import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RegistryServerEntry,
  RegistryServersResponse,
  RegistryServerVersionResponse,
  RegistryServerVersionsResponse,
} from '@/types';
import { apiGet } from '../utils/fetchInterceptor';
import {
  getInitialMarketPerPage,
  normalizeMarketPerPage,
  saveMarketPerPage,
} from '../utils/marketPagination';

interface UseRegistryDataOptions {
  serversPerPage?: number;
  active?: boolean;
}

export const useRegistryData = (options?: UseRegistryDataOptions) => {
  const { t } = useTranslation();
  const active = options?.active ?? true;
  const externalServersPerPage = options?.serversPerPage;

  const [servers, setServers] = useState<RegistryServerEntry[]>([]);
  const [allServers, setAllServers] = useState<RegistryServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchQueryRef = useRef(searchQuery);

  // Cursor-based pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [serversPerPage, setServersPerPage] = useState(() =>
    externalServersPerPage !== undefined
      ? normalizeMarketPerPage(externalServersPerPage)
      : getInitialMarketPerPage(),
  );
  const serversPerPageRef = useRef(serversPerPage);
  const lastFetchedLimitRef = useRef<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  // Stack of request cursors for visited pages: cursorHistory[page - 1] fetched `page` ('' for page 1).
  const [cursorHistory, setCursorHistory] = useState<string[]>(['']);
  const [totalPages] = useState(1); // Legacy support, not used in cursor pagination

  // Fetch registry servers with cursor-based pagination
  const fetchRegistryServers = useCallback(
    async (cursor?: string, search?: string, limitOverride?: number, targetPage = 1): Promise<boolean> => {
      const limit =
        limitOverride !== undefined
          ? normalizeMarketPerPage(limitOverride)
          : serversPerPageRef.current;
      const previousFetchedLimit = lastFetchedLimitRef.current;

      try {
        lastFetchedLimitRef.current = limit;
        setLoading(true);
        setError(null);

        // Build query parameters
        const params = new URLSearchParams();
        params.append('limit', limit.toString());
        if (cursor) {
          params.append('cursor', cursor);
        }
        const queryToUse = search !== undefined ? search : searchQueryRef.current;
        if (queryToUse.trim()) {
          params.append('search', queryToUse.trim());
        }

        const response = await apiGet(`/registry/servers?${params.toString()}`);

        if (response && response.success && response.data) {
          const data: RegistryServersResponse = response.data;
          if (data.servers && Array.isArray(data.servers)) {
            setServers(data.servers);
            // Update pagination state
            const hasMore = data.metadata.count === limit && !!data.metadata.nextCursor;
            setHasNextPage(hasMore);
            setNextCursor(data.metadata.nextCursor || null);

            // Keep loaded items indexed by page offset so navigating back does not duplicate entries
            if (targetPage <= 1 || !cursor) {
              setAllServers(data.servers);
            } else {
              const pageOffset = (targetPage - 1) * limit;
              setAllServers((prev) => {
                const updated = prev.slice(0, pageOffset);
                updated.push(...data.servers);
                if (prev.length > pageOffset + data.servers.length) {
                  updated.push(...prev.slice(pageOffset + data.servers.length));
                }
                return updated;
              });
            }
            return true;
          } else {
            lastFetchedLimitRef.current = targetPage <= 1 ? null : previousFetchedLimit;
            console.error('Invalid registry servers data format', { data });
            setError(t('registry.fetchError'));
            return false;
          }
        } else {
          lastFetchedLimitRef.current = targetPage <= 1 ? null : previousFetchedLimit;
          setError(t('registry.fetchError'));
          return false;
        }
      } catch (err) {
        lastFetchedLimitRef.current = targetPage <= 1 ? null : previousFetchedLimit;
        console.error('Error fetching registry servers', { cursor, search, err });
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // Navigate to next page
  const goToNextPage = useCallback(async () => {
    if (!hasNextPage || !nextCursor) return;

    const targetPage = currentPage + 1;
    const targetCursor = nextCursor;
    const succeeded = await fetchRegistryServers(
      targetCursor,
      searchQueryRef.current,
      undefined,
      targetPage,
    );
    if (succeeded) {
      setCursorHistory((prev) => [...prev, targetCursor]);
      setCurrentPage(targetPage);
    }
  }, [hasNextPage, nextCursor, currentPage, fetchRegistryServers]);

  // Navigate to previous page
  const goToPreviousPage = useCallback(async () => {
    if (currentPage <= 1) return;

    // Pop current page's cursor; the new tail is the cursor that fetched the previous page
    const newHistory = cursorHistory.slice(0, -1);
    const normalizedHistory = newHistory.length > 0 ? newHistory : [''];
    const previousCursor = normalizedHistory[normalizedHistory.length - 1] || undefined;
    const targetPage = currentPage - 1;

    const succeeded = await fetchRegistryServers(
      previousCursor,
      searchQueryRef.current,
      undefined,
      targetPage,
    );
    if (succeeded) {
      setCursorHistory(normalizedHistory);
      setCurrentPage(targetPage);
    }
  }, [currentPage, cursorHistory, fetchRegistryServers]);

  // Change page (legacy support for page number navigation)
  const changePage = useCallback(
    async (page: number) => {
      if (page === currentPage) return;

      if (page > currentPage && hasNextPage) {
        await goToNextPage();
      } else if (page < currentPage && currentPage > 1) {
        await goToPreviousPage();
      }
    },
    [currentPage, hasNextPage, goToNextPage, goToPreviousPage],
  );

  // Change items per page
  const changeServersPerPage = useCallback(
    async (newServersPerPage: number) => {
      const normalizedPerPage = saveMarketPerPage(newServersPerPage);
      serversPerPageRef.current = normalizedPerPage;
      setServersPerPage(normalizedPerPage);
      setCurrentPage(1);
      setCursorHistory(['']);
      setAllServers([]);
      await fetchRegistryServers(undefined, searchQueryRef.current, normalizedPerPage, 1);
    },
    [fetchRegistryServers],
  );

  // Fetch server by name
  const fetchServerByName = useCallback(
    async (serverName: string) => {
      try {
        setLoading(true);
        setError(null);

        // URL encode the server name
        const encodedName = encodeURIComponent(serverName);
        const response = await apiGet(`/registry/servers/versions?serverName=${encodedName}`);

        if (response && response.success && response.data) {
          const data: RegistryServerVersionsResponse = response.data;
          if (data.servers && Array.isArray(data.servers) && data.servers.length > 0) {
            // Return the first server entry (should be the latest or specified version)
            return data.servers[0];
          } else {
            console.error('Invalid registry server data format', { serverName, data });
            setError(t('registry.serverNotFound'));
            return null;
          }
        } else {
          setError(t('registry.serverNotFound'));
          return null;
        }
      } catch (err) {
        console.error('Error fetching registry server', { serverName, err });
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // Fetch all versions of a server
  const fetchServerVersions = useCallback(async (serverName: string) => {
    try {
      setError(null);

      // URL encode the server name
      const encodedName = encodeURIComponent(serverName);
      const response = await apiGet(`/registry/servers/versions?serverName=${encodedName}`);

      if (response && response.success && response.data) {
        const data: RegistryServerVersionsResponse = response.data;
        if (data.servers && Array.isArray(data.servers)) {
          return data.servers;
        } else {
          console.error('Invalid registry server versions data format', { serverName, data });
          return [];
        }
      } else {
        return [];
      }
    } catch (err) {
      console.error('Error fetching versions for registry server', { serverName, err });
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      return [];
    }
  }, []);

  // Fetch specific version of a server
  const fetchServerVersion = useCallback(async (serverName: string, version: string) => {
    try {
      setError(null);

      // URL encode the server name and version
      const encodedName = encodeURIComponent(serverName);
      const encodedVersion = encodeURIComponent(version);
      const response = await apiGet(`/registry/servers/version?serverName=${encodedName}&version=${encodedVersion}`);

      if (response && response.success && response.data) {
        const data: RegistryServerVersionResponse = response.data;
        if (data && data.server) {
          return data;
        } else {
          console.error('Invalid registry server version data format', { serverName, version, data });
          return null;
        }
      } else {
        return null;
      }
    } catch (err) {
      console.error('Error fetching specific registry server version', { serverName, version, err });
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      return null;
    }
  }, []);

  // Search servers by query (client-side filtering on loaded data)
  const searchServers = useCallback(
    async (query: string) => {
      console.log('Searching registry servers', { query });
      searchQueryRef.current = query;
      setSearchQuery(query);
      setCurrentPage(1);
      setCursorHistory(['']);
      setAllServers([]);

      await fetchRegistryServers(undefined, query, undefined, 1);
    },
    [fetchRegistryServers],
  );

  // Clear search
  const clearSearch = useCallback(async () => {
    searchQueryRef.current = '';
    setSearchQuery('');
    setCurrentPage(1);
    setCursorHistory(['']);
    setAllServers([]);
    await fetchRegistryServers(undefined, '', undefined, 1);
  }, [fetchRegistryServers]);

  // Fetch on activation and re-fetch if the shared page size changed while inactive
  useEffect(() => {
    const targetPerPage =
      externalServersPerPage !== undefined
        ? normalizeMarketPerPage(externalServersPerPage)
        : serversPerPageRef.current;

    if (targetPerPage !== serversPerPageRef.current) {
      serversPerPageRef.current = targetPerPage;
      setServersPerPage(targetPerPage);
    }

    if (!active) {
      return;
    }

    if (lastFetchedLimitRef.current !== targetPerPage) {
      setCurrentPage(1);
      setCursorHistory(['']);
      setAllServers([]);
      void fetchRegistryServers(undefined, searchQueryRef.current, targetPerPage, 1);
    }
  }, [active, externalServersPerPage, fetchRegistryServers]);

  return {
    servers,
    allServers,
    loading,
    error,
    setError,
    searchQuery,
    searchServers,
    clearSearch,
    fetchServerByName,
    fetchServerVersions,
    fetchServerVersion,
    // Cursor-based pagination
    currentPage,
    totalPages,
    hasNextPage,
    hasPreviousPage: currentPage > 1,
    changePage,
    goToNextPage,
    goToPreviousPage,
    serversPerPage,
    changeServersPerPage,
  };
};
