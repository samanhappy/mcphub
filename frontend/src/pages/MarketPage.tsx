import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  MarketServer,
  CloudServer,
  ServerConfig,
  RegistryServerEntry,
  RegistryServerData,
} from '@/types';
import { useMarketData } from '@/hooks/useMarketData';
import { useCloudData } from '@/hooks/useCloudData';
import { useRegistryData } from '@/hooks/useRegistryData';
import { useToast } from '@/contexts/ToastContext';
import { apiPost } from '@/utils/fetchInterceptor';
import MarketServerCard from '@/components/MarketServerCard';
import MarketServerDetail from '@/components/MarketServerDetail';
import CloudServerCard from '@/components/CloudServerCard';
import CloudServerDetail from '@/components/CloudServerDetail';
import RegistryServerCard from '@/components/RegistryServerCard';
import RegistryServerDetail from '@/components/RegistryServerDetail';
import MCPRouterApiKeyError from '@/components/MCPRouterApiKeyError';
import Pagination from '@/components/ui/Pagination';
import CursorPagination from '@/components/ui/CursorPagination';

const MarketPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverName } = useParams<{ serverName?: string }>();
  const { showToast } = useToast();

  // Get tab from URL search params
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'cloud';

  // Local market data
  const {
    servers: localServers,
    allServers: allLocalServers,
    categories: localCategories,
    loading: localLoading,
    error: localError,
    setError: setLocalError,
    searchServers: searchLocalServers,
    filterByCategory: filterLocalByCategory,
    filterByTag: filterLocalByTag,
    selectedCategory: selectedLocalCategory,
    selectedTag: selectedLocalTag,
    installServer: installLocalServer,
    fetchServerByName: fetchLocalServerByName,
    isServerInstalled,
    // Pagination
    currentPage: localCurrentPage,
    totalPages: localTotalPages,
    changePage: changeLocalPage,
    serversPerPage: localServersPerPage,
    changeServersPerPage: changeLocalServersPerPage,
  } = useMarketData();

  // Cloud market data
  const {
    servers: cloudServers,
    allServers: allCloudServers,
    loading: cloudLoading,
    error: cloudError,
    setError: setCloudError,
    fetchServerTools,
    callServerTool,
    // Pagination
    currentPage: cloudCurrentPage,
    totalPages: cloudTotalPages,
    changePage: changeCloudPage,
    serversPerPage: cloudServersPerPage,
    changeServersPerPage: changeCloudServersPerPage,
  } = useCloudData();

  // Registry data
  const {
    servers: registryServers,
    allServers: allRegistryServers,
    loading: registryLoading,
    error: registryError,
    setError: setRegistryError,
    searchServers: searchRegistryServers,
    clearSearch: clearRegistrySearch,
    fetchServerByName: fetchRegistryServerByName,
    fetchServerVersions: fetchRegistryServerVersions,
    // Cursor-based pagination
    currentPage: registryCurrentPage,
    totalPages: registryTotalPages,
    hasNextPage: registryHasNextPage,
    hasPreviousPage: registryHasPreviousPage,
    changePage: changeRegistryPage,
    goToNextPage: goToRegistryNextPage,
    goToPreviousPage: goToRegistryPreviousPage,
    serversPerPage: registryServersPerPage,
    changeServersPerPage: changeRegistryServersPerPage,
  } = useRegistryData();

  const [selectedServer, setSelectedServer] = useState<MarketServer | null>(null);
  const [selectedCloudServer, setSelectedCloudServer] = useState<CloudServer | null>(null);
  const [selectedRegistryServer, setSelectedRegistryServer] = useState<RegistryServerEntry | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [registrySearchQuery, setRegistrySearchQuery] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installedCloudServers, setInstalledCloudServers] = useState<Set<string>>(new Set());
  const [installedRegistryServers, setInstalledRegistryServers] = useState<Set<string>>(new Set());

  // Load server details if a server name is in the URL
  useEffect(() => {
    const loadServerDetails = async () => {
      if (serverName) {
        // Determine if it's a cloud, local, or registry server based on the current tab
        if (currentTab === 'cloud') {
          // Try to find the server in cloud servers
          const server = cloudServers.find((s) => s.name === serverName);
          if (server) {
            setSelectedCloudServer(server);
          } else {
            // If server not found, navigate back to market page
            navigate('/market?tab=cloud');
          }
        } else if (currentTab === 'registry') {
          console.log('Loading registry server details for:', serverName);
          // Registry market
          const serverEntry = await fetchRegistryServerByName(serverName);
          if (serverEntry) {
            setSelectedRegistryServer(serverEntry);
          } else {
            // If server not found, navigate back to market page
            navigate('/market?tab=registry');
          }
        } else {
          // Local market
          const server = await fetchLocalServerByName(serverName);
          if (server) {
            setSelectedServer(server);
          } else {
            // If server not found, navigate back to market page
            navigate('/market?tab=local');
          }
        }
      } else {
        setSelectedServer(null);
        setSelectedCloudServer(null);
        setSelectedRegistryServer(null);
      }
    };

    loadServerDetails();
  }, [
    serverName,
    currentTab,
    cloudServers,
    fetchLocalServerByName,
    fetchRegistryServerByName,
    navigate,
  ]);

  // Tab switching handler
  const switchTab = (tab: 'local' | 'cloud' | 'registry') => {
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('tab', tab);
    setSearchParams(newSearchParams);
    // Clear any selected server when switching tabs
    if (serverName) {
      navigate('/market?' + newSearchParams.toString());
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentTab === 'local') {
      searchLocalServers(searchQuery);
    } else if (currentTab === 'registry') {
      searchRegistryServers(registrySearchQuery);
    }
    // Cloud search is not implemented in the original cloud page
  };

  const handleCategoryClick = (category: string) => {
    if (currentTab === 'local') {
      filterLocalByCategory(category);
    }
  };

  const handleClearFilters = () => {
    if (currentTab === 'local') {
      setSearchQuery('');
      filterLocalByCategory('');
      filterLocalByTag('');
    } else if (currentTab === 'registry') {
      setRegistrySearchQuery('');
      clearRegistrySearch();
    }
  };

  const handleServerClick = (server: MarketServer | CloudServer | RegistryServerEntry) => {
    if (currentTab === 'cloud') {
      const cloudServer = server as CloudServer;
      navigate(`/market/${cloudServer.name}?tab=cloud`);
    } else if (currentTab === 'registry') {
      const registryServer = server as RegistryServerEntry;
      console.log('Registry server clicked:', registryServer);
      const serverName = registryServer.server?.name;
      console.log('Server name extracted:', serverName);
      if (serverName) {
        const targetUrl = `/market/${encodeURIComponent(serverName)}?tab=registry`;
        console.log('Navigating to:', targetUrl);
        navigate(targetUrl);
      } else {
        console.error('Server name is undefined in registry server:', registryServer);
      }
    } else {
      const marketServer = server as MarketServer;
      navigate(`/market/${marketServer.name}?tab=local`);
    }
  };

  const handleBackToList = () => {
    navigate(`/market?tab=${currentTab}`);
  };

  const handleLocalInstall = async (server: MarketServer, config: ServerConfig) => {
    try {
      setInstalling(true);
      const success = await installLocalServer(server, config);
      if (success) {
        showToast(t('market.installSuccess', { serverName: server.display_name }), 'success');
      }
    } finally {
      setInstalling(false);
    }
  };

  // Handle cloud server installation
  const handleCloudInstall = async (server: CloudServer, config: ServerConfig) => {
    try {
      setInstalling(true);

      const payload = {
        name: server.name,
        config: config,
      };

      const result = await apiPost('/servers', payload);

      if (!result.success) {
        const errorMessage = result?.message || t('server.addError');
        showToast(errorMessage, 'error');
        return;
      }

      // Update installed servers set
      setInstalledCloudServers((prev) => new Set(prev).add(server.name));
      showToast(t('cloud.installSuccess', { name: server.title || server.name }), 'success');
    } catch (error) {
      console.error('Error installing cloud server:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(t('cloud.installError', { error: errorMessage }), 'error');
    } finally {
      setInstalling(false);
    }
  };

  // Handle registry server installation
  const handleRegistryInstall = async (server: RegistryServerData, config: ServerConfig) => {
    try {
      setInstalling(true);

      const payload = {
        name: server.name,
        config: config,
      };

      const result = await apiPost('/servers', payload);

      if (!result.success) {
        const errorMessage = result?.message || t('server.addError');
        showToast(errorMessage, 'error');
        return;
      }

      // Update installed servers set
      setInstalledRegistryServers((prev) => new Set(prev).add(server.name));
      showToast(t('registry.installSuccess', { name: server.title || server.name }), 'success');
    } catch (error) {
      console.error('Error installing registry server:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(t('registry.installError', { error: errorMessage }), 'error');
    } finally {
      setInstalling(false);
    }
  };

  const handleCallTool = async (
    serverName: string,
    toolName: string,
    args: Record<string, any>,
  ) => {
    try {
      const result = await callServerTool(serverName, toolName, args);
      showToast(t('cloud.toolCallSuccess', { toolName }), 'success');
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Don't show toast for API key errors, let the component handle it
      if (!isMCPRouterApiKeyError(errorMessage)) {
        showToast(t('cloud.toolCallError', { toolName, error: errorMessage }), 'error');
      }
      throw error;
    }
  };

  // Helper function to check if error is MCPRouter API key not configured
  const isMCPRouterApiKeyError = (errorMessage: string) => {
    return (
      errorMessage === 'MCPROUTER_API_KEY_NOT_CONFIGURED' ||
      errorMessage.toLowerCase().includes('mcprouter api key not configured')
    );
  };

  const handlePageChange = (page: number) => {
    if (currentTab === 'local') {
      changeLocalPage(page);
    } else if (currentTab === 'registry') {
      changeRegistryPage(page);
    } else {
      changeCloudPage(page);
    }
    // Scroll to top of page when changing pages
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChangeItemsPerPage = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = parseInt(e.target.value, 10);
    if (currentTab === 'local') {
      changeLocalServersPerPage(newValue);
    } else if (currentTab === 'registry') {
      changeRegistryServersPerPage(newValue);
    } else {
      changeCloudServersPerPage(newValue);
    }
  };

  // Render detailed view if a server is selected
  if (selectedServer) {
    return (
      <MarketServerDetail
        server={selectedServer}
        onBack={handleBackToList}
        onInstall={handleLocalInstall}
        installing={installing}
        isInstalled={isServerInstalled(selectedServer.name)}
      />
    );
  }

  // Render cloud server detail if selected
  if (selectedCloudServer) {
    return (
      <CloudServerDetail
        serverName={selectedCloudServer.name}
        onBack={handleBackToList}
        onCallTool={handleCallTool}
        fetchServerTools={fetchServerTools}
        onInstall={handleCloudInstall}
        installing={installing}
        isInstalled={installedCloudServers.has(selectedCloudServer.name)}
      />
    );
  }

  // Render registry server detail if selected
  if (selectedRegistryServer) {
    return (
      <RegistryServerDetail
        serverEntry={selectedRegistryServer}
        onBack={handleBackToList}
        onInstall={handleRegistryInstall}
        installing={installing}
        isInstalled={installedRegistryServers.has(selectedRegistryServer.server.name)}
        fetchVersions={fetchRegistryServerVersions}
      />
    );
  }

  // Get current data based on active tab
  const isLocalTab = currentTab === 'local';
  const isRegistryTab = currentTab === 'registry';
  const servers = isLocalTab ? localServers : isRegistryTab ? registryServers : cloudServers;
  const allServers = isLocalTab
    ? allLocalServers
    : isRegistryTab
      ? allRegistryServers
      : allCloudServers;
  const categories = isLocalTab ? localCategories : [];
  const loading = isLocalTab ? localLoading : isRegistryTab ? registryLoading : cloudLoading;
  const error = isLocalTab ? localError : isRegistryTab ? registryError : cloudError;
  const setError = isLocalTab ? setLocalError : isRegistryTab ? setRegistryError : setCloudError;
  const selectedCategory = isLocalTab ? selectedLocalCategory : '';
  const selectedTag = isLocalTab ? selectedLocalTag : '';
  const currentPage = isLocalTab
    ? localCurrentPage
    : isRegistryTab
      ? registryCurrentPage
      : cloudCurrentPage;
  const totalPages = isLocalTab
    ? localTotalPages
    : isRegistryTab
      ? registryTotalPages
      : cloudTotalPages;
  const serversPerPage = isLocalTab
    ? localServersPerPage
    : isRegistryTab
      ? registryServersPerPage
      : cloudServersPerPage;

  return (
    <div>
      {/* Tab Navigation */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-3">
            <button
              onClick={() => switchTab('cloud')}
              className={`py-2 px-1 border-b-2 font-medium text-lg hover:cursor-pointer transition-colors duration-200 ${
                !isLocalTab && !isRegistryTab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t('cloud.title')}
              <span className="text-xs text-gray-400 font-normal ml-1">
                (
                <a
                  href="https://mcprouter.co"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="external-link"
                >
                  MCPRouter
                </a>
                )
              </span>
            </button>
            <button
              onClick={() => switchTab('local')}
              className={`py-2 px-1 border-b-2 font-medium text-lg hover:cursor-pointer transition-colors duration-200 ${
                isLocalTab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t('market.title')}
              <span className="text-xs text-gray-400 font-normal ml-1">
                (
                <a
                  href="https://mcpm.sh"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="external-link"
                >
                  MCPM
                </a>
                )
              </span>
            </button>
            <button
              onClick={() => switchTab('registry')}
              className={`py-2 px-1 border-b-2 font-medium text-lg hover:cursor-pointer transition-colors duration-200 ${
                isRegistryTab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t('registry.title')}
              <span className="text-xs text-gray-400 font-normal ml-1">
                (
                <a
                  href="https://registry.modelcontextprotocol.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="external-link"
                >
                  {t('registry.official')}
                </a>
                )
              </span>
            </button>
          </nav>
        </div>
      </div>

      {error && (
        <>
          {!isLocalTab && isMCPRouterApiKeyError(error) ? (
            <MCPRouterApiKeyError />
          ) : (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 error-box rounded-lg">
              <div className="flex items-center justify-between">
                <p>{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="text-red-700 hover:text-red-900 transition-colors duration-200"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 011.414 0L10 8.586l4.293-4.293a1 1 01.414 1.414L11.414 10l4.293 4.293a1 1 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 01-1.414-1.414L8.586 10 4.293 5.707a1 1 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Search bar for local market and registry */}
      {(isLocalTab || isRegistryTab) && (
        <div className="bg-white shadow rounded-lg p-6 mb-6 page-card">
          <form onSubmit={handleSearch} className="flex space-x-4 mb-0">
            <div className="flex-grow">
              <input
                type="text"
                value={isRegistryTab ? registrySearchQuery : searchQuery}
                onChange={(e) => {
                  if (isRegistryTab) {
                    setRegistrySearchQuery(e.target.value);
                  } else {
                    setSearchQuery(e.target.value);
                  }
                }}
                placeholder={
                  isRegistryTab ? t('registry.searchPlaceholder') : t('market.searchPlaceholder')
                }
                className="shadow appearance-none border border-gray-200 rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 flex items-center btn-primary transition-all duration-200"
            >
              {isRegistryTab ? t('registry.search') : t('market.search')}
            </button>
            {((isLocalTab && (searchQuery || selectedCategory || selectedTag)) ||
              (isRegistryTab && registrySearchQuery)) && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="border border-gray-300 text-gray-700 font-medium py-2 px-4 rounded hover:bg-gray-50 btn-secondary transition-all duration-200"
              >
                {isRegistryTab ? t('registry.clearFilters') : t('market.clearFilters')}
              </button>
            )}
          </form>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6">
        {/* Left sidebar for filters (local market only) */}
        {isLocalTab && (
          <div className="md:w-48 flex-shrink-0">
            <div className="bg-white shadow rounded-lg p-4 mb-6 sticky top-4 page-card">
              {/* Categories */}
              {categories.length > 0 ? (
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-medium text-gray-900">{t('market.categories')}</h3>
                    {selectedCategory && (
                      <span
                        className="text-xs text-blue-600 cursor-pointer hover:underline transition-colors duration-200"
                        onClick={() => filterLocalByCategory('')}
                      >
                        {t('market.clearCategoryFilter')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {categories.map((category) => (
                      <button
                        key={category}
                        onClick={() => handleCategoryClick(category)}
                        className={`px-3 py-2 rounded text-sm text-left transition-all duration-200 ${
                          selectedCategory === category
                            ? 'bg-blue-100 text-blue-800 font-medium btn-primary'
                            : 'bg-gray-100 text-gray-800 hover:bg-gray-200 btn-secondary'
                        }`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
              ) : loading ? (
                <div className="mb-6">
                  <div className="mb-3">
                    <h3 className="font-medium text-gray-900">{t('market.categories')}</h3>
                  </div>
                  <div className="flex flex-col gap-2 items-center py-4 loading-container">
                    <svg
                      className="animate-spin h-6 w-6 text-blue-500 mb-2"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <p className="text-sm text-gray-600">{t('app.loading')}</p>
                  </div>
                </div>
              ) : (
                <div className="mb-6">
                  <div className="mb-3">
                    <h3 className="font-medium text-gray-900">{t('market.categories')}</h3>
                  </div>
                  <p className="text-sm text-gray-600 py-2">{t('market.noCategories')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex-grow">
          {loading ? (
            <div className="bg-white shadow rounded-lg p-6 flex items-center justify-center">
              <div className="flex flex-col items-center">
                <svg
                  className="animate-spin h-10 w-10 text-blue-500 mb-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <p className="text-gray-600">{t('app.loading')}</p>
              </div>
            </div>
          ) : servers.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-6">
              <p className="text-gray-600">
                {isLocalTab
                  ? t('market.noServers')
                  : isRegistryTab
                    ? t('registry.noServers')
                    : t('cloud.noServers')}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {servers.map((server, index) =>
                  isLocalTab ? (
                    <MarketServerCard
                      key={index}
                      server={server as MarketServer}
                      onClick={handleServerClick}
                    />
                  ) : isRegistryTab ? (
                    <RegistryServerCard
                      key={index}
                      serverEntry={server as RegistryServerEntry}
                      onClick={handleServerClick}
                    />
                  ) : (
                    <CloudServerCard
                      key={index}
                      server={server as CloudServer}
                      onClick={handleServerClick}
                    />
                  ),
                )}
              </div>

              <div className="flex items-center mb-4">
                <div className="flex-[2] text-sm text-gray-500">
                  {isLocalTab
                    ? t('market.showing', {
                        from: (currentPage - 1) * serversPerPage + 1,
                        to: Math.min(currentPage * serversPerPage, allServers.length),
                        total: allServers.length,
                      })
                    : isRegistryTab
                      ? t('registry.showing', {
                          from: (currentPage - 1) * serversPerPage + 1,
                          to: (currentPage - 1) * serversPerPage + servers.length,
                          total: allServers.length + (registryHasNextPage ? '+' : ''),
                        })
                      : t('cloud.showing', {
                          from: (currentPage - 1) * serversPerPage + 1,
                          to: Math.min(currentPage * serversPerPage, allServers.length),
                          total: allServers.length,
                        })}
                </div>
                <div className="flex-[4] flex justify-center">
                  {isRegistryTab ? (
                    <CursorPagination
                      currentPage={currentPage}
                      hasNextPage={registryHasNextPage}
                      hasPreviousPage={registryHasPreviousPage}
                      onNextPage={goToRegistryNextPage}
                      onPreviousPage={goToRegistryPreviousPage}
                    />
                  ) : (
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={handlePageChange}
                    />
                  )}
                </div>
                <div className="flex-[2] flex items-center justify-end space-x-2">
                  <label htmlFor="perPage" className="text-sm text-gray-600">
                    {isLocalTab
                      ? t('market.perPage')
                      : isRegistryTab
                        ? t('registry.perPage')
                        : t('cloud.perPage')}
                    :
                  </label>
                  <select
                    id="perPage"
                    value={serversPerPage}
                    onChange={handleChangeItemsPerPage}
                    className="border rounded p-1 text-sm btn-secondary outline-none"
                  >
                    <option value="6">6</option>
                    <option value="9">9</option>
                    <option value="12">12</option>
                    <option value="24">24</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarketPage;
