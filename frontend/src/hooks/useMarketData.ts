import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MarketServer, ApiResponse, ServerConfig } from '@/types';
import { apiGet, apiPost } from '../utils/fetchInterceptor';

export const useMarketData = () => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<MarketServer[]>([]);
  const [allServers, setAllServers] = useState<MarketServer[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentServer, setCurrentServer] = useState<MarketServer | null>(null);
  const [installedServers, setInstalledServers] = useState<string[]>([]);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [serversPerPage, setServersPerPage] = useState(9);
  const [totalPages, setTotalPages] = useState(1);

  // Fetch all market servers
  const fetchMarketServers = useCallback(async () => {
    try {
      setLoading(true);
      const data: ApiResponse<MarketServer[]> = await apiGet('/market/servers');

      if (data && data.success && Array.isArray(data.data)) {
        setAllServers(data.data);
        // Apply pagination to the fetched data
        applyPagination(data.data, currentPage);
      } else {
        console.error('Invalid market servers data format:', data);
        setError(t('market.fetchError'));
      }
    } catch (err) {
      console.error('Error fetching market servers:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Apply pagination to data
  const applyPagination = useCallback(
    (data: MarketServer[], page: number, itemsPerPage = serversPerPage) => {
      const totalItems = data.length;
      const calculatedTotalPages = Math.ceil(totalItems / itemsPerPage);
      setTotalPages(calculatedTotalPages);

      // Ensure current page is valid
      const validPage = Math.max(1, Math.min(page, calculatedTotalPages));
      if (validPage !== page) {
        setCurrentPage(validPage);
      }

      const startIndex = (validPage - 1) * itemsPerPage;
      const paginatedServers = data.slice(startIndex, startIndex + itemsPerPage);
      setServers(paginatedServers);
    },
    [serversPerPage],
  );

  // Change page
  const changePage = useCallback(
    (page: number) => {
      setCurrentPage(page);
      applyPagination(allServers, page, serversPerPage);
    },
    [allServers, applyPagination, serversPerPage],
  );

  // Fetch all categories
  const fetchCategories = useCallback(async () => {
    try {
      const data: ApiResponse<string[]> = await apiGet('/market/categories');

      if (data && data.success && Array.isArray(data.data)) {
        setCategories(data.data);
      } else {
        console.error('Invalid categories data format:', data);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  }, []);

  // Fetch all tags
  const fetchTags = useCallback(async () => {
    try {
      const data: ApiResponse<string[]> = await apiGet('/market/tags');

      if (data && data.success && Array.isArray(data.data)) {
        setTags(data.data);
      } else {
        console.error('Invalid tags data format:', data);
      }
    } catch (err) {
      console.error('Error fetching tags:', err);
    }
  }, []);

  // Fetch server by name
  const fetchServerByName = useCallback(
    async (name: string) => {
      try {
        setLoading(true);
        const data: ApiResponse<MarketServer> = await apiGet(`/market/servers/${name}`);

        if (data && data.success && data.data) {
          setCurrentServer(data.data);
          return data.data;
        } else {
          console.error('Invalid server data format:', data);
          setError(t('market.serverNotFound'));
          return null;
        }
      } catch (err) {
        console.error(`Error fetching server ${name}:`, err);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // Search servers by query
  const searchServers = useCallback(
    async (query: string) => {
      try {
        setLoading(true);
        setSearchQuery(query);

        if (!query.trim()) {
          // Fetch fresh data from server instead of just applying pagination
          fetchMarketServers();
          return;
        }

        const data: ApiResponse<MarketServer[]> = await apiGet(
          `/market/servers/search?query=${encodeURIComponent(query)}`,
        );

        if (data && data.success && Array.isArray(data.data)) {
          setAllServers(data.data);
          setCurrentPage(1);
          applyPagination(data.data, 1);
        } else {
          console.error('Invalid search results format:', data);
          setError(t('market.searchError'));
        }
      } catch (err) {
        console.error('Error searching servers:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [t, allServers, applyPagination, fetchMarketServers],
  );

  // Filter servers by category
  const filterByCategory = useCallback(
    async (category: string) => {
      try {
        setLoading(true);
        setSelectedCategory(category);
        setSelectedTag(''); // Reset tag filter when filtering by category

        if (!category) {
          fetchMarketServers();
          return;
        }

        const data: ApiResponse<MarketServer[]> = await apiGet(
          `/market/categories/${encodeURIComponent(category)}`,
        );

        if (data && data.success && Array.isArray(data.data)) {
          setAllServers(data.data);
          setCurrentPage(1);
          applyPagination(data.data, 1);
        } else {
          console.error('Invalid category filter results format:', data);
          setError(t('market.filterError'));
        }
      } catch (err) {
        console.error('Error filtering servers by category:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [t, fetchMarketServers, applyPagination],
  );

  // Filter servers by tag
  const filterByTag = useCallback(
    async (tag: string) => {
      try {
        setLoading(true);
        setSelectedTag(tag);
        setSelectedCategory(''); // Reset category filter when filtering by tag

        if (!tag) {
          fetchMarketServers();
          return;
        }

        const data: ApiResponse<MarketServer[]> = await apiGet(
          `/market/tags/${encodeURIComponent(tag)}`,
        );

        if (data && data.success && Array.isArray(data.data)) {
          setAllServers(data.data);
          setCurrentPage(1);
          applyPagination(data.data, 1);
        } else {
          console.error('Invalid tag filter results format:', data);
          setError(t('market.tagFilterError'));
        }
      } catch (err) {
        console.error('Error filtering servers by tag:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [t, fetchMarketServers, applyPagination],
  );

  // Fetch installed servers
  const fetchInstalledServers = useCallback(async () => {
    try {
      const data = await apiGet<{ success: boolean; data: any[] }>('/servers');

      if (data && data.success && Array.isArray(data.data)) {
        // Extract server names
        const installedServerNames = data.data.map((server: any) => server.name);
        setInstalledServers(installedServerNames);
      }
    } catch (err) {
      console.error('Error fetching installed servers:', err);
    }
  }, []);

  // Check if a server is already installed
  const isServerInstalled = useCallback(
    (serverName: string) => {
      return installedServers.includes(serverName);
    },
    [installedServers],
  );

  // Install server to the local environment
  const installServer = useCallback(
    async (server: MarketServer, customConfig: ServerConfig) => {
      try {
        const installType = server.installations?.npm
          ? 'npm'
          : Object.keys(server.installations || {}).length > 0
            ? Object.keys(server.installations)[0]
            : null;

        if (!installType || !server.installations?.[installType]) {
          setError(t('market.noInstallationMethod'));
          return false;
        }

        const installation = server.installations[installType];

        // Prepare server configuration, merging with customConfig
        const serverConfig = {
          name: server.name,
          config:
            customConfig.type === 'stdio'
              ? {
                  command: customConfig.command || installation.command || '',
                  args: customConfig.args || installation.args || [],
                  env: { ...installation.env, ...customConfig.env },
                }
              : customConfig,
        };

        // Call the createServer API
        const result = await apiPost<{ success: boolean; message?: string }>(
          '/servers',
          serverConfig,
        );

        if (!result.success) {
          throw new Error(result.message || 'Failed to install server');
        }

        // Update installed servers list after successful installation
        await fetchInstalledServers();
        return true;
      } catch (err) {
        console.error('Error installing server:', err);
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [t, fetchInstalledServers],
  );

  // Change servers per page
  const changeServersPerPage = useCallback(
    (perPage: number) => {
      setServersPerPage(perPage);
      setCurrentPage(1);
      applyPagination(allServers, 1, perPage);
    },
    [allServers, applyPagination],
  );

  // Load initial data
  useEffect(() => {
    fetchMarketServers();
    fetchCategories();
    fetchTags();
    fetchInstalledServers();
  }, [fetchMarketServers, fetchCategories, fetchTags, fetchInstalledServers]);

  return {
    servers,
    allServers,
    categories,
    tags,
    selectedCategory,
    selectedTag,
    searchQuery,
    loading,
    error,
    setError,
    currentServer,
    fetchMarketServers,
    fetchServerByName,
    searchServers,
    filterByCategory,
    filterByTag,
    installServer,
    // Pagination properties and methods
    currentPage,
    totalPages,
    serversPerPage,
    changePage,
    changeServersPerPage,
    // Installed servers methods
    isServerInstalled,
  };
};
