import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Cloud, Copy, Download, FileDown, Package, RefreshCw } from 'lucide-react';
import { PermissionChecker } from '@/components/PermissionChecker';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PERMISSIONS } from '@/constants/permissions';
import { useToast } from '@/contexts/ToastContext';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import { apiPost } from '@/utils/fetchInterceptor';
import { copyText } from '@/utils/clipboard';
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  settingsInputClass,
  settingsSelectClass,
} from './SettingsPrimitives';

interface InstallMaintenanceSectionProps {
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const InstallMaintenanceSection: React.FC<InstallMaintenanceSectionProps> = ({
  highlightedSection,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { installConfig, skillImportProxy, mcpRouterConfig, initialLoading } =
    useRuntimeSettings();
  const {
    isSectionSaving,
    updateInstallConfigBatch,
    updateMCPRouterConfigBatch,
    exportMCPSettings,
  } = useSettingsActions();

  const [isClearingCache, setIsClearingCache] = useState(false);
  const [showClearCacheDialog, setShowClearCacheDialog] = useState(false);
  const [exportOpen, setExportOpen] = useState(highlightedSection === 'export-config');
  const [mcpSettingsJson, setMcpSettingsJson] = useState('');
  const [copiedConfig, setCopiedConfig] = useState(false);

  const remoteInstall = useMemo(() => {
    const customProxy = skillImportProxy !== 'direct' && skillImportProxy !== 'server';
    return {
      baseUrl: installConfig.baseUrl || '',
      pythonIndexUrl: installConfig.pythonIndexUrl || '',
      npmRegistry: installConfig.npmRegistry || '',
      skillProxyMode: customProxy ? 'custom' : skillImportProxy || 'server',
      skillProxyAddress: customProxy ? skillImportProxy : '',
    };
  }, [installConfig, skillImportProxy]);

  const installDraft = useSettingsDraft(remoteInstall);

  const remoteRouter = useMemo(
    () => ({
      apiKey: mcpRouterConfig.apiKey || '',
      baseUrl: mcpRouterConfig.baseUrl || 'https://api.mcprouter.to/v1',
    }),
    [mcpRouterConfig],
  );

  const routerDraft = useSettingsDraft(remoteRouter);

  useEffect(() => {
    onDirtyChange?.('install-config', installDraft.dirty);
    return () => onDirtyChange?.('install-config', false);
  }, [installDraft.dirty, onDirtyChange]);

  useEffect(() => {
    onDirtyChange?.('mcp-router', routerDraft.dirty);
    return () => onDirtyChange?.('mcp-router', false);
  }, [routerDraft.dirty, onDirtyChange]);

  useEffect(() => {
    if (highlightedSection === 'export-config') {
      setExportOpen(true);
    }
  }, [highlightedSection]);

  const fetchMcpSettings = async () => {
    try {
      const result = (await exportMCPSettings()) as { data?: unknown } | undefined;
      if (result && 'data' in result) {
        setMcpSettingsJson(JSON.stringify(result.data, null, 2));
      }
    } catch (error) {
      console.error('Error fetching MCP settings:', error);
      showToast(t('settings.exportError') || 'Failed to fetch settings', 'error');
    }
  };

  useEffect(() => {
    if (exportOpen && !mcpSettingsJson) {
      void fetchMcpSettings();
    }
  }, [exportOpen]);

  const savingInstall = isSectionSaving('install');
  const savingRouter = isSectionSaving('mcpRouter');
  const exporting = isSectionSaving('exportConfig');
  const installBusy = initialLoading || savingInstall;
  const routerBusy = initialLoading || savingRouter;

  const handleSaveInstall = async () => {
    const updates: Partial<{
      baseUrl: string;
      pythonIndexUrl: string;
      npmRegistry: string;
      skillImportProxy: string;
    }> = {};

    if ('baseUrl' in installDraft.dirtyFields) {
      updates.baseUrl = installDraft.values.baseUrl;
    }
    if ('pythonIndexUrl' in installDraft.dirtyFields) {
      updates.pythonIndexUrl = installDraft.values.pythonIndexUrl;
    }
    if ('npmRegistry' in installDraft.dirtyFields) {
      updates.npmRegistry = installDraft.values.npmRegistry;
    }
    if (
      'skillProxyMode' in installDraft.dirtyFields ||
      'skillProxyAddress' in installDraft.dirtyFields
    ) {
      updates.skillImportProxy =
        installDraft.values.skillProxyMode === 'custom'
          ? installDraft.values.skillProxyAddress.trim()
          : installDraft.values.skillProxyMode;
    }

    if (Object.keys(updates).length === 0) {
      installDraft.discard();
      return;
    }

    const ok = await updateInstallConfigBatch(updates);
    if (ok) {
      installDraft.discard();
    }
  };

  const handleSaveRouter = async () => {
    const updates: Partial<{ apiKey: string; baseUrl: string }> = {};
    if ('apiKey' in routerDraft.dirtyFields) {
      updates.apiKey = routerDraft.values.apiKey;
    }
    if ('baseUrl' in routerDraft.dirtyFields) {
      updates.baseUrl = routerDraft.values.baseUrl;
    }
    if (Object.keys(updates).length === 0) {
      routerDraft.discard();
      return;
    }
    const ok = await updateMCPRouterConfigBatch(updates);
    if (ok) {
      routerDraft.discard();
    }
  };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      const result = await apiPost<{
        success: boolean;
        message?: string;
        results?: Record<string, { status: string; message?: string }>;
      }>('/cache/clear', {});

      if (!result || !result.success) {
        showToast(
          result?.message || t('settings.clearCacheError') || 'Failed to clear cache',
          'error',
        );
        return;
      }

      const results = result.results || {};
      const parts: string[] = [];
      for (const [runner, info] of Object.entries(results)) {
        if (info.status === 'cleared') {
          parts.push(`${runner}: ✓`);
        } else if (info.status === 'skipped') {
          parts.push(`${runner}: ${t('settings.clearCacheSkipped') || 'skipped'}`);
        } else {
          parts.push(`${runner}: ✗ ${info.message || ''}`);
        }
      }

      const summary = parts.length > 0 ? parts.join(', ') : t('settings.clearCacheSuccess');
      showToast(summary, 'success');
    } catch (err) {
      console.error('Failed to clear cache:', err);
      showToast(t('settings.clearCacheError') || 'Failed to clear cache', 'error');
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleCopyConfig = async () => {
    if (!mcpSettingsJson) return;
    const ok = await copyText(mcpSettingsJson);
    if (ok) {
      setCopiedConfig(true);
      showToast(t('common.copySuccess') || 'Copied to clipboard', 'success');
      setTimeout(() => setCopiedConfig(false), 2000);
    } else {
      showToast(t('common.copyFailed') || 'Copy failed', 'error');
    }
  };

  const handleDownloadConfig = () => {
    if (!mcpSettingsJson) return;
    const blob = new Blob([mcpSettingsJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mcp_settings.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(t('settings.exportSuccess') || 'Settings exported successfully', 'success');
  };

  return (
    <div className="space-y-4">
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_INSTALL_CONFIG}>
        <SettingsCard
          id="install-config"
          title={t('settings.installConfig')}
          description={t('settings.installConfigDescription')}
          icon={<Package size={15} />}
          dirty={installDraft.dirty}
          highlighted={highlightedSection === 'install-config'}
        >
          <SettingsRow
            htmlFor="install-base-url"
            label={t('settings.baseUrl')}
            description={t('settings.baseUrlDescription')}
          >
            <input
              id="install-base-url"
              type="text"
              value={installDraft.values.baseUrl}
              onChange={(e) => installDraft.setField('baseUrl', e.target.value)}
              placeholder={t('settings.baseUrlPlaceholder')}
              className={`${settingsInputClass} mono`}
              disabled={installBusy}
            />
          </SettingsRow>

          <div className="grid gap-3 md:grid-cols-2">
            <SettingsRow
              htmlFor="install-python-index"
              label={t('settings.pythonIndexUrl')}
              description={t('settings.pythonIndexUrlDescription')}
            >
              <input
                id="install-python-index"
                type="text"
                value={installDraft.values.pythonIndexUrl}
                onChange={(e) => installDraft.setField('pythonIndexUrl', e.target.value)}
                placeholder={t('settings.pythonIndexUrlPlaceholder')}
                className={`${settingsInputClass} mono`}
                disabled={installBusy}
              />
            </SettingsRow>

            <SettingsRow
              htmlFor="install-npm-registry"
              label={t('settings.npmRegistry')}
              description={t('settings.npmRegistryDescription')}
            >
              <input
                id="install-npm-registry"
                type="text"
                value={installDraft.values.npmRegistry}
                onChange={(e) => installDraft.setField('npmRegistry', e.target.value)}
                placeholder={t('settings.npmRegistryPlaceholder')}
                className={`${settingsInputClass} mono`}
                disabled={installBusy}
              />
            </SettingsRow>
          </div>

          <SettingsRow
            htmlFor="install-skill-proxy-mode"
            label={t('skills.proxySettings')}
            description={t('skills.proxyHelp')}
          >
            <div className="grid gap-2.5 sm:grid-cols-2">
              <select
                id="install-skill-proxy-mode"
                className={settingsSelectClass}
                value={installDraft.values.skillProxyMode}
                onChange={(e) => installDraft.setField('skillProxyMode', e.target.value)}
                disabled={installBusy}
              >
                <option value="server">{t('skills.proxyServer')}</option>
                <option value="direct">{t('skills.proxyDirect')}</option>
                <option value="custom">{t('skills.proxyCustom')}</option>
              </select>
              {installDraft.values.skillProxyMode === 'custom' && (
                <input
                  type="url"
                  value={installDraft.values.skillProxyAddress}
                  onChange={(e) => installDraft.setField('skillProxyAddress', e.target.value)}
                  placeholder="http://127.0.0.1:7890"
                  className={`${settingsInputClass} mono`}
                  disabled={installBusy}
                />
              )}
            </div>
          </SettingsRow>

          <SettingsSaveBar
            dirty={installDraft.dirty}
            saving={savingInstall}
            disabled={initialLoading}
            onSave={handleSaveInstall}
            onDiscard={installDraft.discard}
          />

          <SettingsRow
            label={t('settings.clearCache')}
            description={t('settings.clearCacheDescription')}
          >
            <button
              type="button"
              onClick={() => setShowClearCacheDialog(true)}
              disabled={isClearingCache}
              className="hub-btn"
            >
              <RefreshCw size={14} className={isClearingCache ? 'animate-spin' : ''} />
              {isClearingCache
                ? t('settings.clearingCache') || 'Clearing...'
                : t('settings.clearCache')}
            </button>
          </SettingsRow>
        </SettingsCard>
      </PermissionChecker>

      <PermissionChecker permissions={PERMISSIONS.SETTINGS_INSTALL_CONFIG}>
        <SettingsCard
          id="mcp-router"
          title={t('settings.mcpRouterConfig')}
          description={t('settings.mcpRouterApiKeyDescription')}
          icon={<Cloud size={15} />}
          dirty={routerDraft.dirty}
          highlighted={highlightedSection === 'mcp-router'}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <SettingsRow
              htmlFor="mcp-router-api-key"
              label={t('settings.mcpRouterApiKey')}
              description={t('settings.mcpRouterApiKeyDescription')}
            >
              <input
                id="mcp-router-api-key"
                type="password"
                value={routerDraft.values.apiKey}
                onChange={(e) => routerDraft.setField('apiKey', e.target.value)}
                placeholder={t('settings.mcpRouterApiKeyPlaceholder')}
                className={settingsInputClass}
                disabled={routerBusy}
              />
            </SettingsRow>

            <SettingsRow
              htmlFor="mcp-router-base-url"
              label={t('settings.mcpRouterBaseUrl')}
              description={t('settings.mcpRouterBaseUrlDescription')}
            >
              <input
                id="mcp-router-base-url"
                type="text"
                value={routerDraft.values.baseUrl}
                onChange={(e) => routerDraft.setField('baseUrl', e.target.value)}
                placeholder={t('settings.mcpRouterBaseUrlPlaceholder')}
                className={`${settingsInputClass} mono`}
                disabled={routerBusy}
              />
            </SettingsRow>
          </div>

          <SettingsSaveBar
            dirty={routerDraft.dirty}
            saving={savingRouter}
            disabled={initialLoading}
            onSave={handleSaveRouter}
            onDiscard={routerDraft.discard}
          />
        </SettingsCard>
      </PermissionChecker>

      <PermissionChecker permissions={PERMISSIONS.SETTINGS_EXPORT_CONFIG}>
        <SettingsCard
          id="export-config"
          title={t('settings.exportMcpSettings')}
          description={t('settings.mcpSettingsJsonDescription')}
          icon={<FileDown size={15} />}
          open={exportOpen}
          onOpenChange={setExportOpen}
          highlighted={highlightedSection === 'export-config'}
        >
          <SettingsRow
            label={t('settings.mcpSettingsJson')}
            description={t('settings.mcpSettingsJsonDescription')}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyConfig}
                  disabled={!mcpSettingsJson || exporting}
                  className="hub-btn primary"
                >
                  {copiedConfig ? <Check size={14} /> : <Copy size={14} />}
                  {copiedConfig ? t('common.copied') : t('settings.copyToClipboard')}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadConfig}
                  disabled={!mcpSettingsJson || exporting}
                  className="hub-btn"
                >
                  <Download size={14} />
                  {t('settings.downloadJson')}
                </button>
                <button
                  type="button"
                  onClick={() => void fetchMcpSettings()}
                  disabled={exporting}
                  className="hub-btn"
                >
                  <RefreshCw size={14} className={exporting ? 'animate-spin' : ''} />
                  {t('common.refresh')}
                </button>
              </div>
              {mcpSettingsJson ? (
                <pre className="hub-mono max-h-96 overflow-x-auto rounded-md border border-[var(--hub-line)] bg-[var(--hub-surface)] p-3.5 text-xs text-[var(--hub-ink)]">
                  {mcpSettingsJson}
                </pre>
              ) : (
                <p className="text-xs text-[var(--hub-ink-3)]">{t('app.loading')}</p>
              )}
            </div>
          </SettingsRow>
        </SettingsCard>
      </PermissionChecker>

      <ConfirmDialog
        isOpen={showClearCacheDialog}
        onClose={() => setShowClearCacheDialog(false)}
        onConfirm={() => {
          setShowClearCacheDialog(false);
          void handleClearCache();
        }}
        title={t('settings.clearCache')}
        message={
          t('settings.clearCacheConfirm') ||
          'This will clear the npm and uv package caches. Servers may need to re-download packages on next start.'
        }
        confirmText={t('settings.clearCache')}
        variant="warning"
      />
    </div>
  );
};

export default InstallMaintenanceSection;
