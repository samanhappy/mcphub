import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { CloudServer, ServerConfig } from '@/types';
import { useCloudData } from '@/hooks/useCloudData';
import { useToast } from '@/contexts/ToastContext';
import { apiPost } from '@/utils/fetchInterceptor';
import CloudServerCard from '@/components/CloudServerCard';
import CloudServerDetail from '@/components/CloudServerDetail';
import MCPRouterApiKeyError from '@/components/MCPRouterApiKeyError';
import Pagination from '@/components/ui/Pagination';

const CloudPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverName } = useParams<{ serverName?: string }>();
  const { showToast } = useToast();
  const [installing, setInstalling] = useState(false);
  const [installedServers, setInstalledServers] = useState<Set<string>>(new Set());

  const {
    servers,
    allServers,
    // categories,
    loading,
    error,
    setError,
    // searchServers,
    // filterByCategory,
    // filterByTag,
    // selectedCategory,
    // selectedTag,
    fetchServerTools,
    callServerTool,
    // Pagination
    currentPage,
    totalPages,
    changePage,
    serversPerPage,
    changeServersPerPage
  } = useCloudData();

  // const [searchQuery, setSearchQuery] = useState('');

  // const handleSearch = (e: React.FormEvent) => {
  //   e.preventDefault();
  //   searchServers(searchQuery);
  // };

  // const handleCategoryClick = (category: string) => {
  //   filterByCategory(category);
  // };

  // const handleClearFilters = () => {
  //   setSearchQuery('');
  //   filterByCategory('');
  //   filterByTag('');
  // };

  const handleServerClick = (server: CloudServer) => {
    navigate(`/cloud/${server.name}`);
  };

  const handleBackToList = () => {
    navigate('/cloud');
  };

  const handleCallTool = async (serverName: string, toolName: string, args: Record<string, any>) => {
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
    return errorMessage === 'MCPROUTER_API_KEY_NOT_CONFIGURED' ||
      errorMessage.toLowerCase().includes('mcprouter api key not configured');
  };

  const handlePageChange = (page: number) => {
    changePage(page);
    // Scroll to top of page when changing pages
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChangeItemsPerPage = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = parseInt(e.target.value, 10);
    changeServersPerPage(newValue);
  };

  // Handle cloud server installation
  const handleInstallCloudServer = async (server: CloudServer, config: ServerConfig) => {
    try {
      setInstalling(true);

      const payload = {
        name: server.name,
        config: config
      };

      const result = await apiPost('/servers', payload);

      if (!result.success) {
        const errorMessage = result?.message || t('server.addError');
        showToast(errorMessage, 'error');
        return;
      }

      // Update installed servers set
      setInstalledServers(prev => new Set(prev).add(server.name));
      showToast(t('cloud.installSuccess', { name: server.title || server.name }), 'success');

    } catch (error) {
      console.error('Error installing cloud server:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(t('cloud.installError', { error: errorMessage }), 'error');
    } finally {
      setInstalling(false);
    }
  };

  // Render detailed view if a server name is in the URL
  if (serverName) {
    return (
      <CloudServerDetail
        serverName={serverName}
        onBack={handleBackToList}
        onCallTool={handleCallTool}
        fetchServerTools={fetchServerTools}
        onInstall={handleInstallCloudServer}
        installing={installing}
        isInstalled={installedServers.has(serverName)}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            {t('cloud.title')}
            <span className="text-sm text-gray-500 font-normal ml-2">
              {t('cloud.subtitle').includes('提供支持') ? '由 ' : 'Powered by '}
              <a
                href="https://mcprouter.co/"
                target="_blank"
                rel="noopener noreferrer"
                className="external-link"
              >
                MCPRouter
              </a>
              {t('cloud.subtitle').includes('提供支持') ? ' 提供支持' : ''}
            </span>
          </h1>
        </div>
      </div>

      {error && (
        <>
          {isMCPRouterApiKeyError(error) ? (
            <MCPRouterApiKeyError />
          ) : (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 error-box rounded-lg">
              <div className="flex items-center justify-between">
                <p>{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="text-red-700 hover:text-red-900 transition-colors duration-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 011.414 0L10 8.586l4.293-4.293a1 1 01.414 1.414L11.414 10l4.293 4.293a1 1 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 01-1.414-1.414L8.586 10 4.293 5.707a1 1 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Search bar at the top 
      <div className="bg-white shadow rounded-lg p-6 mb-6 page-card">
        <form onSubmit={handleSearch} className="flex space-x-4 mb-0">
          <div className="flex-grow">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('cloud.searchPlaceholder')}
              className="shadow appearance-none border border-gray-200 rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 flex items-center btn-primary transition-all duration-200"
          >
            {t('cloud.search')}
          </button>
          {(searchQuery || selectedCategory || selectedTag) && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="border border-gray-300 text-gray-700 font-medium py-2 px-4 rounded hover:bg-gray-50 btn-secondary transition-all duration-200"
            >
              {t('cloud.clearFilters')}
            </button>
          )}
        </form>
      </div>
      */}

      <div className="flex flex-col md:flex-row gap-6">
        {/* Left sidebar for filters 
        <div className="md:w-48 flex-shrink-0">
          <div className="bg-white shadow rounded-lg p-4 mb-6 sticky top-4 page-card">
            {categories.length > 0 ? (
              <div className="mb-6">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-gray-900">{t('cloud.categories')}</h3>
                  {selectedCategory && (
                    <span className="text-xs text-blue-600 cursor-pointer hover:underline transition-colors duration-200" onClick={() => filterByCategory('')}>
                      {t('cloud.clearCategoryFilter')}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {categories.map((category) => (
                    <button
                      key={category}
                      onClick={() => handleCategoryClick(category)}
                      className={`px-3 py-2 rounded text-sm text-left transition-all duration-200 ${selectedCategory === category
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
                  <h3 className="font-medium text-gray-900">{t('cloud.categories')}</h3>
                </div>
                <div className="flex flex-col gap-2 items-center py-4 loading-container">
                  <svg className="animate-spin h-6 w-6 text-blue-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p className="text-sm text-gray-600">{t('app.loading')}</p>
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <div className="mb-3">
                  <h3 className="font-medium text-gray-900">{t('cloud.categories')}</h3>
                </div>
                <p className="text-sm text-gray-600 py-2">{t('cloud.noCategories')}</p>
              </div>
            )}
          </div>
        </div>
        */}

        {/* Main content area */}
        <div className="flex-grow">
          {loading ? (
            <div className="bg-white shadow rounded-lg p-6 flex items-center justify-center">
              <div className="flex flex-col items-center">
                <svg className="animate-spin h-10 w-10 text-blue-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-gray-600">{t('app.loading')}</p>
              </div>
            </div>
          ) : servers.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-6">
              <p className="text-gray-600">{t('cloud.noServers')}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {servers.map((server, index) => (
                  <CloudServerCard
                    key={index}
                    server={server}
                    onClick={handleServerClick}
                  />
                ))}
              </div>

              <div className="flex justify-between items-center mb-4">
                <div className="text-sm text-gray-500">
                  {t('cloud.showing', {
                    from: (currentPage - 1) * serversPerPage + 1,
                    to: Math.min(currentPage * serversPerPage, allServers.length),
                    total: allServers.length
                  })}
                </div>
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
                <div className="flex items-center space-x-2">
                  <label htmlFor="perPage" className="text-sm text-gray-600">
                    {t('cloud.perPage')}:
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

              <div className="mt-6">
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CloudPage;
