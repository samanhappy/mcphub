import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Wrench,
  MessageSquare,
  FileText,
  MoreHorizontal,
  X,
  Edit3,
  Trash2,
} from 'lucide-react';
import { Server } from '@/types';
import { ServerStatusDot } from '@/components/ui/StatusDot';
import ToolCard from '@/components/ui/ToolCard';
import PromptCard from '@/components/ui/PromptCard';
import ResourceCard from '@/components/ui/ResourceCard';
import DeleteDialog from '@/components/ui/DeleteDialog';
import { useToast } from '@/contexts/ToastContext';
import { useSettingsData } from '@/hooks/useSettingsData';

interface ServerCardProps {
  server: Server;
  onRemove: (serverName: string) => void;
  onEdit: (server: Server) => void;
  onToggle?: (server: Server, enabled: boolean) => Promise<boolean>;
  onRefresh?: () => void;
  onReload?: (server: Server) => Promise<boolean>;
}

const transportLabel = (t: any, type?: string) => {
  if (!type) return null;
  if (type === 'stdio') return t('server.typeStdio') || 'stdio';
  if (type === 'sse') return t('server.typeSse') || 'sse';
  if (type === 'streamable-http') return t('server.typeStreamableHttp') || 'http';
  if (type === 'openapi') return t('server.typeOpenapi') || 'openapi';
  return type;
};

