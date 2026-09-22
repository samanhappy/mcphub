import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  Database,
  HardDrive,
  Server,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Layers,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';
import { logStreamManager } from '@/services/logService';
import {
  fetchSmartRoutingPerformance,
  reindexSmartRouting,
  type SmartRoutingPerformanceData,
  type SmartRoutingReindexResult,
} from '@/services/smartRoutingService';

type ReindexProgress = {
  serverName: string;
  current: number;
  total: number;
  status: string;
};

interface SmartRoutingIndexPanelProps {
  /** Whether smart routing is currently enabled. */
  enabled: boolean;
}

const formatDateTime = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const SmartRoutingIndexPanel: React.FC<SmartRoutingIndexPanelProps> = ({ enabled }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [perf, setPerf] = useState<SmartRoutingPerformanceData | null>(null);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [perfError, setPerfError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [progress, setProgress] = useState<ReindexProgress | null>(null);
  const [reindexSummary, setReindexSummary] = useState<SmartRoutingReindexResult | null>(null);

  // The hub rejects overlapping passes with 409, so reflect a pass started
  // elsewhere (another admin, another tab) instead of offering a button that
  // can only fail.
  const busy = reindexing || Boolean(perf?.reindexing);

  const runIdRef = useRef(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const loadPerformance = useCallback(async () => {
    if (!enabled) {
      setPerf(null);
      setPerfError(null);
      return;
    }
    setLoadingPerf(true);
    setPerfError(null);
    try {
      const data = await fetchSmartRoutingPerformance();
      setPerf(data);
    } catch (error) {
      setPerfError(error instanceof Error ? error.message : String(error));
      setPerf(null);
    } finally {
      setLoadingPerf(false);
    }
  }, [enabled]);

  useEffect(() => {
    loadPerformance();
  }, [loadPerformance]);

  // Unsubscribe from the log stream when the panel unmounts.
  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  const handleReindex = async () => {
    setConfirmOpen(false);
    setReindexSummary(null);
    setReindexing(true);
    setProgress({ serverName: '', current: 0, total: 0, status: 'started' });
    const runId = ++runIdRef.current;

    // Stream per-server embedding progress over the shared log SSE connection.
    const unsubscribe = logStreamManager.subscribe((event) => {
      try {
        const data = JSON.parse(event.data) as {
          type?: unknown;
          progress?: ReindexProgress;
        };
        if (data?.type === 'embedding-sync-progress' && data.progress) {
          setProgress(data.progress);
        }
      } catch {
        // Ignore malformed stream messages.
      }
    });
    unsubscribeRef.current = unsubscribe;

    try {
      const result = await reindexSmartRouting();
      if (runId !== runIdRef.current) return;
      setReindexSummary(result);
      showToast(
        t('settings.smartRoutingIndexReindexDone', {
          synced: result.syncedServers,
          failed: result.failedServers,
          skipped: result.skippedServers,
          total: result.totalTools,
        }),
        'success',
      );
      await loadPerformance();
    } catch (error) {
      if (runId !== runIdRef.current) return;
      showToast(
        t('settings.smartRoutingIndexReindexFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
        'error',
      );
    } finally {
      if (runId === runIdRef.current) {
        setReindexing(false);
        setProgress(null);
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
      }
    }
  };

  const rowMeta: Array<{ label: string; value: string }> = perf
    ? [
        {
          label: t('settings.smartRoutingIndexModel'),
          value: perf.config.model || '—',
        },
        {
          label: t('settings.smartRoutingIndexDimensions'),
          value: String(
            perf.vectorStore.dimensions ?? perf.config.configuredDimensions ?? '—',
          ),
        },
        {
          label: t('settings.smartRoutingIndexTotalRows'),
          value: String(perf.vectorStore.totalRows),
        },
        {
          label: t('settings.smartRoutingIndexToolRows'),
          value: String(perf.vectorStore.toolRows),
        },
        {
          label: t('settings.smartRoutingIndexServerRows'),
          value: String(perf.vectorStore.serverRows),
        },
        {
          label: t('settings.smartRoutingIndexClusterLabel'),
          value: String(perf.vectorStore.distinctServers),
        },
        {
          label: t('settings.smartRoutingIndexCoverage'),
          value: `${perf.coverage.indexedServers}/${perf.coverage.totalServers}`,
        },
        {
          label: t('settings.smartRoutingIndexPersonalCredentials'),
          value: String(perf.coverage.personalCredentialServers),
        },
        {
          label: t('settings.smartRoutingIndexLastSynced'),
          value: formatDateTime(perf.vectorStore.newestUpdatedAt),
        },
      ]
    : [];

  const dbOk = perf?.database.healthy;
  const failedItems = reindexSummary?.results.filter((item) => !item.ok && !item.skipped) ?? [];
  const skippedItems = reindexSummary?.results.filter((item) => item.skipped) ?? [];

  return (
    <div className="hub-card" style={{ padding: 18 }}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-[var(--hub-ink-2)]" />
          <h3 className="hub-card-title" style={{ marginBottom: 0 }}>
            {t('settings.smartRoutingIndexTitle')}
          </h3>
          {perf?.vectorStore.available === false && (
            <span style={{ fontSize: 11.5, color: 'var(--hub-warn, #b45309)' }}>
              <AlertTriangle size={12} />
              {t('settings.smartRoutingIndexStatsUnavailable')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPerformance}
            disabled={busy || loadingPerf}
            className="hub-btn"
            style={{ padding: '6px 10px', fontSize: 12.5 }}
          >
            <RefreshCw size={13} />
            {t('settings.smartRoutingIndexRefresh')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || loadingPerf || !enabled}
            className="hub-btn primary"
            style={{ padding: '6px 10px', fontSize: 12.5 }}
          >
            {busy ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {busy
              ? t('settings.smartRoutingIndexReindexing')
              : t('settings.smartRoutingIndexReindex')}
          </button>
        </div>
      </div>

      {loadingPerf && (
        <div className="hub-sub">{t('settings.smartRoutingIndexLoading')}</div>
      )}

      {perfError && !perf && (
        <div
          className="mb-3 flex items-start gap-2"
          style={{
            padding: '8px 12px',
            borderRadius: 7,
            background: 'var(--hub-red-soft, rgba(220,38,38,0.08))',
            color: 'var(--hub-red, #dc2626)',
            fontSize: 12.5,
          }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{perfError}</span>
        </div>
      )}

      {!loadingPerf && !perf && !perfError && (
        <div className="hub-sub">{t('settings.smartRoutingIndexNoData')}</div>
      )}

      {perf && (
        <>
          <div
            className="mb-3 flex items-center gap-2"
            style={{
              padding: '8px 12px',
              borderRadius: 7,
              fontSize: 12.5,
              background:
                dbOk === false ? 'var(--hub-warn-soft, rgba(234,179,8,0.10))' : undefined,
              color:
                dbOk === false ? 'var(--hub-warn, #b45309)' : 'var(--hub-ink-2)',
            }}
          >
            <Database size={14} />
            <span>
              {t('settings.smartRoutingIndexDatabase')}:{' '}
              {perf.database.connected
                ? dbOk !== false
                  ? t('settings.smartRoutingIndexConnected')
                  : t('settings.smartRoutingIndexUnhealthy')
                : t('settings.smartRoutingIndexDisconnected')}
            </span>
            {perf.database.lastError && (
              <span style={{ opacity: 0.75 }}>· {perf.database.lastError}</span>
            )}
          </div>

          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            }}
          >
            {rowMeta.map((item) => (
              <div
                key={item.label}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <div style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}>{item.label}</div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: 'var(--hub-ink)',
                    marginTop: 2,
                    wordBreak: 'break-all',
                  }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {perf.coverage.missingIndexServerCount > 0 && (
            <div
              className="mt-3 flex items-start gap-2"
              style={{
                padding: '8px 12px',
                borderRadius: 7,
                background: 'var(--hub-warn-soft, rgba(234,179,8,0.10))',
                color: 'var(--hub-warn, #b45309)',
                fontSize: 12.5,
              }}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {t('settings.smartRoutingIndexMissingIndex', {
                  count: perf.coverage.missingIndexServerCount,
                })}
                {perf.coverage.missingIndexServers.length > 0 &&
                  `: ${perf.coverage.missingIndexServers.slice(0, 8).join(', ')}`}
              </span>
            </div>
          )}

          {perf.vectorStore.byServer.length > 0 && (
            <div className="mt-3">
              <div className="hub-sect mb-2">
                {t('settings.smartRoutingIndexPerServer')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {perf.vectorStore.byServer.slice(0, 30).map((server) => (
                  <span
                    key={server.serverName}
                    className="inline-flex items-center gap-1"
                    style={{
                      padding: '3px 9px',
                      borderRadius: 999,
                      fontSize: 12,
                      background: 'var(--hub-bg-2)',
                      border: '1px solid var(--hub-line)',
                      color: 'var(--hub-ink)',
                    }}
                  >
                    <Server size={11} className="text-[var(--hub-ink-2)]" />
                    {server.serverName}
                    <span className="text-[var(--hub-ink-3)]">({server.toolCount})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div
            className="mt-3 flex items-center gap-2"
            style={{ fontSize: 12.5, color: 'var(--hub-ink-2)' }}
          >
            <Clock size={13} />
            <span>
              {t('settings.smartRoutingIndexSyncedRange', {
                oldest: formatDateTime(perf.vectorStore.oldestUpdatedAt),
                newest: formatDateTime(perf.vectorStore.newestUpdatedAt),
              })}
            </span>
          </div>
        </>
      )}

      {reindexing && progress && (
        <div
          className="mt-3"
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--hub-line)',
            background: 'var(--hub-bg-2)',
          }}
        >
          <div className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
            <span className="inline-flex items-center gap-2" style={{ color: 'var(--hub-ink)' }}>
              <RefreshCw size={13} className="animate-spin" />
              {progress.serverName
                ? t('settings.smartRoutingIndexReindexingServer', {
                    server: progress.serverName,
                  })
                : t('settings.smartRoutingIndexReindexStarting')}
            </span>
            {progress.total > 0 && (
              <span className="text-[var(--hub-ink-3)]">
                {progress.current}/{progress.total}
              </span>
            )}
          </div>
          {progress.total > 0 && (
            <div
              className="mt-2"
              style={{
                height: 6,
                borderRadius: 999,
                background: 'var(--hub-line)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, (progress.current / progress.total) * 100)}%`,
                  background: 'var(--hub-ok)',
                  transition: 'width 120ms ease',
                }}
              />
            </div>
          )}
        </div>
      )}

      {reindexSummary && !reindexing && (
        <div className="mt-3">
          <div
            className="flex items-center gap-2"
            style={{
              padding: '8px 12px',
              borderRadius: 7,
              fontSize: 12.5,
              background:
                failedItems.length > 0
                  ? 'var(--hub-warn-soft, rgba(234,179,8,0.10))'
                  : 'rgba(34,197,94,0.10)',
              color:
                failedItems.length > 0 ? 'var(--hub-warn, #b45309)' : '#166534',
            }}
          >
            {failedItems.length > 0 ? (
              <AlertTriangle size={14} className="shrink-0" />
            ) : (
              <CheckCircle2 size={14} className="shrink-0" />
            )}
            <span>
              {t('settings.smartRoutingIndexReindexSummary', {
                synced: reindexSummary.syncedServers,
                failed: reindexSummary.failedServers,
                skipped: reindexSummary.skippedServers,
                total: reindexSummary.totalTools,
              })}
              {failedItems.length > 0 && (
                <span> {failedItems.map((item) => item.serverName).join(', ')}</span>
              )}
            </span>
          </div>

          {(failedItems.length > 0 || skippedItems.length > 0) && (
            <ul
              className="mt-2"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                fontSize: 12,
                color: 'var(--hub-ink-2)',
              }}
            >
              {[...failedItems, ...skippedItems].map((item) => (
                <li key={item.serverName} className="flex items-start gap-1.5 py-0.5">
                  {item.skipped ? (
                    <XCircle size={12} className="mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  )}
                  <span>
                    <strong style={{ color: 'var(--hub-ink)' }}>{item.serverName}</strong>
                    {': '}
                    {item.skipped
                      ? item.error || t('settings.smartRoutingIndexSkippedReason')
                      : item.error}
                    {item.principals && item.principals.length > 0 && (
                      <span className="text-[var(--hub-ink-3)]">
                        {' '}
                        ({t('settings.smartRoutingIndexIndexedAs', {
                          principals: item.principals.join(', '),
                        })})
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleReindex}
        title={t('settings.smartRoutingIndexReindexConfirmTitle')}
        message={t('settings.smartRoutingIndexReindexConfirmMessage')}
        confirmText={t('settings.smartRoutingIndexReindex')}
        variant="danger"
      />
    </div>
  );
};

export default SmartRoutingIndexPanel;
