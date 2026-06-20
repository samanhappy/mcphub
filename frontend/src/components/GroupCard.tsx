import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit3, Trash2, Copy, Check, Link as LinkIcon, FileCode, ChevronDown } from 'lucide-react';
import { Group, Server, IGroupServerConfig, GroupCost } from '@/types';
import DeleteDialog from '@/components/ui/DeleteDialog';
import { useToast } from '@/contexts/ToastContext';
import { useSettingsData } from '@/hooks/useSettingsData';
import { formatTokens, percentSaved } from '@/utils/contextCost';

interface GroupCardProps {
  group: Group;
  servers: Server[];
  onEdit: (group: Group) => void;
  onDelete: (groupId: string) => void;
  cost?: GroupCost;
}

const getServerNames = (servers: string[] | IGroupServerConfig[]): string[] =>
  servers.map((server) => (typeof server === 'string' ? server : server.name));

const getServerConfig = (group: Group, serverName: string): IGroupServerConfig => {
  const server = group.servers.find((s) =>
    typeof s === 'string' ? s === serverName : s.name === serverName,
  );
  if (!server) return { name: serverName, tools: 'all', prompts: 'all', resources: 'all' };
  if (typeof server === 'string') {
    return { name: server, tools: 'all', prompts: 'all', resources: 'all' };
  }
  return server;
};

const getServerDisplayName = (group: Group, serverName: string): string => {
  const config = getServerConfig(group, serverName);
  return config.alias?.trim() || serverName;
};

const copyText = async (value: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* noop */
  }
  try {
    const el = document.createElement('textarea');
    el.value = value;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
};