const ServerCard = ({ server, onRemove, onEdit, onToggle, onRefresh, onReload }: ServerCardProps) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { exportMCPSettings, installConfig } = useSettingsData();
  const baseUrl = installConfig?.baseUrl?.replace(/\/+$/, '') || '';

  const [expanded, setExpanded] = useState(false);
  const [expandedTab, setExpandedTab] = useState<'tools' | 'prompts' | 'resources' | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showErrorPopover, setShowErrorPopover] = useState(false);
  const [copiedError, setCopiedError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const errorPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setShowMenu(false);
      if (errorPopoverRef.current && !errorPopoverRef.current.contains(event.target as Node))
        setShowErrorPopover(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const totalTools = server.tools?.length || 0;
  const enabledTools = server.tools?.filter((tool) => tool.enabled !== false).length || 0;
  const totalPrompts = server.prompts?.length || 0;
  const enabledPrompts = server.prompts?.filter((p) => p.enabled !== false).length || 0;
  const totalResources = server.resources?.length || 0;
  const enabledResources = server.resources?.filter((r) => r.enabled !== false).length || 0;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isToggling || !onToggle) return;
    setIsToggling(true);
    try {
      await onToggle(server, !(server.enabled !== false));
    } finally {
      setIsToggling(false);
    }
  };

  const handleReload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (isReloading || !onReload) return;
    setIsReloading(true);
    try {
      const success = await onReload(server);
      if (success) {
        showToast(t('server.reloadSuccess') || 'Server reloaded successfully', 'success');
      } else {
        showToast(t('server.reloadError', { serverName: server.name }) || 'Failed to reload', 'error');
      }
    } finally {
      setIsReloading(false);
    }
  };

  const copyText = async (value: string) => {
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

  const handleCopyError = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!server.error) return;
    const ok = await copyText(server.error);
    if (ok) {
      setCopiedError(true);
      showToast(t('common.copySuccess') || 'Copied', 'success');
      setTimeout(() => setCopiedError(false), 1500);
    } else {
      showToast(t('common.copyFailed') || 'Copy failed', 'error');
    }
  };

  const handleCopyConfig = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    try {
      const result = await exportMCPSettings(server.name);
      if (!result || !result.success || !result.data) {
        showToast(result?.message || t('common.copyFailed') || 'Copy failed', 'error');
        return;
      }
      const json = JSON.stringify(result.data, null, 2);
      const ok = await copyText(json);
      showToast(
        ok ? t('common.copySuccess') || 'Copied' : t('common.copyFailed') || 'Copy failed',
        ok ? 'success' : 'error',
      );
    } catch (error) {
      console.error('Error copying server configuration:', error);
      showToast(t('common.copyFailed') || 'Copy failed', 'error');
    }
  };

  const handleOAuth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (server.oauth?.authorizationUrl) {
      const w = 600;
      const h = 700;
      const left = window.screen.width / 2 - w / 2;
      const top = window.screen.height / 2 - h / 2;
      window.open(server.oauth.authorizationUrl, 'OAuth Authorization', `width=${w},height=${h},left=${left},top=${top}`);
      showToast(t('status.oauthWindowOpened'), 'info');
    }
  };

  const handleToolToggle = async (toolName: string, enabled: boolean) => {
    try {
      const { toggleTool } = await import('@/services/toolService');
      const result = await toggleTool(server.name, toolName, enabled);
      if (result.success) {
        showToast(t(enabled ? 'tool.enableSuccess' : 'tool.disableSuccess', { name: toolName }), 'success');
        onRefresh?.();
      } else {
        showToast(result.error || t('tool.toggleFailed'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(t('tool.toggleFailed'), 'error');
    }
  };

  const handlePromptToggle = async (promptName: string, enabled: boolean) => {
    try {
      const { togglePrompt } = await import('@/services/promptService');
      const result = await togglePrompt(server.name, promptName, enabled);
      if (result.success) {
        showToast(t(enabled ? 'tool.enableSuccess' : 'tool.disableSuccess', { name: promptName }), 'success');
        onRefresh?.();
      } else {
        showToast(result.error || t('tool.toggleFailed'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(t('tool.toggleFailed'), 'error');
    }
  };

  const handleResourceToggle = async (resourceUri: string, enabled: boolean) => {
    try {
      const { toggleResource } = await import('@/services/resourceService');
      const result = await toggleResource(server.name, resourceUri, enabled);
      if (result.success) {
        showToast(t(enabled ? 'tool.enableSuccess' : 'tool.disableSuccess', { name: resourceUri }), 'success');
        onRefresh?.();
      } else {
        showToast(result.error || t('tool.toggleFailed'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(t('tool.toggleFailed'), 'error');
    }
  };

  const handleToolDescriptionUpdate = (_name: string, _desc: string, options?: { restored?: boolean }) => {
    showToast(
      options?.restored ? t('tool.restoreDefaultSuccess') : t('tool.descriptionUpdateSuccess'),
      'success',
    );
    onRefresh?.();
  };

  const handlePromptDescriptionUpdate = (_name: string, _desc: string, options?: { restored?: boolean }) => {
    showToast(
      options?.restored ? t('prompt.restoreDefaultSuccess') : t('prompt.descriptionUpdateSuccess'),
      'success',
    );
    onRefresh?.();
  };

  const handleResourceDescriptionUpdate = async (
    resourceUri: string,
    description: string,
    options?: { restored?: boolean },
  ) => {
    try {
      const { updateResourceDescription, resetResourceDescription } = await import(
        '@/services/resourceService'
      );
      const result = options?.restored
        ? await resetResourceDescription(server.name, resourceUri)
        : await updateResourceDescription(server.name, resourceUri, description);
      if (result.success) {
        showToast(
          options?.restored
            ? t('builtinResources.restoreDefaultSuccess')
            : t('builtinResources.descriptionUpdateSuccess'),
          'success',
        );
        onRefresh?.();
      } else {
        showToast(
          result.error ||
            (options?.restored
              ? t('builtinResources.restoreDefaultFailed')
              : t('builtinResources.descriptionUpdateFailed')),
          'error',
        );
      }
    } catch (err) {
      console.error(err);
      showToast(
        options?.restored
          ? t('builtinResources.restoreDefaultFailed')
          : t('builtinResources.descriptionUpdateFailed'),
        'error',
      );
    }
  };

  // Derive the launch command/URL for the technical display.
  const launchCmd = (() => {
    const c = server.config;
    if (!c) return '';
    if (c.url) return c.url;
    const parts: string[] = [];
    if (c.command) parts.push(c.command);
    if (c.args?.length) parts.push(...c.args);
    return parts.join(' ');
  })();

  const enabled = server.enabled !== false;
  const serverEndpoint = `${baseUrl}/mcp/${server.name}`;

  return (
    <>
      <div
        className="hub-card overflow-visible"
        style={{ marginBottom: 10, opacity: enabled ? 1 : 0.7 }}
      >
        {/* Main row */}
        <div
          className="grid items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--hub-surface-hover)] transition-colors"
          style={{ gridTemplateColumns: 'minmax(220px,1.6fr) 130px 60px 90px 60px 100px 36px' }}
          onClick={() => setExpanded(!expanded)}
        >
          {/* Name + description */}
          <div className="flex items-center gap-2.5 min-w-0">
            <ChevronRight
              size={12}
              style={{
                color: 'var(--hub-ink-3)',
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.15s',
                flexShrink: 0,
              }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="hub-mono truncate"
                  style={{
                    fontSize: 13.5,
                    color: enabled ? 'var(--hub-ink)' : 'var(--hub-ink-3)',
                  }}
                >
                  {server.name}
                </span>
                {server.error && (
                  <div className="relative" ref={errorPopoverRef}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowErrorPopover((v) => !v);
                      }}
                      className="text-[var(--hub-err)] hover:opacity-80"
                      aria-label={t('server.viewErrorDetails')}
                    >
                      <AlertCircle size={14} />
                    </button>
                    {showErrorPopover && (
                      <div
                        className="absolute z-20 mt-1.5 hub-card"
                        style={{
                          left: 0,
                          top: '100%',
                          width: 460,
                          maxHeight: 320,
                          overflow: 'hidden',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          className="flex items-center justify-between px-3 py-2"
                          style={{ borderBottom: '1px solid var(--hub-line-2)' }}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[12px] font-medium"
                              style={{ color: 'var(--hub-err)' }}
                            >
                              {t('server.errorDetails')}
                            </span>
                            <button
                              onClick={handleCopyError}
                              className="hub-icon-btn sm"
                              title={t('common.copy')}
                            >
                              {copiedError ? (
                                <Check size={12} className="text-[var(--hub-ok)]" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                          <button
                            onClick={() => setShowErrorPopover(false)}
                            className="hub-icon-btn sm"
                            aria-label={t('app.closeButton')}
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <div
                          className="p-3 overflow-auto hub-mono"
                          style={{ maxHeight: 260, fontSize: 12 }}
                        >
                          <pre className="whitespace-pre-wrap break-words m-0" style={{ color: 'var(--hub-ink-2)' }}>
                            {server.error}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {server.config?.description && (
                <div
                  className="text-[11.5px] truncate"
                  style={{ color: 'var(--hub-ink-3)', marginTop: 1 }}
                  title={server.config.description}
                >
                  {server.config.description}
                </div>
              )}
            </div>
          </div>

          {/* Status */}
          <div>
            <ServerStatusDot status={server.status} enabled={server.enabled} onAuthClick={handleOAuth} />
          </div>

          {/* Tools count */}
          <div
            className="hub-num hub-mono text-[12.5px]"
            style={{ color: 'var(--hub-ink-2)' }}
            title={`${enabledTools}/${totalTools} ${t('server.tools')}`}
          >
            {totalTools === 0 ? '0' : `${enabledTools}/${totalTools}`}
          </div>

          {/* Transport */}
          <div>
            {server.config?.type ? (
              <span className="hub-tag">{transportLabel(t, server.config.type)}</span>
            ) : (
              <span style={{ color: 'var(--hub-ink-3)', fontSize: 12 }}>—</span>
            )}
          </div>

          {/* Prompts + resources count */}
          <div
            className="hub-num hub-mono text-[12.5px]"
            style={{ color: 'var(--hub-ink-2)' }}
            title={`P:${enabledPrompts}/${totalPrompts} · R:${enabledResources}/${totalResources}`}
          >
            {totalPrompts + totalResources > 0 ? `${totalPrompts}/${totalResources}` : '—'}
          </div>

          {/* Toggle switch */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              className={'hub-switch' + (enabled ? ' on' : '')}
              onClick={handleToggle}
              disabled={isToggling}
              aria-label={enabled ? t('server.disable') : t('server.enable')}
            />
          </div>

          {/* Menu */}
          <div className="relative" ref={menuRef}>
            <button
              className="hub-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu((v) => !v);
              }}
              aria-label="More"
            >
              <MoreHorizontal size={14} />
            </button>
            {showMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-20 hub-card"
                style={{ minWidth: 160, padding: 4 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    onEdit(server);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left"
                  style={{ color: 'var(--hub-ink)' }}
                >
                  <Edit3 size={13} /> {t('server.edit')}
                </button>
                <button
                  onClick={handleCopyConfig}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left"
                  style={{ color: 'var(--hub-ink)' }}
                >
                  <Copy size={13} /> {t('server.copy')}
                </button>
                {onReload && (
                  <button
                    onClick={handleReload}
                    disabled={isReloading || isToggling || !enabled}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ color: 'var(--hub-ink)' }}
                  >
                    <RefreshCw size={13} /> {t('server.reload')}
                  </button>
                )}
                <div style={{ height: 1, background: 'var(--hub-line-2)', margin: '4px 0' }} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    setShowDeleteDialog(true);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left"
                  style={{ color: 'var(--hub-err)' }}
                >
                  <Trash2 size={13} /> {t('server.delete')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div
            style={{
              borderTop: '1px solid var(--hub-line-2)',
              background: 'var(--hub-bg-2)',
              padding: '14px 16px 16px 38px',
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <div className="hub-sect" style={{ marginBottom: 5 }}>
                  {server.config?.type === 'sse' || server.config?.type === 'streamable-http' || server.config?.type === 'openapi'
                    ? t('server.url')
                    : t('server.command')}
                </div>
                {launchCmd ? (
                  <div className="hub-endpoint">
                    <div className="hub-endpoint-url" title={launchCmd}>
                      {launchCmd}
                    </div>
                    <button
                      type="button"
                      className="hub-endpoint-copy"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const ok = await copyText(launchCmd);
                        showToast(
                          ok ? t('common.copySuccess') || 'Copied' : t('common.copyFailed') || 'Failed',
                          ok ? 'success' : 'error',
                        );
                      }}
                      title={t('common.copy')}
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                ) : (
                  <span style={{ color: 'var(--hub-ink-3)', fontSize: 12 }}>—</span>
                )}
              </div>
              <div>
                <div className="hub-sect" style={{ marginBottom: 5 }}>
                  {t('pages.dashboard.endpoints') || 'Endpoint'}
                </div>
                <div className="hub-endpoint">
                  <div className="hub-endpoint-label">/mcp/</div>
                  <div className="hub-endpoint-url" title={serverEndpoint}>
                    {server.name}
                  </div>
                  <button
                    type="button"
                    className="hub-endpoint-copy"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await copyText(serverEndpoint);
                      showToast(
                        ok ? t('common.copySuccess') || 'Copied' : t('common.copyFailed') || 'Failed',
                        ok ? 'success' : 'error',
                      );
                    }}
                    title={t('common.copy')}
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            </div>

            {/* Capability tabs */}
            <div className="flex items-center gap-1 mb-2">
              {[
                {
                  key: 'tools' as const,
                  icon: <Wrench size={12} />,
                  label: t('server.tools'),
                  count: totalTools,
                  enabled: enabledTools,
                },
                {
                  key: 'prompts' as const,
                  icon: <MessageSquare size={12} />,
                  label: t('server.prompts'),
                  count: totalPrompts,
                  enabled: enabledPrompts,
                },
                {
                  key: 'resources' as const,
                  icon: <FileText size={12} />,
                  label: t('nav.resources'),
                  count: totalResources,
                  enabled: enabledResources,
                },
              ].map((tab) => {
                const active = expandedTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setExpandedTab(active ? null : tab.key)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors"
                    style={{
                      background: active ? 'var(--hub-surface)' : 'transparent',
                      border: '1px solid ' + (active ? 'var(--hub-line)' : 'transparent'),
                      color: active ? 'var(--hub-ink)' : 'var(--hub-ink-2)',
                    }}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    <span className="hub-mono hub-num" style={{ color: 'var(--hub-ink-3)', fontSize: 11 }}>
                      {tab.count === 0 ? '0' : `${tab.enabled}/${tab.count}`}
                    </span>
                  </button>
                );
              })}
            </div>

            {expandedTab === 'tools' && server.tools && (
              <div className="space-y-3 mt-2">
                {server.tools.map((tool, index) => (
                  <ToolCard
                    key={index}
                    server={server.name}
                    tool={tool}
                    onToggle={handleToolToggle}
                    onDescriptionUpdate={handleToolDescriptionUpdate}
                  />
                ))}
              </div>
            )}
            {expandedTab === 'prompts' && server.prompts && (
              <div className="space-y-3 mt-2">
                {server.prompts.map((prompt, index) => (
                  <PromptCard
                    key={index}
                    server={server.name}
                    prompt={prompt}
                    onToggle={handlePromptToggle}
                    onDescriptionUpdate={handlePromptDescriptionUpdate}
                  />
                ))}
              </div>
            )}
            {expandedTab === 'resources' && server.resources && (
              <div className="mt-2">
                {server.resources.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--hub-ink-3)' }}>
                    {t('builtinResources.noResources')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {server.resources.map((resource, index) => (
                      <ResourceCard
                        key={`${resource.uri}-${index}`}
                        resource={resource}
                        onToggle={handleResourceToggle}
                        onDescriptionUpdate={handleResourceDescriptionUpdate}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <DeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => {
          onRemove(server.name);
          setShowDeleteDialog(false);
        }}
        serverName={server.name}
      />
    </>
  );
};

export default ServerCard;
