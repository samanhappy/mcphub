import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Plus, ChevronRight, AlertCircle } from 'lucide-react';
import { useServerData } from '@/hooks/useServerData';
import { useGroupData } from '@/hooks/useGroupData';
import { useSettingsData } from '@/hooks/useSettingsData';
import { Server } from '@/types';
import { EndpointCopy } from '@/components/ui/EndpointCopy';
import { ServerStatusDot } from '@/components/ui/StatusDot';

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'err' | 'muted' | 'default' }> = ({
  label,
  value,
  tone = 'default',
}) => {
  const toneColor =
    tone === 'ok'
      ? 'oklch(0.4 0.13 145)'
      : tone === 'warn'
        ? 'oklch(0.45 0.13 80)'
        : tone === 'err'
          ? 'oklch(0.45 0.18 25)'
          : tone === 'muted'
            ? 'var(--hub-ink-3)'
            : 'var(--hub-ink)';
  return (
    <div className="hub-card" style={{ padding: '14px 16px' }}>
      <div className="text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
        {label}
      </div>
      <div
        className="hub-num"
        style={{
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          marginTop: 8,
          color: toneColor,
        }}
      >
        {value}
      </div>
    </div>
  );
};

const transportLabel = (t: any, type?: string) => {
  if (!type) return null;
  if (type === 'stdio') return t('server.typeStdio') || 'stdio';
  if (type === 'sse') return t('server.typeSse') || 'sse';
  if (type === 'streamable-http') return t('server.typeStreamableHttp') || 'http';
  if (type === 'openapi') return t('server.typeOpenapi') || 'openapi';
  return type;
};

