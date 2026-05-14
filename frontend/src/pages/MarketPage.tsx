import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search, AlertCircle, X, ChevronDown } from 'lucide-react';
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

  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'cloud';

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
    currentPage: localCurrentPage,
    totalPages: localTotalPages,
    changePage: changeLocalPage,
    serversPerPage: localServersPerPage,
    changeServersPerPage: changeLocalServersPerPage,
  } = useMarketData();

  const {
    servers: cloudServers,
    allServers: allCloudServers,
    loading: cloudLoading,
    error: cloudError,
    setError: setCloudError,
    fetchServerTools,
    callServerTool,
    currentPage: cloudCurrentPage,
    totalPages: cloudTotalPages,
    changePage: changeCloudPage,
    serversPerPage: cloudServersPerPage,
    changeServersPerPage: changeCloudServersPerPage,
  } = useCloudData();

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

  useEffect(() => {
    const loadServerDetails = async () => {
      if (serverName) {
        if (currentTab === 'cloud') {
          const server = cloudServers.find((s) => s.name === serverName);
          if (server) setSelectedCloudServer(server);
          else navigate('/market?tab=cloud');
        } else if (currentTab === 'registry') {
          const serverEntry = await fetchRegistryServerByName(serverName);
          if (serverEntry) setSelectedRegistryServer(serverEntry);
          else navigate('/market?tab=registry');
        } else {
          const server = await fetchLocalServerByName(serverName);
          if (server) setSelectedServer(server);
          else navigate('/market?tab=local');
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

  const switchTab = (tab: 'local' | 'cloud' | 'registry') => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab);
    setSearchParams(newParams);
    if (serverName) navigate('/market?' + newParams.toString());
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentTab === 'local') searchLocalServers(searchQuery);
    else if (currentTab === 'registry') searchRegistryServers(registrySearchQuery);
  };

  const handleCategoryClick = (category: string) => {
    if (currentTab === 'local') filterLocalByCategory(category);
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
      const name = registryServer.server?.name;
      if (name) navigate(`/market/${encodeURIComponent(name)}?tab=registry`);
    } else {
      const marketServer = server as MarketServer;
      navigate(`/market/${marketServer.name}?tab=local`);
    }
  };

  const handleBackToList = () => navigate(`/market?tab=${currentTab}`);

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

  const handleCloudInstall = async (server: CloudServer, config: ServerConfig) => {
    try {
      setInstalling(true);
      const payload = { name: server.name, config };
      const result = await apiPost('/servers', payload);
      if (!result.success) {
        showToast(result?.message || t('server.addError'), 'error');
        return;
      }
      setInstalledCloudServers((prev) => new Set(prev).add(server.name));
      showToast(t('cloud.installSuccess', { name: server.title || server.name }), 'success');
    } catch (error) {
      showToast(
        t('cloud.installError', { error: error instanceof Error ? error.message : String(error) }),
        'error',
      );
    } finally {
      setInstalling(false);
    }
  };

  const handleRegistryInstall = async (server: RegistryServerData, config: ServerConfig) => {
    try {
      setInstalling(true);
      const payload = { name: server.name, config };
      const result = await apiPost('/servers', payload);
      if (!result.success) {
        showToast(result?.message || t('server.addError'), 'error');
        return;
      }
      setInstalledRegistryServers((prev) => new Set(prev).add(server.name));
      showToast(t('registry.installSuccess', { name: server.title || server.name }), 'success');
    } catch (error) {
      showToast(
        t('registry.installError', { error: error instanceof Error ? error.message : String(error) }),
        'error',
      );
    } finally {
      setInstalling(false);
    }
  };

  const handleCallTool = async (
    name: string,
    toolName: string,
    args: Record<string, any>,
  ) => {
    try {
      const result = await callServerTool(name, toolName, args);
      showToast(t('cloud.toolCallSuccess', { toolName }), 'success');
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!isMCPRouterApiKeyError(errorMessage)) {
        showToast(t('cloud.toolCallError', { toolName, error: errorMessage }), 'error');
      }
      throw error;
    }
  };

  const isMCPRouterApiKeyError = (errorMessage: string) =>
    errorMessage === 'MCPROUTER_API_KEY_NOT_CONFIGURED' ||
    errorMessage.toLowerCase().includes('mcprouter api key not configured');

  const handlePageChange = (page: number) => {
    if (currentTab === 'local') changeLocalPage(page);
    else if (currentTab === 'registry') changeRegistryPage(page);
    else changeCloudPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChangeItemsPerPage = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = parseInt(e.target.value, 10);
    if (currentTab === 'local') changeLocalServersPerPage(v);
    else if (currentTab === 'registry') changeRegistryServersPerPage(v);
    else changeCloudServersPerPage(v);
  };

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

  const tabs: { id: 'cloud' | 'local' | 'registry'; label: string; sourceLabel: string; sourceUrl: string }[] = [
    { id: 'cloud', label: t('cloud.title'), sourceLabel: 'MCPRouter', sourceUrl: 'https://mcprouter.co' },
    { id: 'local', label: t('market.title'), sourceLabel: 'MCPM', sourceUrl: 'https://mcpm.sh' },
    {
      id: 'registry',
      label: t('registry.title'),
      sourceLabel: t('registry.official'),
      sourceUrl: 'https://registry.modelcontextprotocol.io',
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="hub-h1">{t('nav.market')}</h1>
          <p className="hub-sub">
            {tabs.map((tab) => tab.label).join(' · ')}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5">
        <div style={{ borderBottom: '1px solid var(--hub-line)' }}>
          <nav className="flex -mb-px gap-1.5">
            {tabs.map((tab) => {
              const active = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  className="py-2 px-3 transition-colors text-[14px]"
                  style={{
                    borderBottom: '2px solid ' + (active ? 'var(--hub-ink)' : 'transparent'),
                    color: active ? 'var(--hub-ink)' : 'var(--hub-ink-3)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {tab.label}
                  <a
                    href={tab.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hub-mono ml-1.5"
                    style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    ({tab.sourceLabel})
                  </a>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {error && (
        <>
          {!isLocalTab && isMCPRouterApiKeyError(error) ? (
            <MCPRouterApiKeyError />
          ) : (
            <div
              className="hub-card flex items-center justify-between gap-3 mb-4"
              style={{
                padding: '10px 14px',
                borderColor: 'oklch(0.85 0.1 25)',
                background: 'oklch(0.97 0.03 25)',
                color: 'oklch(0.4 0.18 25)',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span className="truncate text-[13px]">{error}</span>
              </div>
              <button className="hub-icon-btn sm" onClick={() => setError(null)}>
                <X size={13} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Search bar */}
      {(isLocalTab || isRegistryTab) && (
        <form onSubmit={handleSearch} className="hub-card flex items-center gap-2 px-3 mb-5" style={{ padding: 6 }}>
          <Search size={16} style={{ color: 'var(--hub-ink-3)', margin: '0 6px 0 6px' }} />
          <input
            type="text"
            value={isRegistryTab ? registrySearchQuery : searchQuery}
            onChange={(e) => {
              if (isRegistryTab) setRegistrySearchQuery(e.target.value);
              else setSearchQuery(e.target.value);
            }}
            placeholder={
              isRegistryTab ? t('registry.searchPlaceholder') : t('market.searchPlaceholder')
            }
            className="flex-1 bg-transparent outline-none"
            style={{ height: 32, fontSize: 14, color: 'var(--hub-ink)' }}
          />
          <button type="submit" className="hub-btn">
            {t('common.search')}
          </button>
          {((isLocalTab && (searchQuery || selectedCategory || selectedTag)) ||
            (isRegistryTab && registrySearchQuery)) && (
            <button type="button" onClick={handleClearFilters} className="hub-btn ghost">
              {t('common.clear')}
            </button>
          )}
        </form>
      )}

      <div className={isLocalTab ? 'grid gap-5' : ''} style={isLocalTab ? { gridTemplateColumns: '180px 1fr' } : undefined}>
        {/* Categories sidebar (local only) */}
        {isLocalTab && (
          <div>
            <h3 className="hub-sect mb-2">{t('market.categories')}</h3>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => filterLocalByCategory('')}
                className="flex items-center justify-between transition-colors text-[13px]"
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: !selectedCategory ? 'var(--hub-surface)' : 'transparent',
                  color: !selectedCategory ? 'var(--hub-ink)' : 'var(--hub-ink-2)',
                  border: '1px solid ' + (!selectedCategory ? 'var(--hub-line)' : 'transparent'),
                }}
              >
                <span>{t('common.all')}</span>
                <span className="hub-mono" style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}>
                  {allLocalServers.length}
                </span>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleCategoryClick(cat)}
                  className="flex items-center justify-between transition-colors text-[13px]"
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: selectedCategory === cat ? 'var(--hub-surface)' : 'transparent',
                    color: selectedCategory === cat ? 'var(--hub-ink)' : 'var(--hub-ink-2)',
                    border:
                      '1px solid ' + (selectedCategory === cat ? 'var(--hub-line)' : 'transparent'),
                  }}
                >
                  <span className="truncate">{cat}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Grid */}
        <div>
          {loading ? (
            <div className="hub-card p-6 text-center" style={{ color: 'var(--hub-ink-3)' }}>
              {t('app.loading')}
            </div>
          ) : servers.length === 0 ? (
            <div className="hub-card p-10 text-center" style={{ color: 'var(--hub-ink-3)' }}>
              {isLocalTab
                ? t('market.noServers')
                : isRegistryTab
                  ? t('registry.noServers')
                  : t('cloud.noServers')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
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

              <div
                className="flex items-center mt-4 text-[12px]"
                style={{ color: 'var(--hub-ink-3)' }}
              >
                <div className="flex-[2]">
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
                <div className="flex-[2] flex items-center justify-end gap-2">
                  <label htmlFor="perPage">
                    {isLocalTab
                      ? t('market.perPage')
                      : isRegistryTab
                        ? t('registry.perPage')
                        : t('cloud.perPage')}
                    :
                  </label>
                  <div className="relative">
                    <select
                      id="perPage"
                      value={serversPerPage}
                      onChange={handleChangeItemsPerPage}
                      className="hub-input pr-7"
                      style={{ height: 26, width: 70, padding: '0 6px', fontSize: 12 }}
                    >
                      <option value="6">6</option>
                      <option value="9">9</option>
                      <option value="12">12</option>
                      <option value="24">24</option>
                    </select>
                    <ChevronDown
                      size={11}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: 'var(--hub-ink-3)' }}
                    />
                  </div>
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
