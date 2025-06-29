import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { MarketServer, ServerConfig } from '@/types';
import { useMarketData } from '@/hooks/useMarketData';
import { useToast } from '@/contexts/ToastContext';
import MarketServerCard from '@/components/MarketServerCard';
import MarketServerDetail from '@/components/MarketServerDetail';
import Pagination from '@/components/ui/Pagination';

const MarketPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverName } = useParams<{ serverName?: string }>();
  const { showToast } = useToast();

  const {
    servers,
    allServers,
    categories,
    loading,
    error,
    setError,
    searchServers,
    filterByCategory,
    filterByTag,
    selectedCategory,
    selectedTag,
    installServer,
    fetchServerByName,
    isServerInstalled,
    // Pagination
    currentPage,
    totalPages,
    changePage,
    serversPerPage,
    changeServersPerPage
  } = useMarketData();

  const [selectedServer, setSelectedServer] = useState<MarketServer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [installing, setInstalling] = useState(false);

  // Load server details if a server name is in the URL
  useEffect(() => {
    const loadServerDetails = async () => {
      if (serverName) {
        const server = await fetchServerByName(serverName);
        if (server) {
          setSelectedServer(server);
        } else {
          // If server not found, navigate back to market page
          navigate('/market');
        }
      } else {
        setSelectedServer(null);
      }
    };

    loadServerDetails();
  }, [serverName, fetchServerByName, navigate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchServers(searchQuery);
  };

  const handleCategoryClick = (category: string) => {
    filterByCategory(category);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    filterByCategory('');
    filterByTag('');
  };

  const handleServerClick = (server: MarketServer) => {
    navigate(`/market/${server.name}`);
  };

  const handleBackToList = () => {
    navigate('/market');
  };

  const handleInstall = async (server: MarketServer, config: ServerConfig) => {
    try {
      setInstalling(true);
      // Pass the server object and the config to the installServer function
      const success = await installServer(server, config);
      if (success) {
        // Show success message using toast instead of alert
        showToast(t('market.installSuccess', { serverName: server.display_name }), 'success');
      }
    } finally {
      setInstalling(false);
    }
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

  // Render detailed view if a server is selected
  if (selectedServer) {
    return (
      <MarketServerDetail
        server={selectedServer}
        onBack={handleBackToList}
        onInstall={handleInstall}
        installing={installing}
        isInstalled={isServerInstalled(selectedServer.name)}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            {t('market.title')}
            <span className="text-sm text-gray-500 font-normal ml-2">{t('pages.market.title').split(' - ')[1]}</span>
          </h1>
        </div>
      </div>

      {error && (
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

      {/* Search bar at the top */}
      <div className="bg-white shadow rounded-lg p-6 mb-6 page-card">
        <form onSubmit={handleSearch} className="flex space-x-4 mb-0">
          <div className="flex-grow">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('market.searchPlaceholder')}
              className="shadow appearance-none border border-gray-200 rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 flex items-center btn-primary transition-all duration-200"
          >
            {t('market.search')}
          </button>
          {(searchQuery || selectedCategory || selectedTag) && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="border border-gray-300 text-gray-700 font-medium py-2 px-4 rounded hover:bg-gray-50 btn-secondary transition-all duration-200"
            >
              {t('market.clearFilters')}
            </button>
          )}
        </form>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Left sidebar for filters (without search) */}
        <div className="md:w-48 flex-shrink-0">
          <div className="bg-white shadow rounded-lg p-4 mb-6 sticky top-4 page-card">
            {/* Categories */}
            {categories.length > 0 ? (
              <div className="mb-6">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-gray-900">{t('market.categories')}</h3>
                  {selectedCategory && (
                    <span className="text-xs text-blue-600 cursor-pointer hover:underline transition-colors duration-200" onClick={() => filterByCategory('')}>
                      {t('market.clearCategoryFilter')}
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
                  <h3 className="font-medium text-gray-900">{t('market.categories')}</h3>
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
                  <h3 className="font-medium text-gray-900">{t('market.categories')}</h3>
                </div>
                <p className="text-sm text-gray-600 py-2">{t('market.noCategories')}</p>
              </div>
            )}

            {/* Tags */}
            {/* {tags.length > 0 && (
              <div className="mb-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center">
                    <h3 className="font-medium text-gray-900">{t('market.tags')}</h3>
                    <button
                      onClick={toggleTagsVisibility}
                      className="ml-2 p-1 text-gray-600 hover:text-blue-600 hover:bg-gray-100 rounded-full"
                      aria-label={showTags ? t('market.hideTags') : t('market.showTags')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform ${showTags ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 011.414 0L10 10.586l3.293-3.293a1 1 011.414 1.414l-4 4a1 1 01-1.414 0l-4-4a1 1 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                  {selectedTag && (
                    <span className="text-xs text-blue-600 cursor-pointer hover:underline" onClick={() => filterByTag('')}>
                      {t('market.clearTagFilter')}
                    </span>
                  )}
                </div>
                {showTags && (
                  <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => handleTagClick(tag)}
                        className={`px-2 py-1 rounded text-xs ${selectedTag === tag
                            ? 'bg-green-100 text-green-800 font-medium'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )} */}
          </div>
        </div>

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
              <p className="text-gray-600">{t('market.noServers')}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {servers.map((server, index) => (
                  <MarketServerCard
                    key={index}
                    server={server}
                    onClick={handleServerClick}
                  />
                ))}
              </div>

              <div className="flex justify-between items-center mb-4">
                <div className="text-sm text-gray-500">
                  {t('market.showing', {
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
                    {t('market.perPage')}:
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

export default MarketPage;
