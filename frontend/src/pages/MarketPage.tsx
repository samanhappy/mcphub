import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search, AlertCircle, X, ChevronDown } from 'lucide-react';
import {
  MarketServer,
  ServerConfig,
  RegistryServerEntry,
  RegistryServerData,
} from '@/types';
import { useMarketData } from '@/hooks/useMarketData';
import { useRegistryData } from '@/hooks/useRegistryData';
import { useToast } from '@/contexts/ToastContext';
import { apiPost } from '@/utils/fetchInterceptor';
import { slugifyServerName } from '@/utils/serverName';
import MarketServerCard from '@/components/MarketServerCard';
import MarketServerDetail from '@/components/MarketServerDetail';
import RegistryServerCard from '@/components/RegistryServerCard';
import RegistryServerDetail from '@/components/RegistryServerDetail';
import Pagination from '@/components/ui/Pagination';
import CursorPagination from '@/components/ui/CursorPagination';
import HostedMarket from './HostedMarket';
import MarketCategories from '@/components/MarketCategories';

const LegacyMarket: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverName } = useParams<{ serverName?: string }>();
  const { showToast } = useToast();

  const [searchParams] = useSearchParams();
  // The cloud (MCPRouter) tab is hidden; only 'local' and 'registry' remain.
  const currentTab: 'local' | 'registry' =
    searchParams.get('tab') === 'registry' ? 'registry' : 'local';

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
  const [selectedRegistryServer, setSelectedRegistryServer] = useState<RegistryServerEntry | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [registrySearchQuery, setRegistrySearchQuery] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installedRegistryServers, setInstalledRegistryServers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadServerDetails = async () => {
      if (serverName) {
        if (currentTab === 'registry') {
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
        setSelectedRegistryServer(null);
      }
    };
    loadServerDetails();
  }, [
    serverName,
    currentTab,
    fetchLocalServerByName,
    fetchRegistryServerByName,
    navigate,
  ]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentTab === 'local') searchLocalServers(searchQuery);
    else if (currentTab === 'registry') searchRegistryServers(registrySearchQuery);
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

  const openRegistryServer = (entry: RegistryServerEntry) => {
    const name = entry.server?.name;
    if (name) navigate(`/market/${encodeURIComponent(name)}?tab=registry`);
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

  const handleRegistryInstall = async (server: RegistryServerData, config: ServerConfig) => {
    try {
      setInstalling(true);
      // Registry names are reverse-DNS (`io.github.user/weather`); the `/` is
      // not part of the MCP tool-name charset, so slugify before creating.
      const payload = { name: slugifyServerName(server.name), config };
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

  const handlePageChange = (page: number) => {
    if (currentTab === 'local') changeLocalPage(page);
    else changeRegistryPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChangeItemsPerPage = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = parseInt(e.target.value, 10);
    if (currentTab === 'local') changeLocalServersPerPage(v);
    else changeRegistryServersPerPage(v);
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
  const servers = isLocalTab ? localServers : registryServers;
  const allServers = isLocalTab ? allLocalServers : allRegistryServers;
  const categories = isLocalTab ? localCategories : [];
  const loading = isLocalTab ? localLoading : registryLoading;
  const error = isLocalTab ? localError : registryError;
  const setError = isLocalTab ? setLocalError : setRegistryError;
  const selectedCategory = isLocalTab ? selectedLocalCategory : '';
  const selectedTag = isLocalTab ? selectedLocalTag : '';
  const currentPage = isLocalTab ? localCurrentPage : registryCurrentPage;
  const totalPages = isLocalTab ? localTotalPages : registryTotalPages;
  const serversPerPage = isLocalTab ? localServersPerPage : registryServersPerPage;

  return (
    <div>
      {error && (
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

      <div className={isLocalTab ? 'grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)]' : ''}>
        {isLocalTab && (
          <MarketCategories
            categories={categories.map((name) => ({ slug: name, name }))}
            selected={selectedCategory}
            onSelect={filterLocalByCategory}
            total={allLocalServers.length}
          />
        )}
        <div className="min-w-0">
          {loading ? (
            <div className="hub-card p-6 text-center" style={{ color: 'var(--hub-ink-3)' }}>
              {t('app.loading')}
            </div>
          ) : servers.length === 0 ? (
            <div className="hub-card p-10 text-center" style={{ color: 'var(--hub-ink-3)' }}>
              {isLocalTab ? t('market.noServers') : t('registry.noServers')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {servers.map((server, index) =>
                  isLocalTab ? (
                    <MarketServerCard
                      key={index}
                      server={server as MarketServer}
                      to={`/market/${encodeURIComponent((server as MarketServer).name)}?tab=local`}
                    />
                  ) : (
                    <RegistryServerCard
                      key={index}
                      serverEntry={server as RegistryServerEntry}
                      onClick={openRegistryServer}
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
                    : t('registry.showing', {
                        from: (currentPage - 1) * serversPerPage + 1,
                        to: (currentPage - 1) * serversPerPage + servers.length,
                        total: allServers.length + (registryHasNextPage ? '+' : ''),
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
                    {isLocalTab ? t('market.perPage') : t('registry.perPage')}:
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

export default function MarketPage() {
  const { t } = useTranslation();
  const { serverName } = useParams<{ serverName?: string }>();
  const [query] = useSearchParams();
  const tab = query.get('tab');
  const active = tab === 'registry' || tab === 'local' ? tab : 'hosted';

  if (serverName) return <LegacyMarket />;
  const showHostedDetail = active === 'hosted' && query.has('entry');

  const tabs = [
    { id: 'hosted', href: '/market', label: 'MCPHub Registry' },
    {
      id: 'local',
      href: '/market?tab=local',
      label: t('market.title'),
      source: 'MCPM',
      url: 'https://mcpm.sh',
    },
    {
      id: 'registry',
      href: '/market?tab=registry',
      label: t('registry.title'),
      source: t('registry.official'),
      url: 'https://registry.modelcontextprotocol.io',
    },
  ];

  return (
    <div>
      <h1 hidden={showHostedDetail} className="hub-h1 mb-5">
        {t('nav.market')}
      </h1>
      <nav
        aria-label={t('nav.market')}
        className={
          showHostedDetail
            ? 'hidden'
            : 'mb-5 flex flex-wrap gap-x-1.5 border-b border-[var(--hub-line)]'
        }
      >
        {tabs.map(({ id, href, label, source, url }) => {
          const selected = id === active;
          return (
            <div
              key={id}
              className="flex items-center gap-1.5 border-b-2 px-3 text-sm"
              style={{
                borderColor: selected ? 'var(--hub-ink)' : 'transparent',
                color: selected ? 'var(--hub-ink)' : 'var(--hub-ink-3)',
                fontWeight: selected ? 500 : 400,
              }}
            >
              <Link to={href} aria-current={selected ? 'page' : undefined} className="py-2">
                {label}
              </Link>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="hub-mono text-[11px] text-[var(--hub-ink-3)]"
                >
                  ({source})
                </a>
              )}
            </div>
          );
        })}
      </nav>
      {active === 'hosted' ? <HostedMarket /> : <LegacyMarket />}
    </div>
  );
}