const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { allServers, error, setError, isLoading, triggerRefresh } = useServerData({
    refreshOnMount: true,
  });
  const { groups } = useGroupData();
  const { installConfig } = useSettingsData();

  const [hasLoaded, setHasLoaded] = React.useState(false);
  const loadingStartedRef = React.useRef(false);
  React.useEffect(() => {
    if (isLoading) {
      loadingStartedRef.current = true;
      return;
    }
    if (loadingStartedRef.current) {
      setHasLoaded(true);
      return;
    }
    if (allServers.length > 0 || error) setHasLoaded(true);
  }, [isLoading, allServers.length, error]);

  const stats = useMemo(
    () => ({
      total: allServers.length,
      online: allServers.filter((s: Server) => s.status === 'connected').length,
      disabled: allServers.filter((s: Server) => s.enabled === false).length,
      offline: allServers.filter(
        (s: Server) => s.status === 'disconnected' && s.enabled !== false,
      ).length,
      connecting: allServers.filter(
        (s: Server) =>
          (s.status === 'connecting' || s.status === 'oauth_required') && s.enabled !== false,
      ).length,
      tools: allServers.reduce((acc, s) => acc + (s.tools?.length || 0), 0),
    }),
    [allServers],
  );

  const recentServers = useMemo(() => allServers.slice(0, 6), [allServers]);
  const baseUrl = installConfig?.baseUrl?.replace(/\/+$/, '') || '';

  const showSkeleton = !hasLoaded;

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="hub-h1">{t('pages.dashboard.title')}</h1>
          <p className="hub-sub">
            {t('pages.dashboard.totalServers')} · <span className="hub-num">{stats.total}</span>
            {'  ·  '}
            {t('pages.dashboard.onlineServers')} · <span className="hub-num">{stats.online}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button className="hub-btn" onClick={() => triggerRefresh()}>
            <RefreshCw size={13} /> {t('common.refresh')}
          </button>
          <button className="hub-btn primary" onClick={() => navigate('/servers')}>
            <Plus size={13} /> {t('server.add')}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="hub-card flex items-center justify-between gap-3 mb-5"
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
            ✕
          </button>
        </div>
      )}

      {/* Stat row */}
      {showSkeleton ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="hub-card animate-pulse"
              style={{ padding: '14px 16px', height: 78 }}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Stat label={t('pages.dashboard.totalServers')} value={stats.total} />
          <Stat label={t('pages.dashboard.onlineServers')} value={stats.online} tone="ok" />
          <Stat label={t('pages.dashboard.connectingServers')} value={stats.connecting} tone="warn" />
          <Stat label={t('pages.dashboard.offlineServers')} value={stats.offline} tone="err" />
          <Stat label={t('pages.dashboard.disabledServers')} value={stats.disabled} tone="muted" />
        </div>
      )}

      {/* Recent servers */}
      {allServers.length > 0 && !showSkeleton && (
        <div className="hub-card overflow-hidden mb-6">
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--hub-line-2)' }}
          >
            <h3 className="hub-card-title">{t('pages.dashboard.recentServers')}</h3>
            <button
              className="hub-btn ghost sm"
              style={{ color: 'var(--hub-ink-3)' }}
              onClick={() => navigate('/servers')}
            >
              {t('common.viewAll') || 'View all'}
              <ChevronRight size={12} />
            </button>
          </div>
          <div
            className="hub-row head hub-mono"
            style={{ gridTemplateColumns: '1.3fr 110px 70px 90px 80px 80px 80px' }}
          >
            <div>{t('server.name')}</div>
            <div>{t('server.status')}</div>
            <div>{t('common.type') || 'Transport'}</div>
            <div>{t('server.tools')}</div>
            <div>{t('server.prompts')}</div>
            <div>{t('nav.resources')}</div>
            <div>{t('server.enabled')}</div>
          </div>
          {recentServers.map((s) => (
            <div
              key={s.name}
              className="hub-row hover cursor-pointer"
              style={{ gridTemplateColumns: '1.3fr 110px 70px 90px 80px 80px 80px' }}
              onClick={() => navigate('/servers')}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="hub-mono truncate"
                  style={{ fontSize: 13, color: s.enabled === false ? 'var(--hub-ink-3)' : 'var(--hub-ink)' }}
                >
                  {s.name}
                </span>
                {s.error && <AlertCircle size={13} className="text-[var(--hub-err)] flex-shrink-0" />}
              </div>
              <div>
                <ServerStatusDot status={s.status} enabled={s.enabled} />
              </div>
              <div>
                {s.config?.type ? (
                  <span className="hub-tag">{transportLabel(t, s.config.type)}</span>
                ) : (
                  <span style={{ color: 'var(--hub-ink-3)', fontSize: 12 }}>—</span>
                )}
              </div>
              <div className="hub-num hub-mono" style={{ fontSize: 12.5 }}>
                {s.tools?.length || 0}
              </div>
              <div className="hub-num hub-mono" style={{ fontSize: 12.5, color: 'var(--hub-ink-2)' }}>
                {s.prompts?.length || 0}
              </div>
              <div className="hub-num hub-mono" style={{ fontSize: 12.5, color: 'var(--hub-ink-2)' }}>
                {s.resources?.length || 0}
              </div>
              <div className="text-[12px]" style={{ color: s.enabled !== false ? 'var(--hub-ok)' : 'var(--hub-ink-3)' }}>
                {s.enabled !== false ? '✓' : '—'}
              </div>
            </div>
          ))}
        </div>
      )}

            {/* Endpoint quick-access */}
      <div className="hub-card mb-5" style={{ padding: 16 }}>
        <div className="flex justify-between items-start gap-3 mb-3">
          <div>
            <h3 className="hub-card-title">{t('pages.dashboard.endpoints') || 'MCP Endpoints'}</h3>
            <p className="hub-sub" style={{ marginTop: 2 }}>
              {t('pages.dashboard.endpointsHint') ||
                'Use these URLs in Claude Desktop, Cursor, or any MCP client'}
            </p>
          </div>
          <a
            className="hub-btn ghost"
            href="https://docs.mcphub.app"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--hub-ink-3)' }}
          >
            {t('common.docs') || 'Docs'} →
          </a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <EndpointCopy label="ALL" url={`${baseUrl}/mcp`} />
          <EndpointCopy label="SMART" url={`${baseUrl}/mcp/$smart`} />
          {groups.slice(0, 2).map((g) => (
            <EndpointCopy key={g.id} label="GROUP" url={`${baseUrl}/mcp/${g.name}`} />
          ))}
          {/* Pad with first server endpoint if there's space */}
          {groups.length < 2 && allServers[0] && (
            <EndpointCopy label="SERVER" url={`${baseUrl}/mcp/${allServers[0].name}`} />
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
