import { useState, useRef, useEffect, type CSSProperties, type ReactNode } from 'react';
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
  DownloadCloud,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { Server, ServerCost } from '@/types';
import { formatTokens } from '@/utils/contextCost';
import { ServerStatusDot } from '@/components/ui/StatusDot';
import ToolCard from '@/components/ui/ToolCard';
import PromptCard from '@/components/ui/PromptCard';
import ResourceCard from '@/components/ui/ResourceCard';
import DeleteDialog from '@/components/ui/DeleteDialog';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Switch } from '@/components/ui/ToggleGroup';
import { useToast } from '@/contexts/ToastContext';
import { useSettingsData } from '@/hooks/useSettingsData';
import { useAuth } from '@/contexts/AuthContext';
import { canManageServer } from '@/utils/serverPermissions';
import {
  getServerVisibilityDisplay,
  getServerVisibilityOptions,
  normalizeServerVisibility,
} from '@/utils/serverVisibility';

interface ServerCardProps {
  server: Server;
  cost?: ServerCost;
  onRemove: (serverName: string) => void;
  onEdit: (server: Server) => void;
  onToggle?: (server: Server, enabled: boolean) => Promise<boolean>;
  onVisibilityChange?: (server: Server, visibility: 'private' | 'group' | 'public') => Promise<boolean>;
  onRefresh?: () => void;
  onReload?: (server: Server) => Promise<boolean>;
  onReinstall?: (server: Server) => Promise<boolean>;
  onOAuthDisconnect?: (server: Server) => Promise<boolean>;
}

type CapabilityTabKey = 'tools' | 'prompts' | 'resources';

type CapabilitySummary = {
  key: CapabilityTabKey;
  icon: LucideIcon;
  label: string;
  total: number;
  enabled: number;
};

interface LoadingControlProps {
  isLoading: boolean;
  children: ReactNode;
  className?: string;
  overlayStyle?: CSSProperties;
  spinnerSize?: number;
}

const LoadingControl = ({
  isLoading,
  children,
  className,
  overlayStyle,
  spinnerSize = 12,
}: LoadingControlProps) => (
  <div className={className ? `relative flex items-center ${className}` : 'relative flex items-center'} aria-busy={isLoading}>
    <div
      className="flex w-full items-center justify-center"
      style={{
        visibility: isLoading ? 'hidden' : 'visible',
        pointerEvents: isLoading ? 'none' : 'auto',
      }}
    >
      {children}
    </div>
    {isLoading && (
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{
          background: 'var(--hub-surface)',
          border: '1px solid var(--hub-line-2)',
          borderRadius: 8,
          ...overlayStyle,
        }}
      >
        <RefreshCw size={spinnerSize} className="animate-spin" style={{ color: 'var(--hub-ink-3)' }} />
      </div>
    )}
  </div>
);

const CapabilityIcon = ({ icon: Icon }: { icon: LucideIcon }) => (
  <span className="hub-server-capability-icon" aria-hidden="true">
    <Icon size={11.5} strokeWidth={1.9} className="block" />
  </span>
);

const transportLabel = (t: any, type?: string) => {
  if (!type) return null;
  if (type === 'stdio') return t('server.typeStdio') || 'stdio';
  if (type === 'sse') return t('server.typeSse') || 'sse';
  if (type === 'streamable-http') return t('server.typeStreamableHttp') || 'http';
  if (type === 'openapi') return t('server.typeOpenapi') || 'openapi';
  return type;
};

const MCP_APPS_MIME_TYPE = 'text/html;profile=mcp-app';

const hasMcpAppsMetadata = (metadata?: Record<string, unknown>) => {
  if (!metadata) return false;
  return Boolean(metadata.ui || metadata['ui/resourceUri']);
};

const serverExposesMcpApp = (server: Server) => {
  return Boolean(
    server.tools?.some((tool) => hasMcpAppsMetadata(tool._meta)) ||
      server.resources?.some(
        (resource) =>
          resource.uri?.startsWith('ui://') ||
          resource.mimeType === MCP_APPS_MIME_TYPE ||
          hasMcpAppsMetadata(resource._meta),
      ),
  );
};