const GroupCard = ({ group, servers, onEdit, onDelete, cost }: GroupCardProps) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { installConfig, nameSeparator } = useSettingsData();
  const baseUrl = installConfig?.baseUrl?.replace(/\/+$/, '') || '';

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCopyDropdown, setShowCopyDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCopyDropdown(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const doCopy = async (text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setShowCopyDropdown(false);
      showToast(t('common.copySuccess') || 'Copied', 'success');
      setTimeout(() => setCopied(false), 1500);
    } else {
      showToast(t('common.copyFailed') || 'Copy failed', 'error');
    }
  };

  const groupEndpoint = `${baseUrl}/mcp/${group.name}`;

  const serverNames = getServerNames(group.servers);
  const groupServers = servers.filter((s) => serverNames.includes(s.name));

  const tally = (server: Server) => {
    const cfg = getServerConfig(group, server.name);
    const prefix = `${server.name}${nameSeparator}`;
    const allTools = server.tools || [];
    const allPrompts = server.prompts || [];
    const allResources = server.resources || [];

    const visibleTools = Array.isArray(cfg.tools)
      ? allTools.filter((t) => {
          if (t.enabled === false) return false;
          const short = t.name.startsWith(prefix) ? t.name.slice(prefix.length) : t.name;
          return cfg.tools!.includes(short);
        }).length
      : allTools.filter((t) => t.enabled !== false).length;
    const visiblePrompts = Array.isArray(cfg.prompts)
      ? allPrompts.filter((p) => {
          if (p.enabled === false) return false;
          const short = p.name.startsWith(prefix) ? p.name.slice(prefix.length) : p.name;
          return cfg.prompts!.includes(short);
        }).length
      : allPrompts.filter((p) => p.enabled !== false).length;
    const visibleResources = Array.isArray(cfg.resources)
      ? allResources.filter((r) => r.enabled !== false && cfg.resources!.includes(r.uri)).length
      : allResources.filter((r) => r.enabled !== false).length;

    return {
      visibleTools,
      totalTools: allTools.length,
      visiblePrompts,
      totalPrompts: allPrompts.length,
      visibleResources,
      totalResources: allResources.length,
    };
  };

  const totalVisibleTools = groupServers.reduce((acc, s) => acc + tally(s).visibleTools, 0);

  return (
    <div className="hub-card overflow-visible">
      {/* Header */}
      <div
        className="flex items-start gap-3 px-4 py-3"
        style={{ borderBottom: '1px solid var(--hub-line-2)' }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.015em' }}>
              {group.name}
            </span>
            <span
              className="hub-mono"
              style={{
                fontSize: 11,
                color: 'var(--hub-ink-3)',
                padding: '0 6px',
                border: '1px solid var(--hub-line)',
                borderRadius: 4,
                height: 18,
                display: 'inline-flex',
                alignItems: 'center',
              }}
              title={group.id}
            >
              {group.id}
            </span>
          </div>
          {group.description && (
            <div style={{ fontSize: 12.5, color: 'var(--hub-ink-3)', marginTop: 2 }}>
              {group.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1" ref={dropdownRef}>
          <div className="relative">
            <button
              onClick={() => setShowCopyDropdown((v) => !v)}
              className="hub-icon-btn sm"
              title={t('common.copy')}
            >
              {copied ? <Check size={13} className="text-[var(--hub-ok)]" /> : <Copy size={13} />}
            </button>
            {showCopyDropdown && (
              <div
                className="absolute top-full right-0 mt-1 z-20 hub-card"
                style={{ minWidth: 160, padding: 4 }}
              >
                <button
                  onClick={() => doCopy(group.id)}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left"
                >
                  <Copy size={12} /> {t('common.copyId')}
                </button>
                <button
                  onClick={() => doCopy(groupEndpoint)}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left"
                >
                  <LinkIcon size={12} /> {t('common.copyUrl')}
                </button>
                <button
                  onClick={() =>
                    doCopy(
                      JSON.stringify(
                        {
                          mcpServers: {
                            mcphub: {
                              url: groupEndpoint,
                              headers: { Authorization: 'Bearer <your-access-token>' },
                            },
                          },
                        },
                        null,
                        2,
                      ),
                    )
                  }
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left"
                >
                  <FileCode size={12} /> {t('common.copyJson')}
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => onEdit(group)}
            className="hub-icon-btn sm"
            title={t('groups.edit')}
          >
            <Edit3 size={13} />
          </button>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="hub-icon-btn sm"
            title={t('groups.delete')}
            style={{ color: 'var(--hub-ink-3)' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Routing diagram */}
      <div
        className="grid items-center gap-3 px-4 py-3"
        style={{ gridTemplateColumns: '1fr 80px 1fr' }}
      >
        {/* Servers */}
        <div className="flex flex-col gap-1.5">
          {groupServers.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--hub-ink-3)' }}>{t('groups.noServers')}</div>
          ) : (
            groupServers.map((s) => {
              const tn = tally(s);
              return (
                <div
                  key={s.name}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md"
                  style={{
                    background: 'var(--hub-bg-2)',
                    border: '1px solid var(--hub-line-2)',
                  }}
                >
                  <span
                    className="inline-block flex-shrink-0"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 50,
                      background:
                        s.status === 'connected'
                          ? 'var(--hub-ok)'
                          : s.status === 'connecting'
                            ? 'var(--hub-warn)'
                            : 'var(--hub-err)',
                    }}
                  />
                  <span className="hub-mono truncate flex-1" style={{ fontSize: 12.5 }}>
                    <span title={s.name}>{getServerDisplayName(group, s.name)}</span>
                  </span>
                  <span
                    className="hub-mono hub-num flex-shrink-0"
                    style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}
                  >
                    {tn.visibleTools}/{tn.totalTools} tools
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Flow */}
        <svg width="80" height="80" viewBox="0 0 80 80" className="self-center">
          {groupServers.length === 0 ? (
            <path
              d="M0,40 C30,40 50,40 80,40"
              stroke="var(--hub-line)"
              strokeWidth="1"
              fill="none"
              strokeDasharray="3 3"
            />
          ) : (
            groupServers.map((_, i) => {
              const y1 = 12 + (60 / Math.max(groupServers.length, 1)) * (i + 0.5);
              return (
                <path
                  key={i}
                  d={`M0,${y1} C 30,${y1} 50,40 80,40`}
                  stroke="var(--hub-line)"
                  strokeWidth="1"
                  fill="none"
                  strokeDasharray="3 3"
                />
              );
            })
          )}
          <circle cx="80" cy="40" r="4" fill="var(--hub-ink)" />
        </svg>

        {/* Endpoint */}
        <div
          className="px-3 py-2.5 rounded-md"
          style={{
            border: '1px solid var(--hub-line)',
            background: 'var(--hub-bg-2)',
          }}
        >
          <div className="hub-sect" style={{ marginBottom: 4 }}>
            endpoint
          </div>
          <div
            className="hub-mono break-all"
            style={{ fontSize: 12, color: 'var(--hub-ink-2)', lineHeight: 1.4 }}
          >
            <span style={{ color: 'var(--hub-ink-3)' }}>/mcp/</span>
            <b style={{ color: 'var(--hub-ink)', fontWeight: 600 }}>{group.name}</b>
          </div>
          <div className="flex gap-1.5 mt-2">
            <button
              className="hub-btn sm flex-1 justify-center"
              onClick={() => doCopy(groupEndpoint)}
            >
              <Copy size={11} /> {t('common.copy')}
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex justify-between items-center px-4 py-2"
        style={{
          borderTop: '1px solid var(--hub-line-2)',
          background: 'var(--hub-bg-2)',
          fontSize: 12,
          color: 'var(--hub-ink-3)',
        }}
      >
        <div>
          <div className="hub-mono">
            <span style={{ color: 'var(--hub-ink-2)' }}>{groupServers.length}</span>{' '}
            {t('nav.servers').toLowerCase()} ·{' '}
            <span style={{ color: 'var(--hub-ink-2)' }}>{totalVisibleTools}</span>{' '}
            {t('server.tools').toLowerCase()}
          </div>
          {cost && (
            <div className="hub-mono mt-1" style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}>
              <div title={t('cost.estimate')}>
                {t('cost.totalFootprint')}: {formatTokens(cost.direct.exposed)}/
                {formatTokens(cost.direct.gross)}
              </div>
              {cost.smartRouting && (
                <>
                  <div>
                    {t('cost.smartRouting')}: {formatTokens(cost.smartRouting.base)} (
                    {t('cost.saved', {
                      percent: percentSaved(cost.direct.exposed, cost.smartRouting.base),
                    })}
                    )
                  </div>
                  <div title={t('cost.smartRoutingPdHint')}>
                    {t('cost.smartRoutingPd')}:{' '}
                    {formatTokens(cost.smartRouting.progressiveDisclosure)}
                  </div>
                </>
              )}
              {cost.connectedCount < cost.totalCount && (
                <div>
                  {t('cost.connectedOf', {
                    connected: cost.connectedCount,
                    total: cost.totalCount,
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          className="hub-btn ghost sm"
          style={{ color: 'var(--hub-ink-3)' }}
          onClick={() => onEdit(group)}
        >
          {t('groups.configureTools') || t('groups.edit')}
          <ChevronDown size={11} style={{ transform: 'rotate(-90deg)' }} />
        </button>
      </div>

      <DeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => {
          onDelete(group.id);
          setShowDeleteDialog(false);
        }}
        serverName={group.name}
        isGroup={true}
      />
    </div>
  );
};

export default GroupCard;
