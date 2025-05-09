import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MarketServer, ApiResponse } from '@/types';

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
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch('/api/market/servers', {
        headers: {
          'x-auth-token': token || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      
      const data: ApiResponse<MarketServer[]> = await response.json();
      
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
  const applyPagination = useCallback((data: MarketServer[], page: number, itemsPerPage = serversPerPage) => {
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
  }, [serversPerPage]);

  // Change page
  const changePage = useCallback((page: number) => {
    setCurrentPage(page);
    applyPagination(allServers, page, serversPerPage);
  }, [allServers, applyPagination, serversPerPage]);

  // Fetch all categories
  const fetchCategories = useCallback(async () => {
    try {
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch('/api/market/categories', {
        headers: {
          'x-auth-token': token || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      
      const data: ApiResponse<string[]> = await response.json();
      
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
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch('/api/market/tags', {
        headers: {
          'x-auth-token': token || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      
      const data: ApiResponse<string[]> = await response.json();
      
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
  const fetchServerByName = useCallback(async (name: string) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(`/api/market/servers/${name}`, {
        headers: {
          'x-auth-token': token || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      
      const data: ApiResponse<MarketServer> = await response.json();
      
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
  }, [t]);

  // Search servers by query
  const searchServers = useCallback(async (query: string) => {
    try {
      setLoading(true);
      setSearchQuery(query);
      
      if (!query.trim()) {
        // Fetch fresh data from server instead of just applying pagination
        fetchMarketServers();
        return;
      }
      
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(`/api/market/servers/search?query=${encodeURIComponent(query)}`, {
        headers: {
          'x-auth-token': token || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      
      const data: ApiResponse<MarketServer[]> = await response.json();
      
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
  }, [t, allServers, applyPagination, fetchMarketServers]);

  // Filter servers by category
  const filterByCategory = useCallback(async (category: string) => {
    try {
      setLoading(true);
      setSelectedCategory(category);
      setSelectedTag(''); // Reset tag filter when filtering by category
      
      if (!category) {
        fetchMarketServers();
        return;
      }
      
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(`/api/market/categories/${encodeURIComponent(category)}`, {
        headers: {
          'x-auth-token': token || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      
      const data: ApiResponse<MarketServer[]> = await response.json();
      
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
  }, [t, fetchMarketServers, applyPagination]);

  // Filter servers by tag
  const filterByTag = useCallback(async (tag: string) => {
    try {
      setLoading(true);
      setSelectedTag(tag);
      setSelectedCategory(''); // Reset category filter when filtering by tag
      
      if (!tag) {
        fetchMarketServers();
        return;
      }
      
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(`/api/market/tags/${encodeURIComponent(tag)}`, {
        headers: {
          'x-auth-token': token || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      
      const data: ApiResponse<MarketServer[]> = await response.json();
      
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
  }, [t, fetchMarketServers, applyPagination]);

  // Fetch installed servers
  const fetchInstalledServers = useCallback(async () => {
    try {
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch('/api/servers', {
        headers: {
          'x-auth-token': token || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      
      const data = await response.json();
      
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
  const isServerInstalled = useCallback((serverName: string) => {
    return installedServers.includes(serverName);
  }, [installedServers]);

  // Install server to the local environment
  const installServer = useCallback(async (server: MarketServer) => {
    try {
      const installType = server.installations?.npm ? 'npm' : Object.keys(server.installations || {}).length > 0 ? Object.keys(server.installations)[0] : null;
      
      if (!installType || !server.installations?.[installType]) {
        setError(t('market.noInstallationMethod'));
        return false;
      }
      
      const installation = server.installations[installType];
      
      // Prepare server configuration
      const serverConfig = {
        name: server.name,
        config: {
          command: installation.command,
          args: installation.args,
          env: installation.env || {}
        }
      };
      
      // Call the createServer API
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || ''
        },
        body: JSON.stringify(serverConfig),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Status: ${response.status}`);
      }
      
      // Update installed servers list after successful installation
      await fetchInstalledServers();
      return true;
    } catch (err) {
      console.error('Error installing server:', err);
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [t, fetchInstalledServers]);

  // Change servers per page
  const changeServersPerPage = useCallback((perPage: number) => {
    setServersPerPage(perPage);
    setCurrentPage(1);
    applyPagination(allServers, 1, perPage);
  }, [allServers, applyPagination]);

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
    isServerInstalled
  };
};