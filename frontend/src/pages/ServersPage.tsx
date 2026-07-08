import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search, Upload, FileCode, AlertCircle, X } from 'lucide-react';
import { Server } from '@/types';
import ServerCard from '@/components/ServerCard';
import AddServerForm from '@/components/AddServerForm';
import EditServerForm from '@/components/EditServerForm';
import McpbUploadForm from '@/components/McpbUploadForm';
import JSONImportForm from '@/components/JSONImportForm';
import Pagination from '@/components/ui/Pagination';
import { useServerData } from '@/hooks/useServerData';
import { useCostData } from '@/hooks/useCostData';
import { selectServerPage, getServerFilterCounts, type ServerFilter } from '@/utils/serverFilters';

const ServersPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    servers,
    allServers,
    error,
    setError,
    isLoading,
    currentPage,
    serversPerPage,
    setCurrentPage,
    setServersPerPage,
    handleServerAdd,
    handleServerEdit,
    handleServerRemove,
    handleServerToggle,
    handleServerVisibilityChange,
    handleServerReload,
    handleServerReinstall,
    handleServerOAuthDisconnect,
    triggerRefresh,
  } = useServerData({ refreshOnMount: true });

  const { serverCosts, refetch: refetchCost } = useCostData();

  // Re-fetch context footprint whenever server data changes (toggle, reload, edit).
  useEffect(() => {
    refetchCost();
  }, [servers, refetchCost]);

  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showMcpbUpload, setShowMcpbUpload] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [filter, setFilter] = useState<ServerFilter>('all');
  const [search, setSearch] = useState('');

  const counts = useMemo(() => getServerFilterCounts(allServers), [allServers]);

  // Filter against the full list and paginate the filtered result client-side,
  // so status filters reach servers that live on other pagination pages.
  const { servers: visibleServers, pagination: clientPagination } = useMemo(
    () => selectServerPage(allServers, filter, search, currentPage, serversPerPage),
    [allServers, filter, search, currentPage, serversPerPage],
  );

  // Sync currentPage when client-side pagination clamps it (filter/search narrows results).
  useEffect(() => {
    if (clientPagination.page !== currentPage) {
      setCurrentPage(clientPagination.page);
    }
  }, [clientPagination.page, currentPage, setCurrentPage]);

  const handleEditClick = async (server: Server) => {
    const fullServerData = await handleServerEdit(server);
    if (fullServerData) setEditingServer(fullServerData);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      triggerRefresh();
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="hub-h1">{t('pages.servers.title')}</h1>
          <p className="hub-sub">
            <span className="hub-num">{counts.all}</span> {t('nav.servers').toLowerCase()} ·{' '}
            <span className="hub-num">{counts.online}</span> {t('status.online')} ·{' '}
            <span className="hub-num">{counts.issues}</span>{' '}
            {t('common.inactive') || 'issues'}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="hub-btn" onClick={() => navigate('/market')}>
            <Plus size={13} /> {t('nav.market')}
          </button>
          <button className="hub-btn" onClick={() => setShowJsonImport(true)}>
            <FileCode size={13} /> {t('jsonImport.button')}
          </button>
          <button className="hub-btn" onClick={() => setShowMcpbUpload(true)}>
            <Upload size={13} /> {t('mcpb.upload')}
          </button>
          <button
            className="hub-btn"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label={t('common.refresh')}
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            {t('common.refresh')}
          </button>
          <AddServerForm onAdd={handleServerAdd} />
        </div>
      </div>

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
          <button
            className="hub-icon-btn sm"
            onClick={() => setError(null)}
            aria-label={t('app.closeButton')}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div
          className="hub-card flex items-center"
          style={{ padding: 2, borderRadius: 7, background: 'var(--hub-surface)' }}
        >
          {(
            [
              ['all', t('common.all') || 'All', counts.all],
              ['online', t('status.online'), counts.online],
              ['issues', t('common.inactive') || 'Issues', counts.issues],
              ['disabled', t('pages.dashboard.disabledServers') || 'Disabled', counts.disabled],
            ] as [ServerFilter, string, number][]
          ).map(([k, l, n]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="inline-flex items-center gap-1.5 px-3 text-[12px]"
              style={{
                height: 24,
                borderRadius: 5,
                background: filter === k ? 'var(--hub-bg-2)' : 'transparent',
                color: filter === k ? 'var(--hub-ink)' : 'var(--hub-ink-3)',
                border: '1px solid ' + (filter === k ? 'var(--hub-line)' : 'transparent'),
              }}
            >
              {l}
              <span className="hub-mono" style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}>
                {n}
              </span>
            </button>
          ))}
        </div>

        <div
          className="hub-card flex items-center gap-2 px-2.5 flex-1"
          style={{ height: 30, background: 'var(--hub-surface)', maxWidth: 360 }}
        >
          <Search size={13} style={{ color: 'var(--hub-ink-3)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: 'var(--hub-ink)' }}
            placeholder={t('market.searchPlaceholder') || 'Search…'}
          />
          {search && (
            <button onClick={() => setSearch('')} className="hub-icon-btn sm">
              <X size={11} />
            </button>
          )}
        </div>

        <div className="ml-auto hub-mono text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
          {clientPagination.total}/{allServers.length}
        </div>
      </div>

      {/* List */}
      {isLoading && servers.length === 0 ? (
        <div className="hub-card p-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--hub-ink-3)' }} />
            <p style={{ color: 'var(--hub-ink-3)' }}>{t('app.loading')}</p>
          </div>
        </div>
      ) : visibleServers.length === 0 ? (
        <div className="hub-card p-10 text-center" style={{ color: 'var(--hub-ink-3)' }}>
          <p>{servers.length === 0 ? t('app.noServers') : t('market.noServers')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col">
            {visibleServers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                cost={serverCosts.find((c) => c.name === server.name)}
                onRemove={handleServerRemove}
                onEdit={handleEditClick}
                onToggle={handleServerToggle}
                onVisibilityChange={handleServerVisibilityChange}
                onRefresh={triggerRefresh}
                onReload={handleServerReload}
                onReinstall={handleServerReinstall}
                onOAuthDisconnect={handleServerOAuthDisconnect}
              />
            ))}
          </div>

          <div className="flex items-center mt-4 text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
            <div className="flex-[2]">
              {t('common.showing', {
                start: (clientPagination.page - 1) * clientPagination.limit + 1,
                end: Math.min(clientPagination.page * clientPagination.limit, clientPagination.total),
                total: clientPagination.total,
              })}
            </div>
            <div className="flex-[4] flex justify-center">
              {clientPagination.totalPages > 1 && (
                <Pagination
                  currentPage={clientPagination.page}
                  totalPages={clientPagination.totalPages}
                  onPageChange={setCurrentPage}
                  disabled={isLoading}
                />
              )}
            </div>
            <div className="flex-[2] flex items-center justify-end gap-2">
              <label htmlFor="perPage">{t('common.itemsPerPage')}:</label>
              <select
                id="perPage"
                value={serversPerPage}
                onChange={(e) => setServersPerPage(Number(e.target.value))}
                disabled={isLoading}
                className="hub-input"
                style={{ height: 26, width: 70, padding: '0 6px', fontSize: 12 }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        </>
      )}

      {editingServer && (
        <EditServerForm
          server={editingServer}
          onEdit={() => {
            setEditingServer(null);
            triggerRefresh();
          }}
          onCancel={() => setEditingServer(null)}
        />
      )}
      {showMcpbUpload && (
        <McpbUploadForm
          onSuccess={() => {
            setShowMcpbUpload(false);
            triggerRefresh();
          }}
          onCancel={() => setShowMcpbUpload(false)}
        />
      )}
      {showJsonImport && (
        <JSONImportForm
          onSuccess={() => {
            setShowJsonImport(false);
            triggerRefresh();
          }}
          onCancel={() => setShowJsonImport(false)}
        />
      )}
    </div>
  );
};

export default ServersPage;
