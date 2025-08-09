import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudServer, ApiResponse, CloudServerTool } from '@/types';
import { apiGet, apiPost } from '../utils/fetchInterceptor';

export const useCloudData = () => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<CloudServer[]>([]);
  const [allServers, setAllServers] = useState<CloudServer[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentServer, setCurrentServer] = useState<CloudServer | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [serversPerPage, setServersPerPage] = useState(9);
  const [totalPages, setTotalPages] = useState(1);

  // Fetch all cloud market servers
  const fetchCloudServers = useCallback(async () => {
    try {
      setLoading(true);
      const data: ApiResponse<CloudServer[]> = await apiGet('/cloud/servers');

      if (data && data.success && Array.isArray(data.data)) {
        setAllServers(data.data);
        // Apply pagination to the fetched data
        applyPagination(data.data, currentPage);
      } else {
        console.error('Invalid cloud market servers data format:', data);
        setError(t('cloud.fetchError'));
      }
    } catch (err) {
      console.error('Error fetching cloud market servers:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Keep the original error message for API key errors
      if (
        errorMessage === 'MCPROUTER_API_KEY_NOT_CONFIGURED' ||
        errorMessage.toLowerCase().includes('mcprouter api key not configured')
      ) {
        setError(errorMessage);
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Apply pagination to data
  const applyPagination = useCallback(
    (data: CloudServer[], page: number, itemsPerPage = serversPerPage) => {
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
      const data: ApiResponse<string[]> = await apiGet('/cloud/categories');

      if (data && data.success && Array.isArray(data.data)) {
        setCategories(data.data);
      } else {
        console.error('Invalid cloud market categories data format:', data);
      }
    } catch (err) {
      console.error('Error fetching cloud market categories:', err);
    }
  }, []);

  // Fetch all tags
  const fetchTags = useCallback(async () => {
    try {
      const data: ApiResponse<string[]> = await apiGet('/cloud/tags');

      if (data && data.success && Array.isArray(data.data)) {
        setTags(data.data);
      } else {
        console.error('Invalid cloud market tags data format:', data);
      }
    } catch (err) {
      console.error('Error fetching cloud market tags:', err);
    }
  }, []);

  // Fetch server by name
  const fetchServerByName = useCallback(
    async (name: string) => {
      try {
        setLoading(true);
        const data: ApiResponse<CloudServer> = await apiGet(`/cloud/servers/${name}`);

        if (data && data.success && data.data) {
          setCurrentServer(data.data);
          return data.data;
        } else {
          console.error('Invalid cloud server data format:', data);
          setError(t('cloud.serverNotFound'));
          return null;
        }
      } catch (err) {
        console.error(`Error fetching cloud server ${name}:`, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        // Keep the original error message for API key errors
        if (
          errorMessage === 'MCPROUTER_API_KEY_NOT_CONFIGURED' ||
          errorMessage.toLowerCase().includes('mcprouter api key not configured')
        ) {
          setError(errorMessage);
        } else {
          setError(errorMessage);
        }
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
          fetchCloudServers();
          return;
        }

        const data: ApiResponse<CloudServer[]> = await apiGet(
          `/cloud/servers/search?query=${encodeURIComponent(query)}`,
        );

        if (data && data.success && Array.isArray(data.data)) {
          setAllServers(data.data);
          setCurrentPage(1);
          applyPagination(data.data, 1);
        } else {
          console.error('Invalid cloud search results format:', data);
          setError(t('cloud.searchError'));
        }
      } catch (err) {
        console.error('Error searching cloud servers:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [t, allServers, applyPagination, fetchCloudServers],
  );

  // Filter servers by category
  const filterByCategory = useCallback(
    async (category: string) => {
      try {
        setLoading(true);
        setSelectedCategory(category);
        setSelectedTag(''); // Reset tag filter when filtering by category

        if (!category) {
          fetchCloudServers();
          return;
        }

        const data: ApiResponse<CloudServer[]> = await apiGet(
          `/cloud/categories/${encodeURIComponent(category)}`,
        );

        if (data && data.success && Array.isArray(data.data)) {
          setAllServers(data.data);
          setCurrentPage(1);
          applyPagination(data.data, 1);
        } else {
          console.error('Invalid cloud category filter results format:', data);
          setError(t('cloud.filterError'));
        }
      } catch (err) {
        console.error('Error filtering cloud servers by category:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [t, fetchCloudServers, applyPagination],
  );

  // Filter servers by tag
  const filterByTag = useCallback(
    async (tag: string) => {
      try {
        setLoading(true);
        setSelectedTag(tag);
        setSelectedCategory(''); // Reset category filter when filtering by tag

        if (!tag) {
          fetchCloudServers();
          return;
        }

        const data: ApiResponse<CloudServer[]> = await apiGet(
          `/cloud/tags/${encodeURIComponent(tag)}`,
        );

        if (data && data.success && Array.isArray(data.data)) {
          setAllServers(data.data);
          setCurrentPage(1);
          applyPagination(data.data, 1);
        } else {
          console.error('Invalid cloud tag filter results format:', data);
          setError(t('cloud.tagFilterError'));
        }
      } catch (err) {
        console.error('Error filtering cloud servers by tag:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [t, fetchCloudServers, applyPagination],
  );

  // Fetch tools for a specific server
  const fetchServerTools = useCallback(async (serverName: string) => {
    try {
      const data: ApiResponse<CloudServerTool[]> = await apiGet(
        `/cloud/servers/${serverName}/tools`,
      );

      if (!data.success) {
        console.error('Failed to fetch cloud server tools:', data);
        throw new Error(data.message || 'Failed to fetch cloud server tools');
      }

      if (data && data.success && Array.isArray(data.data)) {
        return data.data;
      } else {
        console.error('Invalid cloud server tools data format:', data);
        return [];
      }
    } catch (err) {
      console.error(`Error fetching tools for cloud server ${serverName}:`, err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Re-throw API key errors so they can be handled by the component
      if (
        errorMessage === 'MCPROUTER_API_KEY_NOT_CONFIGURED' ||
        errorMessage.toLowerCase().includes('mcprouter api key not configured')
      ) {
        throw err;
      }
      return [];
    }
  }, []);

  // Call a tool on a cloud server
  const callServerTool = useCallback(
    async (serverName: string, toolName: string, args: Record<string, any>) => {
      try {
        const data = await apiPost(`/cloud/servers/${serverName}/tools/${toolName}/call`, {
          arguments: args,
        });

        if (data && data.success) {
          return data.data;
        } else {
          throw new Error(data.message || 'Failed to call tool');
        }
      } catch (err) {
        console.error(`Error calling tool ${toolName} on cloud server ${serverName}:`, err);
        throw err;
      }
    },
    [],
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
    fetchCloudServers();
    fetchCategories();
    fetchTags();
  }, [fetchCloudServers, fetchCategories, fetchTags]);

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
    fetchCloudServers: fetchCloudServers,
    fetchServerByName,
    searchServers,
    filterByCategory,
    filterByTag,
    fetchServerTools,
    callServerTool,
    // Pagination properties and methods
    currentPage,
    totalPages,
    serversPerPage,
    changePage,
    changeServersPerPage,
  };
};
