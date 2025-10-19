import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RegistryServerEntry,
  RegistryServersResponse,
  RegistryServerVersionResponse,
  RegistryServerVersionsResponse,
} from '@/types';
import { apiGet } from '../utils/fetchInterceptor';

export const useRegistryData = () => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<RegistryServerEntry[]>([]);
  const [allServers, setAllServers] = useState<RegistryServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Cursor-based pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [serversPerPage, setServersPerPage] = useState(9);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [totalPages] = useState(1); // Legacy support, not used in cursor pagination

  // Fetch registry servers with cursor-based pagination
  const fetchRegistryServers = useCallback(
    async (cursor?: string, search?: string) => {
      try {
        setLoading(true);
        setError(null);

        // Build query parameters
        const params = new URLSearchParams();
        params.append('limit', serversPerPage.toString());
        if (cursor) {
          params.append('cursor', cursor);
        }
        const queryToUse = search !== undefined ? search : searchQuery;
        if (queryToUse.trim()) {
          params.append('search', queryToUse.trim());
        }

        const response = await apiGet(`/registry/servers?${params.toString()}`);

        if (response && response.success && response.data) {
          const data: RegistryServersResponse = response.data;
          if (data.servers && Array.isArray(data.servers)) {
            setServers(data.servers);
            // Update pagination state
            const hasMore = data.metadata.count === serversPerPage && !!data.metadata.nextCursor;
            setHasNextPage(hasMore);
            setNextCursor(data.metadata.nextCursor || null);

            // For display purposes, keep track of all loaded servers
            if (!cursor) {
              // First page
              setAllServers(data.servers);
            } else {
              // Subsequent pages - append to all servers
              setAllServers((prev) => [...prev, ...data.servers]);
            }
          } else {
            console.error('Invalid registry servers data format:', data);
            setError(t('registry.fetchError'));
          }
        } else {
          setError(t('registry.fetchError'));
        }
      } catch (err) {
        console.error('Error fetching registry servers:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [t, serversPerPage],
  );

  // Navigate to next page
  const goToNextPage = useCallback(async () => {
    if (!hasNextPage || !nextCursor) return;

    // Save current cursor to history for back navigation
    const currentCursor = cursorHistory[cursorHistory.length - 1] || '';
    setCursorHistory((prev) => [...prev, currentCursor]);

    setCurrentPage((prev) => prev + 1);
    await fetchRegistryServers(nextCursor, searchQuery);
  }, [hasNextPage, nextCursor, cursorHistory, searchQuery, fetchRegistryServers]);

  // Navigate to previous page
  const goToPreviousPage = useCallback(async () => {
    if (currentPage <= 1) return;

    // Get the previous cursor from history
    const newHistory = [...cursorHistory];
    newHistory.pop(); // Remove current position
    const previousCursor = newHistory[newHistory.length - 1];

    setCursorHistory(newHistory);
    setCurrentPage((prev) => prev - 1);

    // Fetch with previous cursor (undefined for first page)
    await fetchRegistryServers(previousCursor || undefined, searchQuery);
  }, [currentPage, cursorHistory, searchQuery, fetchRegistryServers]);

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
      setServersPerPage(newServersPerPage);
      setCurrentPage(1);
      setCursorHistory([]);
      setAllServers([]);
      await fetchRegistryServers(undefined, searchQuery);
    },
    [searchQuery, fetchRegistryServers],
  );

  // Fetch server by name
  const fetchServerByName = useCallback(
    async (serverName: string) => {
      try {
        setLoading(true);
        setError(null);

        // URL encode the server name
        const encodedName = encodeURIComponent(serverName);
        const response = await apiGet(`/registry/servers/${encodedName}/versions`);

        if (response && response.success && response.data) {
          const data: RegistryServerVersionsResponse = response.data;
          if (data.servers && Array.isArray(data.servers) && data.servers.length > 0) {
            // Return the first server entry (should be the latest or specified version)
            return data.servers[0];
          } else {
            console.error('Invalid registry server data format:', data);
            setError(t('registry.serverNotFound'));
            return null;
          }
        } else {
          setError(t('registry.serverNotFound'));
          return null;
        }
      } catch (err) {
        console.error(`Error fetching registry server ${serverName}:`, err);
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
      const response = await apiGet(`/registry/servers/${encodedName}/versions`);

      if (response && response.success && response.data) {
        const data: RegistryServerVersionsResponse = response.data;
        if (data.servers && Array.isArray(data.servers)) {
          return data.servers;
        } else {
          console.error('Invalid registry server versions data format:', data);
          return [];
        }
      } else {
        return [];
      }
    } catch (err) {
      console.error(`Error fetching versions for server ${serverName}:`, err);
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
      const response = await apiGet(`/registry/servers/${encodedName}/versions/${encodedVersion}`);

      if (response && response.success && response.data) {
        const data: RegistryServerVersionResponse = response.data;
        if (data && data.server) {
          return data;
        } else {
          console.error('Invalid registry server version data format:', data);
          return null;
        }
      } else {
        return null;
      }
    } catch (err) {
      console.error(`Error fetching version ${version} for server ${serverName}:`, err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      return null;
    }
  }, []);

  // Search servers by query (client-side filtering on loaded data)
  const searchServers = useCallback(
    async (query: string) => {
      console.log('Searching registry servers with query:', query);
      setSearchQuery(query);
      setCurrentPage(1);
      setCursorHistory([]);
      setAllServers([]);

      await fetchRegistryServers(undefined, query);
    },
    [fetchRegistryServers],
  );

  // Clear search
  const clearSearch = useCallback(async () => {
    setSearchQuery('');
    setCurrentPage(1);
    setCursorHistory([]);
    setAllServers([]);
    await fetchRegistryServers(undefined, '');
  }, [fetchRegistryServers]);

  // Initial fetch
  useEffect(() => {
    fetchRegistryServers(undefined, searchQuery);
    // Only run on mount
    // eslint-disable-next-line
  }, []);

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