const ServerCard = ({
  server,
  cost,
  onRemove,
  onEdit,
  onToggle,
  onVisibilityChange,
  onRefresh,
  onReload,
  onReinstall,
  onOAuthDisconnect,
}: ServerCardProps) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { exportMCPSettings, installConfig } = useSettingsData();
  const { auth } = useAuth();
  const baseUrl = installConfig?.baseUrl?.replace(/\/+$/, '') || '';

  const [expanded, setExpanded] = useState(false);
  const [expandedTab, setExpandedTab] = useState<'tools' | 'prompts' | 'resources' | 'cost' | null>(
    null,
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showReinstallDialog, setShowReinstallDialog] = useState(false);
  const [showOAuthDisconnectDialog, setShowOAuthDisconnectDialog] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isReinstalling, setIsReinstalling] = useState(false);
  const [isDisconnectingOAuth, setIsDisconnectingOAuth] = useState(false);
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
  const isMcpApp = serverExposesMcpApp(server);
  const enabled = server.enabled !== false;
  const canManage = canManageServer(server, auth.user);
  // Reinstall is only available for stdio servers using npx or uvx
  const supportsReinstall =
    server.config?.command === 'npx' || server.config?.command === 'uvx';
  const supportsOAuthDisconnect = Boolean(server.oauth?.connected && onOAuthDisconnect);

  const handleToggle = async (nextEnabled: boolean) => {
    if (!canManage || isToggling || !onToggle) return;
    setIsToggling(true);
    try {
      await onToggle(server, nextEnabled);
    } finally {
      setIsToggling(false);
    }
  };

  const handleReload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (!canManage || isReloading || !onReload) return;
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

  const handleReinstall = async () => {
    setShowMenu(false);
    if (!canManage || isReinstalling || !onReinstall) return;
    setIsReinstalling(true);
    try {
      const success = await onReinstall(server);
      if (success) {
        showToast(t('server.reinstallSuccess') || 'Server reinstall initiated', 'success');
      } else {
        showToast(
          t('server.reinstallError', { serverName: server.name }) || 'Failed to reinstall',
          'error',
        );
      }
    } finally {
      setIsReinstalling(false);
    }
  };

  const handleOAuthDisconnect = async () => {
    setShowMenu(false);
    if (!canManage || isDisconnectingOAuth || !onOAuthDisconnect) return;
    setIsDisconnectingOAuth(true);
    try {
      const success = await onOAuthDisconnect(server);
      if (success) {
        showToast(t('server.disconnectOAuthSuccess') || 'Server OAuth disconnected', 'success');
      } else {
        showToast(
          t('server.disconnectOAuthError', { serverName: server.name }) || 'Failed to disconnect OAuth',
          'error',
        );
      }
    } finally {
      setIsDisconnectingOAuth(false);
    }
  };

  const handleVisibilityChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    if (!canManage || isUpdatingVisibility || !onVisibilityChange) return;

    const nextVisibility = e.target.value as 'private' | 'group' | 'public';
    if (nextVisibility === normalizeServerVisibility(server.visibility ?? server.config?.visibility)) {
      return;
    }

    setIsUpdatingVisibility(true);
    try {
      await onVisibilityChange(server, nextVisibility);
    } finally {
      setIsUpdatingVisibility(false);
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
    if (!canManage) return;
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

  const serverEndpoint = `${baseUrl}/mcp/${server.name}`;
  const translateVisibility = (key: string, options?: { defaultValue?: string }) => t(key, options);
  const visibility = getServerVisibilityDisplay(
    translateVisibility,
    server.visibility ?? server.config?.visibility,
  );
  const visibilityOptions = getServerVisibilityOptions(translateVisibility, visibility.value);
  const capabilitySummaries: CapabilitySummary[] = [
    {
      key: 'tools',
      icon: Wrench,
      total: totalTools,
      enabled: enabledTools,
      label: t('server.tools'),
    },
    {
      key: 'prompts',
      icon: MessageSquare,
      total: totalPrompts,
      enabled: enabledPrompts,
      label: t('server.prompts'),
    },
    {
      key: 'resources',
      icon: FileText,
      total: totalResources,
      enabled: enabledResources,
      label: t('nav.resources'),
    },
  ];

  return (
    <>
      <div
        className="hub-card overflow-visible"
        style={{ marginBottom: 10 }}
      >
        {/* Main row */}
        <div
          className="hub-server-card-row cursor-pointer px-4 py-3 transition-colors hover:bg-[var(--hub-surface-hover)]"
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
                {isMcpApp && (
                  <span className="hub-tag accent flex-shrink-0" title={t('server.mcpApp')}>
                    App
                  </span>
                )}
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
          <div className="hub-server-card-status-cell min-w-0">
            <ServerStatusDot
              status={server.status}
              enabled={server.enabled}
              onAuthClick={handleOAuth}
              className="hub-server-card-status"
            />
          </div>

          {/* Transport */}
          <div className="hub-server-card-transport-cell min-w-0">
            {server.config?.type ? (
              <span
                className="hub-tag hub-server-card-transport-tag"
                title={transportLabel(t, server.config.type) ?? undefined}
              >
                {transportLabel(t, server.config.type)}
              </span>
            ) : (
              <span style={{ color: 'var(--hub-ink-3)', fontSize: 12 }}>—</span>
            )}
          </div>

          <div className="hub-server-card-visibility min-w-0" onClick={(e) => e.stopPropagation()}>
            {canManage && onVisibilityChange ? (
              <LoadingControl
                isLoading={isUpdatingVisibility}
                className="w-full"
                overlayStyle={{ borderRadius: 6 }}
              >
                <select
                  value={visibility.value}
                  onChange={handleVisibilityChange}
                  disabled={isUpdatingVisibility}
                  className="hub-server-card-select w-full rounded-md border px-2 py-1 text-[11.5px] bg-[var(--hub-surface)] text-[var(--hub-ink)]"
                  style={{ borderColor: 'var(--hub-line-2)' }}
                  aria-label={t('server.visibility', 'Visibility')}
                  title={visibility.longLabel}
                >
                  {visibilityOptions.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </LoadingControl>
            ) : (
              <span
                className={`hub-server-card-visibility-badge inline-flex items-center rounded-md border px-2 py-0.5 text-[11.5px] ${visibility.className}`}
                title={visibility.longLabel}
              >
                {visibility.shortLabel}
              </span>
            )}
          </div>

          {/* Tools / Prompts / Resources counts */}
          {capabilitySummaries.map(({ key, icon: Icon, total, enabled: enabledCount, label }) => {
            const isEmpty = total === 0;
            return (
              <span
                key={key}
                className={`hub-server-capability-stat hub-mono hub-num ${isEmpty ? 'is-empty' : ''}`}
                title={`${label}: ${enabledCount}/${total}`}
              >
                <span className="text-[var(--hub-ink-3)]">
                  <CapabilityIcon icon={Icon} />
                </span>
                <span className="hub-server-capability-value">
                  {isEmpty ? '0' : `${enabledCount}/${total}`}
                </span>
              </span>
            );
          })}

          {/* Context Footprint stat */}
          {cost && cost.connected ? (
            <span
              className="hub-server-capability-stat hub-mono hub-num"
              title={`${t('cost.exposed')} ${cost.exposed} / ${t('cost.gross')} ${cost.gross} · ${t('cost.estimate')}`}
            >
              <span className="text-[var(--hub-ink-3)]">Σ</span>
              <span className="hub-server-capability-value">
                {formatTokens(cost.exposed)}/{formatTokens(cost.gross)}
              </span>
            </span>
          ) : cost ? (
            <span className="hub-server-capability-stat hub-mono is-empty" title={t('cost.notConnected')}>
              <span className="hub-server-capability-value">—</span>
            </span>
          ) : null}

          {/* Toggle switch */}
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <LoadingControl
              isLoading={isToggling}
              className="h-[18px] w-[30px]"
              overlayStyle={{
                borderRadius: 999,
                background: 'var(--hub-bg-2)',
              }}
              spinnerSize={10}
            >
              <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={isToggling || !canManage}
                size="compact"
                aria-label={`${t(enabled ? 'server.disable' : 'server.enable')} ${server.name}`}
              />
            </LoadingControl>
          </div>

          {/* Menu */}
          <div className="relative" ref={menuRef}>
            {canManage && (
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
            )}
            {canManage && showMenu && (
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
                {onReinstall && supportsReinstall && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      if (!canManage || isReinstalling || !enabled) return;
                      setShowReinstallDialog(true);
                    }}
                    disabled={isReinstalling || isToggling || !enabled}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ color: 'var(--hub-ink)' }}
                  >
                    <DownloadCloud size={13} /> {t('server.reinstall')}
                  </button>
                )}
                {supportsOAuthDisconnect && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      if (!canManage || isDisconnectingOAuth) return;
                      setShowOAuthDisconnectDialog(true);
                    }}
                    disabled={isDisconnectingOAuth}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ color: 'var(--hub-ink)' }}
                  >
                    <LogOut size={13} /> {t('server.disconnectOAuth')}
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
            {/* Capability tabs + endpoint on same row */}
            <div className="flex items-center gap-1 mb-2 flex-wrap">
              {capabilitySummaries.map((tab) => {
                const active = expandedTab === tab.key;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setExpandedTab(active ? null : tab.key)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors hover:bg-[var(--hub-surface-hover)]"
                    style={{
                      background: active ? 'var(--hub-surface)' : 'transparent',
                      border: '1px solid ' + (active ? 'var(--hub-line)' : 'transparent'),
                      color: active ? 'var(--hub-ink)' : 'var(--hub-ink-2)',
                    }}
                  >
                    <CapabilityIcon icon={Icon} />
                    <span>{tab.label}</span>
                    <span className="hub-mono hub-num" style={{ color: 'var(--hub-ink-3)', fontSize: 11 }}>
                      {tab.total === 0 ? '0' : `${tab.enabled}/${tab.total}`}
                    </span>
                  </button>
                );
              })}

              {/* Context cost tab */}
              {cost && cost.connected && (
                <button
                  onClick={() => setExpandedTab(expandedTab === 'cost' ? null : 'cost')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors hover:bg-[var(--hub-surface-hover)]"
                  style={{
                    background: expandedTab === 'cost' ? 'var(--hub-surface)' : 'transparent',
                    border: '1px solid ' + (expandedTab === 'cost' ? 'var(--hub-line)' : 'transparent'),
                    color: expandedTab === 'cost' ? 'var(--hub-ink)' : 'var(--hub-ink-2)',
                  }}
                  title={t('cost.estimate')}
                >
                  <span style={{ color: 'var(--hub-ink-3)' }}>Σ</span>
                  <span>{t('cost.totalFootprint')}</span>
                  <span
                    className="hub-mono hub-num"
                    style={{ color: 'var(--hub-ink-3)', fontSize: 11 }}
                  >
                    {formatTokens(cost.exposed)}/{formatTokens(cost.gross)}
                  </span>
                </button>
              )}

              {/* Endpoint inline, pushed to the right */}
              <div className="ml-auto max-w-full flex-shrink-0">
                <div className="hub-endpoint" style={{ height: 26 }}>
                  <div className="hub-endpoint-label">/mcp/</div>
                  <div className="hub-endpoint-url" title={serverEndpoint} style={{ maxWidth: 200 }}>
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
                    <Copy size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* Context Footprint breakdown */}
            {expandedTab === 'cost' && cost?.connected && (
              <div className="mt-2 space-y-1">
                {[...cost.items].sort((a, b) => b.cost - a.cost).map((item) => (
                  <div
                    key={`${item.kind}:${item.name}`}
                    className="flex items-center justify-between hub-mono"
                    style={{ fontSize: 11.5, color: item.enabled ? 'var(--hub-ink-2)' : 'var(--hub-ink-3)' }}
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="hub-num flex-shrink-0">{formatTokens(item.cost)}</span>
                  </div>
                ))}
              </div>
            )}

            {expandedTab === 'tools' && server.tools && (
              <div className="space-y-3 mt-2">
                {server.tools.map((tool, index) => (
                  <ToolCard
                    key={index}
                    server={server.name}
                    tool={tool}
                    readOnly={!canManage}
                    onToggle={handleToolToggle}
                    onDescriptionUpdate={handleToolDescriptionUpdate}
                    cost={cost?.items.find((i) => i.kind === 'tool' && i.name === tool.name)?.cost}
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
                    readOnly={!canManage}
                    onToggle={handlePromptToggle}
                    onDescriptionUpdate={handlePromptDescriptionUpdate}
                    cost={cost?.items.find((i) => i.kind === 'prompt' && i.name === prompt.name)?.cost}
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
                        readOnly={!canManage}
                        onToggle={handleResourceToggle}
                        onDescriptionUpdate={handleResourceDescriptionUpdate}
                        cost={cost?.items.find((i) => i.kind === 'resource' && i.name === resource.uri)?.cost}
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

      <ConfirmDialog
        isOpen={showReinstallDialog}
        onClose={() => setShowReinstallDialog(false)}
        onConfirm={() => {
          setShowReinstallDialog(false);
          handleReinstall();
        }}
        title={t('server.reinstall')}
        message={t('server.reinstallConfirm') || 'This will clear the package cache and re-download dependencies. The server will restart.'}
        confirmText={t('server.reinstall')}
        variant="warning"
      />

      <ConfirmDialog
        isOpen={showOAuthDisconnectDialog}
        onClose={() => setShowOAuthDisconnectDialog(false)}
        onConfirm={() => {
          setShowOAuthDisconnectDialog(false);
          handleOAuthDisconnect();
        }}
        title={t('server.disconnectOAuth')}
        message={t('server.disconnectOAuthConfirm') || 'This will revoke stored OAuth credentials where supported and require authorization again.'}
        confirmText={t('server.disconnectOAuth')}
        variant="warning"
      />
    </>
  );
};

export default ServerCard;
