import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { Switch } from '@/components/ui/ToggleGroup';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { useSettingsData } from '@/hooks/useSettingsData';
import { useToast } from '@/contexts/ToastContext';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { Copy, Check, Download, Edit, Trash2, Code as CodeIcon, Zap, Database, Wrench, Sparkles, RefreshCw, Route as RouteIcon, Key, Lock, Cloud, SlidersHorizontal, ShieldCheck, Package, KeyRound, FileDown, X, FileText } from 'lucide-react';
import { EndpointCopy } from '@/components/ui/EndpointCopy';
import type { BearerKey, User } from '@/types';
import { useServerContext } from '@/contexts/ServerContext';
import { useGroupData } from '@/hooks/useGroupData';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/utils/fetchInterceptor';
import {
  filterBearerKeysByScopeFilter,
  getBearerKeyScopeFilterOptions,
  type BearerKeyScopeFilterValue,
} from '@/utils/bearerKeyScopeFilter';

interface BearerKeyRowProps {
  keyData: BearerKey;
  loading: boolean;
  availableServers: { value: string; label: string }[];
  availableGroups: { value: string; label: string }[];
  isAdmin: boolean;
  onSave: (
    id: string,
    payload: {
      name: string;
      enabled: boolean;
      accessType: 'all' | 'groups' | 'servers' | 'custom';
      allowedGroups: string;
      allowedServers: string;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const BearerKeyRow: React.FC<BearerKeyRowProps> = ({
  keyData,
  loading,
  availableServers,
  availableGroups,
  isAdmin,
  onSave,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(keyData.name);
  const [enabled, setEnabled] = useState<boolean>(keyData.enabled);
  const [accessType, setAccessType] = useState<'all' | 'groups' | 'servers' | 'custom'>(
    keyData.accessType || 'all',
  );
  const [selectedGroups, setSelectedGroups] = useState<string[]>(keyData.allowedGroups || []);
  const [selectedServers, setSelectedServers] = useState<string[]>(keyData.allowedServers || []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setName(keyData.name);
      setEnabled(keyData.enabled);
      setAccessType(keyData.accessType || 'all');
      setSelectedGroups(keyData.allowedGroups || []);
      setSelectedServers(keyData.allowedServers || []);
    }
  }, [keyData, isEditing]);

  const { showToast } = useToast();
  const isSystemKey = (keyData.kind ?? 'system') === 'system';

  const handleSave = async () => {
    if (isSystemKey && accessType === 'groups' && selectedGroups.length === 0) {
      showToast(t('settings.selectAtLeastOneGroup') || 'Please select at least one group', 'error');
      return;
    }
    if (isSystemKey && accessType === 'servers' && selectedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneServer') || 'Please select at least one server',
        'error',
      );
      return;
    }
    if (isSystemKey && accessType === 'custom' && selectedGroups.length === 0 && selectedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneGroupOrServer') || 'Please select at least one group or server',
        'error',
      );
      return;
    }

    setSaving(true);
    try {
      await onSave(keyData.id, {
        name,
        enabled,
        accessType,
        allowedGroups: selectedGroups.join(', '),
        allowedServers: selectedServers.join(', '),
      });
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('settings.deleteBearerKeyConfirm') || 'Delete this key?')) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(keyData.id);
    } finally {
      setDeleting(false);
    }
  };

  const isGroupsMode = accessType === 'groups';
  const isCustomMode = accessType === 'custom';

  // Helper function to format access type display text
  const formatAccessTypeDisplay = (key: BearerKey): string => {
    if ((key.kind ?? 'system') === 'user') {
      return `${t('settings.bearerKeyAccessUserVisibility') || 'User visibility'}${key.owner ? ` · ${key.owner}` : ''}`;
    }
    if (key.accessType === 'all') {
      return t('settings.bearerKeyAccessAll') || 'All Resources';
    }
    if (key.accessType === 'groups') {
      return `${t('settings.bearerKeyAccessGroups') || 'Groups'}: ${key.allowedGroups}`;
    }
    if (key.accessType === 'servers') {
      return `${t('settings.bearerKeyAccessServers') || 'Servers'}: ${key.allowedServers}`;
    }
    if (key.accessType === 'custom') {
      const parts: string[] = [];
      if (key.allowedGroups && key.allowedGroups.length > 0) {
        parts.push(`${t('settings.bearerKeyAccessGroups') || 'Groups'}: ${key.allowedGroups}`);
      }
      if (key.allowedServers && key.allowedServers.length > 0) {
        parts.push(`${t('settings.bearerKeyAccessServers') || 'Servers'}: ${key.allowedServers}`);
      }
      return `${t('settings.bearerKeyAccessCustom') || 'Custom'}: ${parts.join('; ')}`;
    }
    return '';
  };

  if (isEditing) {
    return (
      <tr>
        <td colSpan={5} className="p-0 border-b border-gray-200 dark:border-gray-700">
          <div className="bg-gray-50 dark:bg-gray-800 p-5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-4">
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.bearerKeyName') || 'Name'}
                </label>
                <input
                  type="text"
                  className="block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input transition-shadow duration-200"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="md:col-span-9">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.bearerKeyToken') || 'Token'}
                </label>
                <div className="py-2 px-3 text-sm font-mono text-gray-500">{keyData.token}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="w-40">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.bearerKeyEnabled') || 'Status'}
                </label>
                <div className="flex items-center h-[38px] px-3 bg-white dark:bg-gray-800 border border-gray-300 rounded-md">
                  <span
                    className={`text-sm mr-3 ${enabled ? 'text-green-600 font-medium' : 'text-gray-500'}`}
                  >
                    {enabled ? 'Active' : 'Inactive'}
                  </span>
                  <Switch
                    disabled={loading}
                    checked={enabled}
                    onCheckedChange={(checked) => setEnabled(checked)}
                  />
                </div>
              </div>

              {isAdmin && isSystemKey && <div className="w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.bearerKeyAccessType') || 'Access scope'}
                </label>
                <select
                  className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select transition-shadow duration-200"
                  value={accessType}
                  onChange={(e) =>
                    setAccessType(e.target.value as 'all' | 'groups' | 'servers' | 'custom')
                  }
                  disabled={loading}
                >
                  <option value="all">{t('settings.bearerKeyAccessAll') || 'All Resources'}</option>
                  <option value="groups">
                    {t('settings.bearerKeyAccessGroups') || 'Specific Groups'}
                  </option>
                  <option value="servers">
                    {t('settings.bearerKeyAccessServers') || 'Specific Servers'}
                  </option>
                  <option value="custom">
                    {t('settings.bearerKeyAccessCustom') || 'Custom (Groups & Servers)'}
                  </option>
                </select>
              </div>}

              {/* Show single selector for groups or servers mode */}
              {isAdmin && isSystemKey && !isCustomMode && (
                <div className="flex-1 min-w-[200px]">
                  <label
                    className={`block text-sm font-medium mb-1 ${accessType === 'all' ? 'text-gray-400' : 'text-gray-700'}`}
                  >
                    {isGroupsMode
                      ? t('settings.bearerKeyAllowedGroups') || 'Allowed groups'
                      : t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                  </label>
                  <MultiSelect
                    options={isGroupsMode ? availableGroups : availableServers}
                    selected={isGroupsMode ? selectedGroups : selectedServers}
                    onChange={isGroupsMode ? setSelectedGroups : setSelectedServers}
                    placeholder={
                      isGroupsMode
                        ? t('settings.selectGroups') || 'Select groups...'
                        : t('settings.selectServers') || 'Select servers...'
                    }
                    disabled={loading || accessType === 'all'}
                  />
                </div>
              )}

              {/* Show both selectors for custom mode */}
              {isAdmin && isSystemKey && isCustomMode && (
                <>
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.bearerKeyAllowedGroups') || 'Allowed groups'}
                    </label>
                    <MultiSelect
                      options={availableGroups}
                      selected={selectedGroups}
                      onChange={setSelectedGroups}
                      placeholder={t('settings.selectGroups') || 'Select groups...'}
                      disabled={loading}
                    />
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                    </label>
                    <MultiSelect
                      options={availableServers}
                      selected={selectedServers}
                      onChange={setSelectedServers}
                      placeholder={t('settings.selectServers') || 'Select servers...'}
                      disabled={loading}
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 h-[38px]"
                >
                  {t('common.cancel') || 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading || saving}
                  className="hub-btn primary"
                >
                  {saving ? t('common.saving') || 'Saving...' : t('common.save') || 'Save'}
                </button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700">
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        {keyData.name}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
        <div className="flex items-center gap-2">
          <span>
            {keyData.token.length > 12
              ? `${keyData.token.substring(0, 8)}...${keyData.token.substring(keyData.token.length - 4)}`
              : keyData.token}
          </span>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        <span className={`hub-status ${keyData.enabled ? 'ok' : 'muted'}`}>
          <span className="hub-dot" />
          {keyData.enabled ? t('common.active') || 'Active' : t('common.inactive') || 'Inactive'}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {formatAccessTypeDisplay(keyData)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <button
          onClick={() => setIsEditing(true)}
          className="text-blue-600 hover:text-blue-900 mr-4 inline-flex items-center"
          title={t('common.edit') || 'Edit'}
        >
          <Edit className="h-4 w-4" />
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-red-600 hover:text-red-900 inline-flex items-center"
          title={t('common.delete') || 'Delete'}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
};

/**
 * Returns the default token limit for a given embedding model name.
 * Mirrors the backend getModelDefaultTokenLimit() function.
 * Used to display a contextual hint in the embeddingMaxTokens field.
 */
function getDefaultTokenLimitForUI(model: string): number {
  const lower = model.toLowerCase();
  const MODEL_LIMITS: Array<[string, number]> = [
    ['text-embedding-3-small', 8191],
    ['text-embedding-3-large', 8191],
    ['text-embedding-ada-002', 8191],
    ['gemini-embedding-001', 2048],
    ['bge-m3', 8192],
  ];
  for (const [pattern, limit] of MODEL_LIMITS) {
    if (lower.includes(pattern)) return limit;
  }
  if (lower.includes('bge')) return 512;
  return 512;
}

/**
 * Parses embeddingMaxTokens from form input string.
 * Returns the parsed value if it differs from current value, otherwise undefined (no update needed).
 * - Empty string or whitespace → null (clear override)
 * - Valid number string → parsed number
 * - Invalid input or unchanged value → undefined
 */
function parseEmbeddingMaxTokensForUpdate(
  rawValue: string,
  currentValue: number | null | undefined,
): number | null | undefined {
  const trimmed = rawValue.trim();
  const parsed = trimmed ? parseInt(trimmed, 10) : NaN;
  const result = trimmed && !isNaN(parsed) ? parsed : null;
  const current = currentValue ?? null;
  return result !== current ? result : undefined;
}

function parseBasePacingDelayForUpdate(
  rawValue: string,
  currentValue: number | null | undefined,
): number | null | undefined {
  const trimmed = rawValue.trim();
  const parsed = trimmed ? parseInt(trimmed, 10) : NaN;
  const result = trimmed && !isNaN(parsed) && parsed >= 0 ? parsed : null;
  const current = currentValue ?? null;
  return result !== current ? result : undefined;
}

const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'];

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { allServers: servers } = useServerContext(); // Use allServers for settings (not paginated)
  const { groups } = useGroupData();
  const { auth } = useAuth();
  const isAdmin = auth.user?.isAdmin === true;

  const [installConfig, setInstallConfig] = useState<{
    pythonIndexUrl: string;
    npmRegistry: string;
    baseUrl: string;
  }>({
    pythonIndexUrl: '',
    npmRegistry: '',
    baseUrl: 'http://localhost:3000',
  });

  const [tempSmartRoutingConfig, setTempSmartRoutingConfig] = useState<{
    dbUrl: string;
    basePacingDelayMs: string;
    embeddingProvider: 'openai' | 'azure_openai';
    embeddingEncodingFormat: 'auto' | 'base64' | 'float';
    openaiApiBaseUrl: string;
    openaiApiKey: string;
    openaiApiEmbeddingModel: string;
    azureOpenaiEndpoint: string;
    azureOpenaiApiKey: string;
    azureOpenaiApiVersion: string;
    azureOpenaiEmbeddingDeployment: string;
    azureOpenaiEmbeddingModel: string;
    // Empty string = use model default; numeric string = explicit override
    embeddingMaxTokens: string;
  }>({
    dbUrl: '',
    basePacingDelayMs: '',
    embeddingProvider: 'openai',
    embeddingEncodingFormat: 'auto',
    openaiApiBaseUrl: '',
    openaiApiKey: '',
    openaiApiEmbeddingModel: '',
    azureOpenaiEndpoint: '',
    azureOpenaiApiKey: '',
    azureOpenaiApiVersion: '2024-02-15-preview',
    azureOpenaiEmbeddingDeployment: '',
    azureOpenaiEmbeddingModel: '',
    embeddingMaxTokens: '',
  });

  const [tempToolResultCompressionConfig, setTempToolResultCompressionConfig] = useState<{
    minTokens: string;
    maxOutputTokens: string;
    strategy: 'auto' | 'json' | 'log' | 'search' | 'diff' | 'text';
  }>({
    minTokens: '2000',
    maxOutputTokens: '1200',
    strategy: 'auto',
  });

  const [tempMCPRouterConfig, setTempMCPRouterConfig] = useState<{
    apiKey: string;
    referer: string;
    title: string;
    baseUrl: string;
  }>({
    apiKey: '',
    referer: 'https://www.mcphub.app',
    title: 'MCPHub',
    baseUrl: 'https://api.mcprouter.to/v1',
  });

  const [tempOAuthServerConfig, setTempOAuthServerConfig] = useState<{
    accessTokenLifetime: string;
    refreshTokenLifetime: string;
    authorizationCodeLifetime: string;
    allowedScopes: string;
    dynamicRegistrationAllowedGrantTypes: string;
  }>({
    accessTokenLifetime: '3600',
    refreshTokenLifetime: '1209600',
    authorizationCodeLifetime: '300',
    allowedScopes: 'read, write',
    dynamicRegistrationAllowedGrantTypes: 'authorization_code, refresh_token',
  });

  const [tempBetterAuthConfig, setTempBetterAuthConfig] = useState<{
    basePath: string;
    trustedOrigins: string;
    oidcProviderId: string;
    oidcDiscoveryUrl: string;
    oidcScopes: string;
    oidcPrompt: string;
  }>({
    basePath: '/api/auth/better',
    trustedOrigins: '',
    oidcProviderId: 'oidc',
    oidcDiscoveryUrl: '',
    oidcScopes: DEFAULT_OIDC_SCOPES.join(', '),
    oidcPrompt: '',
  });

  const [tempNameSeparator, setTempNameSeparator] = useState<string>('-');
  const [showAddBearerKeyForm, setShowAddBearerKeyForm] = useState(false);
  const [createdBearerToken, setCreatedBearerToken] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [bearerKeyScopeFilter, setBearerKeyScopeFilter] = useState<BearerKeyScopeFilterValue>('all');

  const {
    routingConfig,
    tempRoutingConfig,
    setTempRoutingConfig,
    installConfig: savedInstallConfig,
    smartRoutingConfig,
    toolResultCompressionConfig,
    mcpRouterConfig,
    oauthServerConfig,
    betterAuthConfig,
    nameSeparator,
    enableSessionRebuild,
    loading,
    bearerKeys,
    updateRoutingConfig,
    updateInstallConfig,
    updateSmartRoutingConfig,
    updateSmartRoutingConfigBatch,
    updateToolResultCompressionConfig,
    updateToolResultCompressionConfigBatch,
    updateMCPRouterConfig,
    updateOAuthServerConfig,
    updateBetterAuthConfigBatch,
    updateNameSeparator,
    updateSessionRebuild,
    exportMCPSettings,
    createBearerKey,
    updateBearerKey,
    deleteBearerKey,
    refreshBearerKeys,
  } = useSettingsData();

  // Update local installConfig when savedInstallConfig changes
  useEffect(() => {
    if (savedInstallConfig) {
      setInstallConfig(savedInstallConfig);
    }
  }, [savedInstallConfig]);

  // Update local tempSmartRoutingConfig when smartRoutingConfig changes
  useEffect(() => {
    if (smartRoutingConfig) {
      setTempSmartRoutingConfig({
        dbUrl: smartRoutingConfig.dbUrl || '',
        basePacingDelayMs:
          smartRoutingConfig.basePacingDelayMs != null
            ? String(smartRoutingConfig.basePacingDelayMs)
            : '',
        embeddingProvider:
          smartRoutingConfig.embeddingProvider === 'azure_openai' ? 'azure_openai' : 'openai',
        embeddingEncodingFormat:
          smartRoutingConfig.embeddingEncodingFormat === 'base64'
            ? 'base64'
            : smartRoutingConfig.embeddingEncodingFormat === 'float'
              ? 'float'
              : 'auto',
        openaiApiBaseUrl: smartRoutingConfig.openaiApiBaseUrl || '',
        openaiApiKey: smartRoutingConfig.openaiApiKey || '',
        openaiApiEmbeddingModel: smartRoutingConfig.openaiApiEmbeddingModel || '',
        azureOpenaiEndpoint: smartRoutingConfig.azureOpenaiEndpoint || '',
        azureOpenaiApiKey: smartRoutingConfig.azureOpenaiApiKey || '',
        azureOpenaiApiVersion: smartRoutingConfig.azureOpenaiApiVersion || '2024-02-15-preview',
        azureOpenaiEmbeddingDeployment: smartRoutingConfig.azureOpenaiEmbeddingDeployment || '',
        azureOpenaiEmbeddingModel: smartRoutingConfig.azureOpenaiEmbeddingModel || '',
        embeddingMaxTokens:
          smartRoutingConfig.embeddingMaxTokens != null
            ? String(smartRoutingConfig.embeddingMaxTokens)
            : '',
      });
    }
  }, [smartRoutingConfig]);

  useEffect(() => {
    if (toolResultCompressionConfig) {
      setTempToolResultCompressionConfig({
        minTokens: String(toolResultCompressionConfig.minTokens || 2000),
        maxOutputTokens: String(toolResultCompressionConfig.maxOutputTokens || 1200),
        strategy: toolResultCompressionConfig.strategy || 'auto',
      });
    }
  }, [toolResultCompressionConfig]);

  // Update local tempMCPRouterConfig when mcpRouterConfig changes
  useEffect(() => {
    if (mcpRouterConfig) {
      setTempMCPRouterConfig({
        apiKey: mcpRouterConfig.apiKey || '',
        referer: mcpRouterConfig.referer || 'https://www.mcphub.app',
        title: mcpRouterConfig.title || 'MCPHub',
        baseUrl: mcpRouterConfig.baseUrl || 'https://api.mcprouter.to/v1',
      });
    }
  }, [mcpRouterConfig]);

  useEffect(() => {
    if (oauthServerConfig) {
      setTempOAuthServerConfig({
        accessTokenLifetime:
          oauthServerConfig.accessTokenLifetime !== undefined
            ? String(oauthServerConfig.accessTokenLifetime)
            : '',
        refreshTokenLifetime:
          oauthServerConfig.refreshTokenLifetime !== undefined
            ? String(oauthServerConfig.refreshTokenLifetime)
            : '',
        authorizationCodeLifetime:
          oauthServerConfig.authorizationCodeLifetime !== undefined
            ? String(oauthServerConfig.authorizationCodeLifetime)
            : '',
        allowedScopes:
          oauthServerConfig.allowedScopes && oauthServerConfig.allowedScopes.length > 0
            ? oauthServerConfig.allowedScopes.join(', ')
            : '',
        dynamicRegistrationAllowedGrantTypes: oauthServerConfig.dynamicRegistration
          ?.allowedGrantTypes?.length
          ? oauthServerConfig.dynamicRegistration.allowedGrantTypes.join(', ')
          : '',
      });
    }
  }, [oauthServerConfig]);

  useEffect(() => {
    if (betterAuthConfig) {
      setTempBetterAuthConfig({
        basePath: betterAuthConfig.basePath || '/api/auth/better',
        trustedOrigins: betterAuthConfig.trustedOrigins?.join(', ') || '',
        oidcProviderId: betterAuthConfig.providers.oidc.providerId || 'oidc',
        oidcDiscoveryUrl: betterAuthConfig.providers.oidc.discoveryUrl || '',
        oidcScopes: betterAuthConfig.providers.oidc.scopes?.join(', ') || DEFAULT_OIDC_SCOPES.join(', '),
        oidcPrompt: betterAuthConfig.providers.oidc.prompt || '',
      });
    }
  }, [betterAuthConfig]);

  // Update local tempNameSeparator when nameSeparator changes
  useEffect(() => {
    setTempNameSeparator(nameSeparator);
  }, [nameSeparator]);

  // Refresh bearer keys when component mounts
  useEffect(() => {
    refreshBearerKeys();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    apiGet<{ success: boolean; data?: User[] }>('/users').then((result) => {
      if (result.success && Array.isArray(result.data)) {
        setUsers(result.data);
      }
    });
  }, [isAdmin]);

  const bearerKeyScopeFilterOptions = useMemo(
    () => getBearerKeyScopeFilterOptions(t, bearerKeys, users),
    [t, bearerKeys, users],
  );

  const filteredBearerKeys = useMemo(
    () => filterBearerKeysByScopeFilter(bearerKeys, bearerKeyScopeFilter),
    [bearerKeys, bearerKeyScopeFilter],
  );

  useEffect(() => {
    if (!bearerKeyScopeFilterOptions.some((option) => option.value === bearerKeyScopeFilter)) {
      setBearerKeyScopeFilter('all');
    }
  }, [bearerKeyScopeFilter, bearerKeyScopeFilterOptions]);

  const [sectionsVisible, setSectionsVisible] = useState({
    routingConfig: false,
    installConfig: false,
    smartRoutingConfig: false,
    toolResultCompressionConfig: false,
    oauthServerConfig: false,
    betterAuthConfig: false,
    mcpRouterConfig: false,
    nameSeparator: false,
    password: false,
    exportConfig: false,
    bearerKeys: false,
  });

  const toggleSection = (
    section:
      | 'routingConfig'
      | 'installConfig'
      | 'smartRoutingConfig'
      | 'toolResultCompressionConfig'
      | 'oauthServerConfig'
      | 'betterAuthConfig'
      | 'mcpRouterConfig'
      | 'nameSeparator'
      | 'password'
      | 'exportConfig'
      | 'bearerKeys',
  ) => {
    setSectionsVisible((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleRoutingConfigChange = async (
    key:
      | 'enableGlobalRoute'
      | 'enableGroupNameRoute'
      | 'enableBearerAuth'
      | 'bearerAuthKey'
      | 'bearerAuthHeaderName'
      | 'jsonBodyLimit'
      | 'skipAuth',
    value: boolean | string,
  ) => {
    await updateRoutingConfig(key, value);
  };

  const handleTempRoutingConfigChange = (
    key: 'bearerAuthHeaderName' | 'jsonBodyLimit',
    value: string,
  ) => {
    setTempRoutingConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleInstallConfigChange = (
    key: 'pythonIndexUrl' | 'npmRegistry' | 'baseUrl',
    value: string,
  ) => {
    setInstallConfig({
      ...installConfig,
      [key]: value,
    });
  };

  const saveInstallConfig = async (key: 'pythonIndexUrl' | 'npmRegistry' | 'baseUrl') => {
    await updateInstallConfig(key, installConfig[key]);
  };

  const handleSmartRoutingConfigChange = (
    key:
      | 'dbUrl'
      | 'basePacingDelayMs'
      | 'embeddingProvider'
      | 'embeddingEncodingFormat'
      | 'openaiApiBaseUrl'
      | 'openaiApiKey'
      | 'openaiApiEmbeddingModel'
      | 'azureOpenaiEndpoint'
      | 'azureOpenaiApiKey'
      | 'azureOpenaiApiVersion'
      | 'azureOpenaiEmbeddingDeployment'
      | 'azureOpenaiEmbeddingModel'
      | 'embeddingMaxTokens',
    value: string,
  ) => {
    setTempSmartRoutingConfig({
      ...tempSmartRoutingConfig,
      [key]: value,
    });
  };

  const handleMCPRouterConfigChange = (
    key: 'apiKey' | 'referer' | 'title' | 'baseUrl',
    value: string,
  ) => {
    setTempMCPRouterConfig({
      ...tempMCPRouterConfig,
      [key]: value,
    });
  };

  const saveMCPRouterConfig = async (key: 'apiKey' | 'referer' | 'title' | 'baseUrl') => {
    await updateMCPRouterConfig(key, tempMCPRouterConfig[key]);
  };

  type OAuthServerNumberField =
    | 'accessTokenLifetime'
    | 'refreshTokenLifetime'
    | 'authorizationCodeLifetime';

  const handleOAuthServerNumberChange = (key: OAuthServerNumberField, value: string) => {
    setTempOAuthServerConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleOAuthServerTextChange = (
    key: 'allowedScopes' | 'dynamicRegistrationAllowedGrantTypes',
    value: string,
  ) => {
    setTempOAuthServerConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const saveOAuthServerNumberConfig = async (key: OAuthServerNumberField) => {
    const rawValue = tempOAuthServerConfig[key];
    if (!rawValue || rawValue.trim() === '') {
      showToast(t('settings.invalidNumberInput') || 'Please enter a valid number', 'error');
      return;
    }

    const parsedValue = Number(rawValue);
    if (Number.isNaN(parsedValue) || parsedValue < 0) {
      showToast(t('settings.invalidNumberInput') || 'Please enter a valid number', 'error');
      return;
    }

    await updateOAuthServerConfig(key, parsedValue);
  };

  const saveOAuthServerAllowedScopes = async () => {
    const scopes = tempOAuthServerConfig.allowedScopes
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);

    await updateOAuthServerConfig('allowedScopes', scopes);
  };

  const saveOAuthServerGrantTypes = async () => {
    const grantTypes = tempOAuthServerConfig.dynamicRegistrationAllowedGrantTypes
      .split(',')
      .map((grant) => grant.trim())
      .filter((grant) => grant.length > 0);

    await updateOAuthServerConfig('dynamicRegistration', {
      ...oauthServerConfig.dynamicRegistration,
      allowedGrantTypes: grantTypes,
    });
  };

  const handleOAuthServerToggle = async (
    key: 'enabled' | 'requireClientSecret' | 'requireState',
    value: boolean,
  ) => {
    await updateOAuthServerConfig(key, value);
  };

  const handleDynamicRegistrationToggle = async (
    updates: Partial<typeof oauthServerConfig.dynamicRegistration>,
  ) => {
    await updateOAuthServerConfig('dynamicRegistration', {
      ...oauthServerConfig.dynamicRegistration,
      ...updates,
    });
  };

  const handleBetterAuthTextChange = (
    key:
      | 'basePath'
      | 'trustedOrigins'
      | 'oidcProviderId'
      | 'oidcDiscoveryUrl'
      | 'oidcScopes'
      | 'oidcPrompt',
    value: string,
  ) => {
    setTempBetterAuthConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleBetterAuthToggle = async (
    updates: Parameters<typeof updateBetterAuthConfigBatch>[0],
  ) => {
    await updateBetterAuthConfigBatch(updates);
  };

  const handleSaveBetterAuthConfig = async () => {
    const updates: Parameters<typeof updateBetterAuthConfigBatch>[0] = {};
    const normalizedBasePath = tempBetterAuthConfig.basePath.trim() || '/api/auth/better';
    const normalizedTrustedOrigins = parseCommaSeparated(tempBetterAuthConfig.trustedOrigins) || [];
    const normalizedProviderId = tempBetterAuthConfig.oidcProviderId.trim() || 'oidc';
    const normalizedDiscoveryUrl = tempBetterAuthConfig.oidcDiscoveryUrl.trim();
    const normalizedScopes =
      parseCommaSeparated(tempBetterAuthConfig.oidcScopes) || [...DEFAULT_OIDC_SCOPES];
    const normalizedPrompt = tempBetterAuthConfig.oidcPrompt.trim();

    if (normalizedBasePath !== betterAuthConfig.basePath) {
      updates.basePath = normalizedBasePath;
    }

    if (
      normalizedTrustedOrigins.join('|') !== (betterAuthConfig.trustedOrigins || []).join('|')
    ) {
      updates.trustedOrigins = normalizedTrustedOrigins;
    }

    const oidcUpdates: Record<string, any> = {};

    if (normalizedProviderId !== betterAuthConfig.providers.oidc.providerId) {
      oidcUpdates.providerId = normalizedProviderId;
    }

    if (normalizedDiscoveryUrl !== (betterAuthConfig.providers.oidc.discoveryUrl || '')) {
      oidcUpdates.discoveryUrl = normalizedDiscoveryUrl;
    }

    if (normalizedScopes.join('|') !== betterAuthConfig.providers.oidc.scopes.join('|')) {
      oidcUpdates.scopes = normalizedScopes;
    }

    if (normalizedPrompt !== (betterAuthConfig.providers.oidc.prompt || '')) {
      oidcUpdates.prompt = normalizedPrompt;
    }

    if (Object.keys(oidcUpdates).length > 0) {
      updates.providers = {
        oidc: oidcUpdates,
      } as any;
    }

    if (Object.keys(updates).length === 0) {
      showToast(t('settings.noChanges') || 'No changes to save', 'info');
      return;
    }

    await updateBetterAuthConfigBatch(updates);
  };

  const saveNameSeparator = async () => {
    await updateNameSeparator(tempNameSeparator);
  };

  const handleSmartRoutingEnabledChange = async (value: boolean) => {
    // If enabling Smart Routing, validate required fields and save any unsaved changes
    if (value) {
      const currentDbUrl = tempSmartRoutingConfig.dbUrl || smartRoutingConfig.dbUrl;
      const missingFields: string[] = [];
      if (!currentDbUrl) missingFields.push(t('settings.dbUrl') || 'Database URL');

      if (tempSmartRoutingConfig.embeddingProvider === 'azure_openai') {
        const currentEndpoint =
          tempSmartRoutingConfig.azureOpenaiEndpoint || smartRoutingConfig.azureOpenaiEndpoint;
        const currentKey =
          tempSmartRoutingConfig.azureOpenaiApiKey || smartRoutingConfig.azureOpenaiApiKey;
        const currentApiVersion =
          tempSmartRoutingConfig.azureOpenaiApiVersion || smartRoutingConfig.azureOpenaiApiVersion;
        const currentDeployment =
          tempSmartRoutingConfig.azureOpenaiEmbeddingDeployment ||
          smartRoutingConfig.azureOpenaiEmbeddingDeployment;

        if (!currentEndpoint || !currentKey || !currentApiVersion || !currentDeployment) {
          missingFields.push(
            t('settings.azureOpenaiEndpoint') || 'Azure OpenAI Endpoint',
            t('settings.azureOpenaiApiKey') || 'Azure OpenAI API Key',
            t('settings.azureOpenaiApiVersion') || 'Azure OpenAI API Version',
            t('settings.azureOpenaiEmbeddingDeployment') || 'Azure Embedding Deployment',
          );
        }
      } else {
        // Get current OpenAI config values with explicit type checking and trim
        const currentOpenaiApiKey = (typeof tempSmartRoutingConfig.openaiApiKey === 'string'
          ? tempSmartRoutingConfig.openaiApiKey
          : smartRoutingConfig.openaiApiKey || ''
        ).trim();
        const currentOpenaiApiBaseUrl = (typeof tempSmartRoutingConfig.openaiApiBaseUrl === 'string'
          ? tempSmartRoutingConfig.openaiApiBaseUrl
          : smartRoutingConfig.openaiApiBaseUrl || ''
        ).trim();
        const currentOpenaiApiEmbeddingModel = (typeof tempSmartRoutingConfig.openaiApiEmbeddingModel === 'string'
          ? tempSmartRoutingConfig.openaiApiEmbeddingModel
          : smartRoutingConfig.openaiApiEmbeddingModel || ''
        ).trim();

        if (!currentOpenaiApiKey) {
          missingFields.push(t('settings.openaiApiKey') || 'OpenAI API Key');
        }
        if (!currentOpenaiApiBaseUrl) {
          missingFields.push(t('settings.openaiApiBaseUrl') || 'OpenAI API Base URL');
        }
        if (!currentOpenaiApiEmbeddingModel) {
          missingFields.push(t('settings.openaiApiEmbeddingModel') || 'OpenAI Embedding Model');
        }
      }

      if (missingFields.length > 0) {
        showToast(
          t('settings.smartRoutingValidationError', {
            fields: missingFields.join(', '),
          }),
        );
        return;
      }

      // Prepare updates object with unsaved changes and enabled status
      const updates: any = { enabled: value };

      // Check for unsaved changes and include them in the batch update
      if (tempSmartRoutingConfig.dbUrl !== smartRoutingConfig.dbUrl) {
        updates.dbUrl = tempSmartRoutingConfig.dbUrl;
      }
      const parsedBasePacingDelay = parseBasePacingDelayForUpdate(
        tempSmartRoutingConfig.basePacingDelayMs,
        smartRoutingConfig.basePacingDelayMs,
      );
      if (parsedBasePacingDelay !== undefined) {
        updates.basePacingDelayMs = parsedBasePacingDelay;
      }
      if (tempSmartRoutingConfig.embeddingProvider !== smartRoutingConfig.embeddingProvider) {
        updates.embeddingProvider = tempSmartRoutingConfig.embeddingProvider;
      }
      if (
        tempSmartRoutingConfig.embeddingEncodingFormat !==
        smartRoutingConfig.embeddingEncodingFormat
      ) {
        updates.embeddingEncodingFormat = tempSmartRoutingConfig.embeddingEncodingFormat;
      }
      if (tempSmartRoutingConfig.openaiApiBaseUrl !== smartRoutingConfig.openaiApiBaseUrl) {
        updates.openaiApiBaseUrl = tempSmartRoutingConfig.openaiApiBaseUrl;
      }
      if (tempSmartRoutingConfig.openaiApiKey !== smartRoutingConfig.openaiApiKey) {
        updates.openaiApiKey = tempSmartRoutingConfig.openaiApiKey;
      }
      if (
        tempSmartRoutingConfig.openaiApiEmbeddingModel !==
        smartRoutingConfig.openaiApiEmbeddingModel
      ) {
        updates.openaiApiEmbeddingModel = tempSmartRoutingConfig.openaiApiEmbeddingModel;
      }

      if (tempSmartRoutingConfig.azureOpenaiEndpoint !== smartRoutingConfig.azureOpenaiEndpoint) {
        updates.azureOpenaiEndpoint = tempSmartRoutingConfig.azureOpenaiEndpoint;
      }
      if (tempSmartRoutingConfig.azureOpenaiApiKey !== smartRoutingConfig.azureOpenaiApiKey) {
        updates.azureOpenaiApiKey = tempSmartRoutingConfig.azureOpenaiApiKey;
      }
      if (
        tempSmartRoutingConfig.azureOpenaiApiVersion !== smartRoutingConfig.azureOpenaiApiVersion
      ) {
        updates.azureOpenaiApiVersion = tempSmartRoutingConfig.azureOpenaiApiVersion;
      }
      if (
        tempSmartRoutingConfig.azureOpenaiEmbeddingDeployment !==
        smartRoutingConfig.azureOpenaiEmbeddingDeployment
      ) {
        updates.azureOpenaiEmbeddingDeployment =
          tempSmartRoutingConfig.azureOpenaiEmbeddingDeployment;
      }
      if (
        tempSmartRoutingConfig.azureOpenaiEmbeddingModel !==
        smartRoutingConfig.azureOpenaiEmbeddingModel
      ) {
        updates.azureOpenaiEmbeddingModel = tempSmartRoutingConfig.azureOpenaiEmbeddingModel;
      }

      // embeddingMaxTokens: empty string → null (clear override), numeric string → number
      const parsedTokens = parseEmbeddingMaxTokensForUpdate(
        tempSmartRoutingConfig.embeddingMaxTokens,
        smartRoutingConfig.embeddingMaxTokens,
      );
      if (parsedTokens !== undefined) {
        updates.embeddingMaxTokens = parsedTokens;
      }

      // Save all changes in a single batch update
      await updateSmartRoutingConfigBatch(updates);
    } else {
      // If disabling, just update the enabled status
      await updateSmartRoutingConfig('enabled', value);
    }
  };

  const handleSaveSmartRoutingConfig = async () => {
    const updates: any = {};

    if (tempSmartRoutingConfig.dbUrl !== smartRoutingConfig.dbUrl) {
      updates.dbUrl = tempSmartRoutingConfig.dbUrl;
    }
    const parsedBasePacingDelay = parseBasePacingDelayForUpdate(
      tempSmartRoutingConfig.basePacingDelayMs,
      smartRoutingConfig.basePacingDelayMs,
    );
    if (parsedBasePacingDelay !== undefined) {
      updates.basePacingDelayMs = parsedBasePacingDelay;
    }
    if (tempSmartRoutingConfig.embeddingProvider !== smartRoutingConfig.embeddingProvider) {
      updates.embeddingProvider = tempSmartRoutingConfig.embeddingProvider;
    }
    if (
      tempSmartRoutingConfig.embeddingEncodingFormat !== smartRoutingConfig.embeddingEncodingFormat
    ) {
      updates.embeddingEncodingFormat = tempSmartRoutingConfig.embeddingEncodingFormat;
    }
    if (tempSmartRoutingConfig.openaiApiBaseUrl !== smartRoutingConfig.openaiApiBaseUrl) {
      updates.openaiApiBaseUrl = tempSmartRoutingConfig.openaiApiBaseUrl;
    }
    if (tempSmartRoutingConfig.openaiApiKey !== smartRoutingConfig.openaiApiKey) {
      updates.openaiApiKey = tempSmartRoutingConfig.openaiApiKey;
    }
    if (
      tempSmartRoutingConfig.openaiApiEmbeddingModel !== smartRoutingConfig.openaiApiEmbeddingModel
    ) {
      updates.openaiApiEmbeddingModel = tempSmartRoutingConfig.openaiApiEmbeddingModel;
    }

    if (tempSmartRoutingConfig.azureOpenaiEndpoint !== smartRoutingConfig.azureOpenaiEndpoint) {
      updates.azureOpenaiEndpoint = tempSmartRoutingConfig.azureOpenaiEndpoint;
    }
    if (tempSmartRoutingConfig.azureOpenaiApiKey !== smartRoutingConfig.azureOpenaiApiKey) {
      updates.azureOpenaiApiKey = tempSmartRoutingConfig.azureOpenaiApiKey;
    }
    if (tempSmartRoutingConfig.azureOpenaiApiVersion !== smartRoutingConfig.azureOpenaiApiVersion) {
      updates.azureOpenaiApiVersion = tempSmartRoutingConfig.azureOpenaiApiVersion;
    }
    if (
      tempSmartRoutingConfig.azureOpenaiEmbeddingDeployment !==
      smartRoutingConfig.azureOpenaiEmbeddingDeployment
    ) {
      updates.azureOpenaiEmbeddingDeployment =
        tempSmartRoutingConfig.azureOpenaiEmbeddingDeployment;
    }
    if (
      tempSmartRoutingConfig.azureOpenaiEmbeddingModel !==
      smartRoutingConfig.azureOpenaiEmbeddingModel
    ) {
      updates.azureOpenaiEmbeddingModel = tempSmartRoutingConfig.azureOpenaiEmbeddingModel;
    }

    // embeddingMaxTokens: empty string → null (clear override), numeric string → number
    const parsedEmbeddingMaxTokens = parseEmbeddingMaxTokensForUpdate(
      tempSmartRoutingConfig.embeddingMaxTokens,
      smartRoutingConfig.embeddingMaxTokens,
    );
    if (parsedEmbeddingMaxTokens !== undefined) {
      updates.embeddingMaxTokens = parsedEmbeddingMaxTokens;
    }

    if (Object.keys(updates).length > 0) {
      await updateSmartRoutingConfigBatch(updates);
    } else {
      showToast(t('settings.noChanges') || 'No changes to save', 'info');
    }
  };

  const handleToolResultCompressionConfigChange = (
    key: 'minTokens' | 'maxOutputTokens' | 'strategy',
    value: string,
  ) => {
    setTempToolResultCompressionConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const parsePositiveIntegerSetting = (value: string, label: string): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showToast(`${label} must be a positive number`, 'error');
      return null;
    }
    return Math.floor(parsed);
  };

  const handleToolResultCompressionEnabledChange = async (value: boolean) => {
    await updateToolResultCompressionConfig('enabled', value);
  };

  const handleSaveToolResultCompressionConfig = async () => {
    const minTokens = parsePositiveIntegerSetting(
      tempToolResultCompressionConfig.minTokens,
      t('settings.toolResultCompressionMinTokens') || 'Minimum tokens',
    );
    if (minTokens === null) return;

    const maxOutputTokens = parsePositiveIntegerSetting(
      tempToolResultCompressionConfig.maxOutputTokens,
      t('settings.toolResultCompressionMaxOutputTokens') || 'Output token budget',
    );
    if (maxOutputTokens === null) return;

    const updates: any = {};
    if (minTokens !== toolResultCompressionConfig.minTokens) {
      updates.minTokens = minTokens;
    }
    if (maxOutputTokens !== toolResultCompressionConfig.maxOutputTokens) {
      updates.maxOutputTokens = maxOutputTokens;
    }
    if (tempToolResultCompressionConfig.strategy !== toolResultCompressionConfig.strategy) {
      updates.strategy = tempToolResultCompressionConfig.strategy;
    }

    if (Object.keys(updates).length > 0) {
      await updateToolResultCompressionConfigBatch(updates);
    } else {
      showToast(t('settings.noChanges') || 'No changes to save', 'info');
    }
  };

  const handlePasswordChangeSuccess = () => {
    setTimeout(() => {
      navigate('/');
    }, 2000);
  };

  const [copiedConfig, setCopiedConfig] = useState(false);
  const [mcpSettingsJson, setMcpSettingsJson] = useState<string>('');

  const [newBearerKey, setNewBearerKey] = useState<{
    name: string;
    enabled: boolean;
    kind: 'system' | 'user';
    owner: string;
    accessType: 'all' | 'groups' | 'servers' | 'custom';
    allowedGroups: string;
    allowedServers: string;
  }>({
    name: '',
    enabled: true,
    kind: 'system',
    owner: '',
    accessType: 'all',
    allowedGroups: '',
    allowedServers: '',
  });

  const [newSelectedGroups, setNewSelectedGroups] = useState<string[]>([]);
  const [newSelectedServers, setNewSelectedServers] = useState<string[]>([]);

  // Prepare options for MultiSelect
  const availableServers = servers.map((server) => ({
    value: server.name,
    label: server.name,
  }));

  const availableGroups = groups.map((group) => ({
    value: group.name,
    label: group.name,
  }));

  // Reset selected arrays when accessType changes
  useEffect(() => {
    if (newBearerKey.accessType !== 'groups' && newBearerKey.accessType !== 'custom') {
      setNewSelectedGroups([]);
    }
    if (newBearerKey.accessType !== 'servers' && newBearerKey.accessType !== 'custom') {
      setNewSelectedServers([]);
    }
  }, [newBearerKey.accessType]);

  const fetchMcpSettings = async () => {
    try {
      const result = await exportMCPSettings();
      console.log('Fetched MCP settings:', result);
      const configJson = JSON.stringify(result.data, null, 2);
      setMcpSettingsJson(configJson);
    } catch (error) {
      console.error('Error fetching MCP settings:', error);
      showToast(t('settings.exportError') || 'Failed to fetch settings', 'error');
    }
  };

  useEffect(() => {
    if (sectionsVisible.exportConfig && !mcpSettingsJson) {
      fetchMcpSettings();
    }
  }, [sectionsVisible.exportConfig]);

  const handleCopyConfig = async () => {
    if (!mcpSettingsJson) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(mcpSettingsJson);
        setCopiedConfig(true);
        showToast(t('common.copySuccess') || 'Copied to clipboard', 'success');
        setTimeout(() => setCopiedConfig(false), 2000);
      } else {
        // Fallback for HTTP or unsupported clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = mcpSettingsJson;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          setCopiedConfig(true);
          showToast(t('common.copySuccess') || 'Copied to clipboard', 'success');
          setTimeout(() => setCopiedConfig(false), 2000);
        } catch (err) {
          showToast(t('common.copyFailed') || 'Copy failed', 'error');
          console.error('Copy to clipboard failed:', err);
        }
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Error copying configuration:', error);
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

  const parseCommaSeparated = (value: string): string[] | undefined => {
    const parts = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return parts.length > 0 ? parts : undefined;
  };

  const handleCreateBearerKey = async () => {
    if (!newBearerKey.name) {
      showToast(t('settings.bearerKeyNameRequired') || 'Name is required', 'error');
      return;
    }

    if (isAdmin && newBearerKey.kind === 'user' && !newBearerKey.owner) {
      showToast(t('settings.bearerKeyOwnerRequired') || 'Owner is required', 'error');
      return;
    }

    if (newBearerKey.kind === 'system' && newBearerKey.accessType === 'groups' && newSelectedGroups.length === 0) {
      showToast(t('settings.selectAtLeastOneGroup') || 'Please select at least one group', 'error');
      return;
    }
    if (newBearerKey.kind === 'system' && newBearerKey.accessType === 'servers' && newSelectedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneServer') || 'Please select at least one server',
        'error',
      );
      return;
    }
    if (
      newBearerKey.kind === 'system' &&
      newBearerKey.accessType === 'custom' &&
      newSelectedGroups.length === 0 &&
      newSelectedServers.length === 0
    ) {
      showToast(
        t('settings.selectAtLeastOneGroupOrServer') || 'Please select at least one group or server',
        'error',
      );
      return;
    }

    const created = await createBearerKey({
      name: newBearerKey.name,
      enabled: newBearerKey.enabled,
      kind: isAdmin ? newBearerKey.kind : 'user',
      owner: isAdmin && newBearerKey.kind === 'user' ? newBearerKey.owner : undefined,
      accessType: newBearerKey.accessType,
      allowedGroups:
        (newBearerKey.accessType === 'groups' || newBearerKey.accessType === 'custom') &&
        newSelectedGroups.length > 0
          ? newSelectedGroups
          : undefined,
      allowedServers:
        (newBearerKey.accessType === 'servers' || newBearerKey.accessType === 'custom') &&
        newSelectedServers.length > 0
          ? newSelectedServers
          : undefined,
    } as any);
    if (!created) return;
    setCreatedBearerToken(created.token);

    setNewBearerKey({
      name: '',
      enabled: true,
      kind: 'system',
      owner: '',
      accessType: 'all',
      allowedGroups: '',
      allowedServers: '',
    });
    setNewSelectedGroups([]);
    setNewSelectedServers([]);
    await refreshBearerKeys();
  };

  const handleSaveExistingBearerKey = async (
    id: string,
    payload: {
      name: string;
      enabled: boolean;
      accessType: 'all' | 'groups' | 'servers' | 'custom';
      allowedGroups: string;
      allowedServers: string;
    },
  ) => {
    await updateBearerKey(id, {
      name: payload.name,
      enabled: payload.enabled,
      accessType: payload.accessType,
      allowedGroups: parseCommaSeparated(payload.allowedGroups),
      allowedServers: parseCommaSeparated(payload.allowedServers),
    } as any);
    await refreshBearerKeys();
  };

  const handleDeleteExistingBearerKey = async (id: string) => {
    await deleteBearerKey(id);
    await refreshBearerKeys();
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="hub-h1">{t('pages.settings.title')}</h1>
        <p className="hub-sub">{t('settings.subtitle') || ''}</p>
      </div>

      {/* Bearer Keys Settings */}
        <div className="hub-card mb-6 overflow-visible">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] rounded-t-[9px] py-3 px-5"
            onClick={() => toggleSection('bearerKeys')}
          >
            <div className="flex items-center gap-2.5">
              <Key size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">
                {t('settings.bearerKeysSectionTitle') || 'Bearer authentication keys'}
              </h2>
            </div>
            <span className="text-[var(--hub-ink-3)]">
              {sectionsVisible.bearerKeys ? '−' : '+'}
            </span>
          </div>

          {sectionsVisible.bearerKeys && (
            <div className="space-y-4 pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
              {createdBearerToken && (
                <div className="p-3 rounded-md border border-amber-300 bg-amber-50 text-sm">
                  <div className="font-medium">
                    {t('settings.bearerKeyShownOnce') || 'Copy this token now. It will not be shown again.'}
                  </div>
                  <div className="mt-2 font-mono break-all">{createdBearerToken}</div>
                </div>
              )}
              {isAdmin && <>
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">
                    {t('settings.enableBearerAuth') || 'Enable Bearer Authentication'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.enableBearerAuthDescription') ||
                      'Require bearer token authentication for MCP requests'}
                  </p>
                </div>
                <Switch
                  disabled={loading}
                  checked={routingConfig.enableBearerAuth}
                  onCheckedChange={(checked) =>
                    handleRoutingConfigChange('enableBearerAuth', checked)
                  }
                />
              </div>
              </>}

              {isAdmin && <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.bearerAuthHeaderName')}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.bearerAuthHeaderNameDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={tempRoutingConfig.bearerAuthHeaderName}
                    onChange={(e) =>
                      handleTempRoutingConfigChange('bearerAuthHeaderName', e.target.value)
                    }
                    placeholder={t('settings.bearerAuthHeaderNamePlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() =>
                      handleRoutingConfigChange(
                        'bearerAuthHeaderName',
                        tempRoutingConfig.bearerAuthHeaderName,
                      )
                    }
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>}

              <div className="flex flex-wrap justify-between items-center gap-3">
                <p className="text-sm text-gray-600">
                  {t('settings.bearerKeysSectionDescription') ||
                    'Manage multiple bearer authentication keys with different access scopes.'}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {bearerKeys.length > 0 && bearerKeyScopeFilterOptions.length > 1 && (
                    <div className="flex items-center gap-2">
                      <label htmlFor="bearer-key-scope-filter" className="text-sm text-gray-600 whitespace-nowrap">
                        {t('settings.bearerKeyScopeFilter') || 'Filter by scope'}
                      </label>
                      <select
                        id="bearer-key-scope-filter"
                        className="block min-w-48 py-2 px-3 border border-gray-300 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select transition-shadow duration-200"
                        value={bearerKeyScopeFilter}
                        onChange={(e) => setBearerKeyScopeFilter(e.target.value as BearerKeyScopeFilterValue)}
                      >
                        {bearerKeyScopeFilterOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!showAddBearerKeyForm && (
                    <button
                      type="button"
                      onClick={() => setShowAddBearerKeyForm(true)}
                      className="flex items-center text-blue-600 hover:text-blue-800 font-medium transition-colors duration-200"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5 mr-1"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {t('settings.addBearerKey') || 'Add bearer key'}
                    </button>
                  )}
                </div>
              </div>

              {/* Existing keys */}
              {bearerKeys.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {t('settings.noBearerKeys') || 'No bearer keys configured yet.'}
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('settings.bearerKeyName') || 'Name'}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('settings.bearerKeyToken') || 'Token'}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('settings.bearerKeyEnabled') || 'Status'}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('settings.bearerKeyAccessType') || 'Access Scope'}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('common.actions') || 'Actions'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredBearerKeys.map((key) => (
                        <BearerKeyRow
                          key={key.id}
                          keyData={key}
                          loading={loading}
                          availableServers={availableServers}
                          availableGroups={availableGroups}
                          isAdmin={isAdmin}
                          onSave={handleSaveExistingBearerKey}
                          onDelete={handleDeleteExistingBearerKey}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* New key form */}
              {showAddBearerKeyForm && (
                <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
                    <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                      <span className="bg-blue-100 text-blue-600 p-1 rounded">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                      {t('settings.addBearerKey') || 'Add bearer key'}
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-4">
                      <div className="md:col-span-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('settings.bearerKeyName') || 'Name'}
                        </label>
                        <input
                          type="text"
                          className="block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input transition-shadow duration-200"
                          placeholder="e.g. My API Key"
                          value={newBearerKey.name}
                          onChange={(e) =>
                            setNewBearerKey((prev) => ({ ...prev, name: e.target.value }))
                          }
                          disabled={loading}
                        />
                      </div>
                      {isAdmin && <div className="md:col-span-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('settings.bearerKeyKind') || 'Key type'}
                        </label>
                        <select
                          className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-800 rounded-md sm:text-sm form-select"
                          value={newBearerKey.kind}
                          onChange={(e) => setNewBearerKey((prev) => ({ ...prev, kind: e.target.value as 'system' | 'user' }))}
                        >
                          <option value="system">{t('settings.bearerKeyKindSystem') || 'System-level'}</option>
                          <option value="user">{t('settings.bearerKeyKindUser') || 'User-level'}</option>
                        </select>
                      </div>}
                      {isAdmin && newBearerKey.kind === 'user' && <div className="md:col-span-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('settings.bearerKeyOwner') || 'Owner'}
                        </label>
                        <select
                          className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-800 rounded-md sm:text-sm form-select"
                          value={newBearerKey.owner}
                          onChange={(e) => setNewBearerKey((prev) => ({ ...prev, owner: e.target.value }))}
                        >
                          <option value="">{t('settings.bearerKeySelectOwner') || 'Select user...'}</option>
                          {users.map((user) => <option key={user.username} value={user.username}>{user.username}</option>)}
                        </select>
                      </div>}
                    </div>

                    <div className="flex flex-wrap items-end gap-4 mb-2">
                      <div className="w-40">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('settings.bearerKeyEnabled') || 'Status'}
                        </label>
                        <div className="flex items-center h-[38px] px-3 bg-white dark:bg-gray-800 border border-gray-300 rounded-md">
                          <span
                            className={`text-sm mr-3 ${newBearerKey.enabled ? 'text-green-600 font-medium' : 'text-gray-500'}`}
                          >
                            {newBearerKey.enabled ? 'Active' : 'Inactive'}
                          </span>
                          <Switch
                            disabled={loading}
                            checked={newBearerKey.enabled}
                            onCheckedChange={(checked) =>
                              setNewBearerKey((prev) => ({ ...prev, enabled: checked }))
                            }
                          />
                        </div>
                      </div>

                      {isAdmin && newBearerKey.kind === 'system' && <div className="w-48">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('settings.bearerKeyAccessType') || 'Access scope'}
                        </label>
                        <select
                          className="block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select transition-shadow duration-200"
                          value={newBearerKey.accessType}
                          onChange={(e) =>
                            setNewBearerKey((prev) => ({
                              ...prev,
                              accessType: e.target.value as 'all' | 'groups' | 'servers' | 'custom',
                            }))
                          }
                          disabled={loading}
                        >
                          <option value="all">
                            {t('settings.bearerKeyAccessAll') || 'All Resources'}
                          </option>
                          <option value="groups">
                            {t('settings.bearerKeyAccessGroups') || 'Specific Groups'}
                          </option>
                          <option value="servers">
                            {t('settings.bearerKeyAccessServers') || 'Specific Servers'}
                          </option>
                          <option value="custom">
                            {t('settings.bearerKeyAccessCustom') || 'Custom (Groups & Servers)'}
                          </option>
                        </select>
                      </div>}

                      {isAdmin && newBearerKey.kind === 'system' && newBearerKey.accessType !== 'custom' && (
                        <div className="flex-1 min-w-[200px]">
                          <label
                            className={`block text-sm font-medium mb-1 ${newBearerKey.accessType === 'all' ? 'text-gray-400' : 'text-gray-700'}`}
                          >
                            {newBearerKey.accessType === 'groups'
                              ? t('settings.bearerKeyAllowedGroups') || 'Allowed groups'
                              : t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                          </label>
                          <MultiSelect
                            options={
                              newBearerKey.accessType === 'groups'
                                ? availableGroups
                                : availableServers
                            }
                            selected={
                              newBearerKey.accessType === 'groups'
                                ? newSelectedGroups
                                : newSelectedServers
                            }
                            onChange={
                              newBearerKey.accessType === 'groups'
                                ? setNewSelectedGroups
                                : setNewSelectedServers
                            }
                            placeholder={
                              newBearerKey.accessType === 'groups'
                                ? t('settings.selectGroups') || 'Select groups...'
                                : t('settings.selectServers') || 'Select servers...'
                            }
                            disabled={loading || newBearerKey.accessType === 'all'}
                          />
                        </div>
                      )}

                      {isAdmin && newBearerKey.kind === 'system' && newBearerKey.accessType === 'custom' && (
                        <>
                          <div className="flex-1 min-w-[200px]">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {t('settings.bearerKeyAllowedGroups') || 'Allowed groups'}
                            </label>
                            <MultiSelect
                              options={availableGroups}
                              selected={newSelectedGroups}
                              onChange={setNewSelectedGroups}
                              placeholder={t('settings.selectGroups') || 'Select groups...'}
                              disabled={loading}
                            />
                          </div>
                          <div className="flex-1 min-w-[200px]">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                            </label>
                            <MultiSelect
                              options={availableServers}
                              selected={newSelectedServers}
                              onChange={setNewSelectedServers}
                              placeholder={t('settings.selectServers') || 'Select servers...'}
                              disabled={loading}
                            />
                          </div>
                        </>
                      )}

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAddBearerKeyForm(false)}
                          className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 h-[38px]"
                        >
                          {t('common.cancel') || 'Cancel'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateBearerKey}
                          disabled={loading}
                          className="hub-btn primary"
                        >
                          {t('settings.addBearerKeyButton') || 'Create Key'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      {/* Smart Routing Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_SMART_ROUTING}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] px-6 py-3"
            onClick={() => toggleSection('smartRoutingConfig')}
          >
            <div className="flex items-center gap-2.5">
              <RouteIcon size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">{t('pages.settings.smartRouting')}</h2>
              <span className="hub-status ml-2" data-state={smartRoutingConfig.enabled ? 'on' : 'off'}>
                <span
                  className="hub-dot"
                  style={{
                    background: smartRoutingConfig.enabled ? 'var(--hub-ok)' : 'var(--hub-ink-3)',
                    boxShadow: smartRoutingConfig.enabled
                      ? '0 0 0 3px oklch(0.66 0.15 145 / 0.15)'
                      : 'none',
                  }}
                />
                <span
                  style={{
                    color: smartRoutingConfig.enabled ? 'oklch(0.4 0.13 145)' : 'var(--hub-ink-3)',
                    fontSize: 12,
                  }}
                >
                  {smartRoutingConfig.enabled ? t('common.active') : t('common.inactive')}
                </span>
              </span>
            </div>
            <span className="text-[var(--hub-ink-3)]">
              {sectionsVisible.smartRoutingConfig ? '−' : '+'}
            </span>
          </div>

          {sectionsVisible.smartRoutingConfig && (
            <div className="px-6 py-5 border-t border-[var(--hub-line-2)]">
              {/* Status banner */}
              <div
                className="hub-card mb-4"
                style={{ padding: 16, background: 'var(--hub-bg-2)' }}
              >
                <div
                  className="grid items-center gap-4"
                  style={{ gridTemplateColumns: '1.1fr 1px 1.4fr 1px auto' }}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative" style={{ width: 40, height: 40 }}>
                      <div
                        className="absolute inset-0 rounded-md grid place-items-center"
                        style={{
                          background: smartRoutingConfig.enabled
                            ? 'oklch(0.95 0.05 145)'
                            : 'var(--hub-bg-2)',
                          border: '1px solid var(--hub-line)',
                        }}
                      >
                        <RouteIcon
                          size={18}
                          style={{
                            color: smartRoutingConfig.enabled
                              ? 'oklch(0.4 0.13 145)'
                              : 'var(--hub-ink-3)',
                          }}
                        />
                      </div>
                      {smartRoutingConfig.enabled && (
                        <span
                          className="absolute"
                          style={{
                            top: -2,
                            right: -2,
                            width: 10,
                            height: 10,
                            borderRadius: 50,
                            background: 'var(--hub-ok)',
                            boxShadow: '0 0 0 2px var(--hub-surface)',
                          }}
                        />
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                        {smartRoutingConfig.enabled
                          ? t('common.active')
                          : t('common.inactive')}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}>
                        {t('settings.enableSmartRoutingDescription')}
                      </div>
                    </div>
                  </div>
                  <div style={{ background: 'var(--hub-line)', height: 36 }} />
                  <div>
                    <div className="hub-sect" style={{ marginBottom: 5 }}>
                      smart endpoint
                    </div>
                    <EndpointCopy
                      label="SMART"
                      url={`${(installConfig.baseUrl || '').replace(/\/+$/, '')}/mcp/$smart`}
                    />
                  </div>
                  <div style={{ background: 'var(--hub-line)', height: 36 }} />
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 12.5, color: 'var(--hub-ink-2)' }}>
                      {t('settings.enableSmartRouting')}
                    </span>
                    <Switch
                      disabled={loading}
                      checked={smartRoutingConfig.enabled}
                      onCheckedChange={(checked) => handleSmartRoutingEnabledChange(checked)}
                    />
                  </div>
                </div>
              </div>

              {/* Flow diagram */}
              <div className="hub-card mb-4" style={{ padding: 18 }}>
                <h3 className="hub-card-title" style={{ marginBottom: 4 }}>
                  {t('settings.smartRoutingWorkflow') || 'Workflow'}
                </h3>
                <p className="hub-sub" style={{ marginTop: 0, marginBottom: 16 }}>
                  {t('settings.smartRoutingWorkflowDescription') ||
                    'Prompt is embedded, top-k similar tools are retrieved from pgvector, only relevant tools are exposed.'}
                </p>
                <div
                  className="grid items-center"
                  style={{ gridTemplateColumns: 'repeat(9, 1fr)' }}
                >
                  {[
                    { icon: <CodeIcon size={16} />, title: 'Prompt', sub: 'client' },
                    null,
                    { icon: <Zap size={16} />, title: 'Embedding', sub: 'openai · 1536d' },
                    null,
                    { icon: <Database size={16} />, title: 'pgvector', sub: 'ann · cosine' },
                    null,
                    { icon: <Wrench size={16} />, title: 'Top-K', sub: 'score > 0.7' },
                    null,
                    { icon: <Sparkles size={16} />, title: 'LLM', sub: 'relevant subset' },
                  ].map((step, i) =>
                    step === null ? (
                      <div key={`sep-${i}`} className="flex justify-center">
                        <svg width="100%" height="20" preserveAspectRatio="none" viewBox="0 0 100 20">
                          <line
                            x1="4"
                            y1="10"
                            x2="96"
                            y2="10"
                            stroke="var(--hub-line)"
                            strokeWidth="1"
                            strokeDasharray="3 3"
                          />
                          <polygon points="96,10 88,6 88,14" fill="var(--hub-ink-3)" />
                        </svg>
                      </div>
                    ) : (
                      <div key={i} className="flex flex-col items-center gap-2">
                        <div
                          className="grid place-items-center"
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 10,
                            border: '1px solid var(--hub-line)',
                            background: 'var(--hub-surface)',
                            color: 'var(--hub-ink)',
                          }}
                        >
                          {step.icon}
                        </div>
                        <div className="text-center">
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{step.title}</div>
                          <div
                            className="hub-mono"
                            style={{ fontSize: 10.5, color: 'var(--hub-ink-3)' }}
                          >
                            {step.sub}
                          </div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>

              {/* Required Fields Information */}
              <div
                className="mb-4 flex items-start gap-2"
                style={{
                  padding: '8px 12px',
                  borderRadius: 7,
                  background: 'var(--hub-accent-soft)',
                  color: 'var(--hub-accent)',
                  fontSize: 12.5,
                }}
              >
                <span>{t('settings.smartRoutingRequiredFields')}</span>
              </div>

              <div className="space-y-3 hub-sr-fields">

              {/* hide when DB_URL env is set */}
              {smartRoutingConfig.dbUrl !== '${DB_URL}' && (
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                  <div className="mb-2">
                    <h3 className="font-medium text-gray-700">
                      <span className="text-red-500 px-1">*</span>
                      {t('settings.dbUrl')}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={tempSmartRoutingConfig.dbUrl}
                      onChange={(e) => handleSmartRoutingConfigChange('dbUrl', e.target.value)}
                      placeholder={t('settings.dbUrlPlaceholder')}
                      className="flex-1 mt-1 block w-full py-2 px-3 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm border-gray-300 form-input"
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.embeddingProvider') || 'Embedding Provider'}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select"
                    value={tempSmartRoutingConfig.embeddingProvider}
                    onChange={(e) =>
                      handleSmartRoutingConfigChange(
                        'embeddingProvider',
                        e.target.value as 'openai' | 'azure_openai',
                      )
                    }
                    disabled={loading}
                  >
                    <option value="openai">OpenAI (or compatible)</option>
                    <option value="azure_openai">Azure OpenAI</option>
                  </select>
                </div>
              </div>

              {tempSmartRoutingConfig.embeddingProvider === 'openai' ? (
                <>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        <span className="text-red-500 px-1">*</span>
                        {t('settings.openaiApiKey')}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="password"
                        value={tempSmartRoutingConfig.openaiApiKey}
                        onChange={(e) =>
                          handleSmartRoutingConfigChange('openaiApiKey', e.target.value)
                        }
                        placeholder={t('settings.openaiApiKeyPlaceholder')}
                        className="flex-1 mt-1 block w-full py-2 px-3 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm border-gray-300"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        <span className="text-red-500 px-1">*</span>
                        {t('settings.openaiApiBaseUrl')}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={tempSmartRoutingConfig.openaiApiBaseUrl}
                        onChange={(e) =>
                          handleSmartRoutingConfigChange('openaiApiBaseUrl', e.target.value)
                        }
                        placeholder={t('settings.openaiApiBaseUrlPlaceholder')}
                        className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                        disabled={loading}
                        required
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        <span className="text-red-500 px-1">*</span>
                        {t('settings.openaiApiEmbeddingModel')}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={tempSmartRoutingConfig.openaiApiEmbeddingModel}
                        onChange={(e) =>
                          handleSmartRoutingConfigChange('openaiApiEmbeddingModel', e.target.value)
                        }
                        placeholder={t('settings.openaiApiEmbeddingModelPlaceholder')}
                        className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                        disabled={loading}
                        required
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        <span className="text-red-500 px-1">*</span>
                        {t('settings.azureOpenaiEndpoint') || 'Azure OpenAI Endpoint'}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={tempSmartRoutingConfig.azureOpenaiEndpoint}
                        onChange={(e) =>
                          handleSmartRoutingConfigChange('azureOpenaiEndpoint', e.target.value)
                        }
                        placeholder={
                          t('settings.azureOpenaiEndpointPlaceholder') ||
                          'https://YOUR_RESOURCE_NAME.openai.azure.com'
                        }
                        className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        <span className="text-red-500 px-1">*</span>
                        {t('settings.azureOpenaiApiKey') || 'Azure OpenAI API Key'}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="password"
                        value={tempSmartRoutingConfig.azureOpenaiApiKey}
                        onChange={(e) =>
                          handleSmartRoutingConfigChange('azureOpenaiApiKey', e.target.value)
                        }
                        placeholder={t('settings.azureOpenaiApiKeyPlaceholder') || '***'}
                        className="flex-1 mt-1 block w-full py-2 px-3 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm border-gray-300"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        <span className="text-red-500 px-1">*</span>
                        {t('settings.azureOpenaiApiVersion') || 'Azure OpenAI API Version'}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={tempSmartRoutingConfig.azureOpenaiApiVersion}
                        onChange={(e) =>
                          handleSmartRoutingConfigChange('azureOpenaiApiVersion', e.target.value)
                        }
                        placeholder={
                          t('settings.azureOpenaiApiVersionPlaceholder') || '2024-02-15-preview'
                        }
                        className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        <span className="text-red-500 px-1">*</span>
                        {t('settings.azureOpenaiEmbeddingDeployment') ||
                          'Azure Embedding Deployment'}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={tempSmartRoutingConfig.azureOpenaiEmbeddingDeployment}
                        onChange={(e) =>
                          handleSmartRoutingConfigChange(
                            'azureOpenaiEmbeddingDeployment',
                            e.target.value,
                          )
                        }
                        placeholder={
                          t('settings.azureOpenaiEmbeddingDeploymentPlaceholder') ||
                          'your-embedding-deployment-name'
                        }
                        className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        <span className="text-red-500 px-1">*</span>
                        {t('settings.azureOpenaiEmbeddingModel') || 'Azure Embedding Model Name'}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {t('settings.azureOpenaiEmbeddingModelDescription') ||
                          'The actual OpenAI model name deployed in Azure (e.g. text-embedding-3-small). Used for accurate token counting.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={tempSmartRoutingConfig.azureOpenaiEmbeddingModel}
                        onChange={(e) =>
                          handleSmartRoutingConfigChange(
                            'azureOpenaiEmbeddingModel',
                            e.target.value,
                          )
                        }
                        placeholder={
                          t('settings.azureOpenaiEmbeddingModelPlaceholder') ||
                          'text-embedding-3-small'
                        }
                        className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                        disabled={loading}
                        required
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.basePacingDelayMs')}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('settings.basePacingDelayMsDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={tempSmartRoutingConfig.basePacingDelayMs}
                    onChange={(e) =>
                      handleSmartRoutingConfigChange('basePacingDelayMs', e.target.value)
                    }
                    placeholder={
                      t('settings.basePacingDelayMsPlaceholder') || 'Empty = default 0 ms'
                    }
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {(() => {
                    const trimmedValue = tempSmartRoutingConfig.basePacingDelayMs.trim();
                    if (!trimmedValue) {
                      return t('settings.basePacingDelayMsAuto', { value: 0 });
                    }
                    if (trimmedValue === '0') {
                      return t('settings.basePacingDelayMsZero');
                    }
                    return t('settings.basePacingDelayMsOverride');
                  })()}
                </p>


              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.embeddingEncodingFormat')}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('settings.embeddingEncodingFormatDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={tempSmartRoutingConfig.embeddingEncodingFormat}
                    onChange={(e) =>
                      handleSmartRoutingConfigChange(
                        'embeddingEncodingFormat',
                        e.target.value as 'auto' | 'base64' | 'float',
                      )
                    }
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select"
                    disabled={loading}
                  >
                    <option value="auto">
                      {t('settings.embeddingEncodingFormatAuto') || 'Auto'}
                    </option>
                    <option value="base64">Base64</option>
                    <option value="float">Float</option>
                  </select>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.embeddingMaxTokens')}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('settings.embeddingMaxTokensDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    value={tempSmartRoutingConfig.embeddingMaxTokens}
                    onChange={(e) =>
                      handleSmartRoutingConfigChange('embeddingMaxTokens', e.target.value)
                    }
                    placeholder={
                      t('settings.embeddingMaxTokensPlaceholder') || 'Empty = auto by model'
                    }
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {(() => {
                    const embeddingModelName =
                      (tempSmartRoutingConfig.embeddingProvider === 'azure_openai'
                        ? tempSmartRoutingConfig.azureOpenaiEmbeddingModel ||
                          smartRoutingConfig.azureOpenaiEmbeddingModel
                        : tempSmartRoutingConfig.openaiApiEmbeddingModel ||
                          smartRoutingConfig.openaiApiEmbeddingModel) ||
                      'text-embedding-3-small';

                    return tempSmartRoutingConfig.embeddingMaxTokens.trim()
                      ? t('settings.embeddingMaxTokensOverride')
                      : t('settings.embeddingMaxTokensAuto', {
                          limit: getDefaultTokenLimitForUI(embeddingModelName),
                          model: embeddingModelName,
                        });
                  })()}
                </p>
              </div>
              
              <div
                className="flex items-center justify-between"
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--hub-line)',
                  borderRadius: 8,
                  background: 'var(--hub-bg-2)',
                }}
              >
                <div>
                  <h3 className="font-medium" style={{ color: 'var(--hub-ink)', fontSize: 13 }}>
                    {t('settings.progressiveDisclosure')}
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--hub-ink-3)' }}>
                    {t('settings.progressiveDisclosureDescription')}
                  </p>
                </div>
                <Switch
                  disabled={loading || !smartRoutingConfig.enabled}
                  checked={smartRoutingConfig.progressiveDisclosure}
                  onCheckedChange={(checked) =>
                    updateSmartRoutingConfig('progressiveDisclosure', checked)
                  }
                />
              </div>
              </div> {/* end space-y-3 fields wrapper */}

              <div className="flex justify-end pt-3">
                <button
                  onClick={handleSaveSmartRoutingConfig}
                  disabled={loading}
                  className="hub-btn primary"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* Tool Result Compression Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_SMART_ROUTING}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] px-6 py-3"
            onClick={() => toggleSection('toolResultCompressionConfig')}
          >
            <div className="flex items-center gap-2.5">
              <FileText size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">
                {t('settings.toolResultCompressionTitle') || 'Tool Result Compression'}
              </h2>
              <span
                className="hub-status ml-2"
                data-state={toolResultCompressionConfig.enabled ? 'on' : 'off'}
              >
                <span
                  className="hub-dot"
                  style={{
                    background: toolResultCompressionConfig.enabled
                      ? 'var(--hub-ok)'
                      : 'var(--hub-ink-3)',
                    boxShadow: toolResultCompressionConfig.enabled
                      ? '0 0 0 3px oklch(0.66 0.15 145 / 0.15)'
                      : 'none',
                  }}
                />
                <span
                  style={{
                    color: toolResultCompressionConfig.enabled
                      ? 'oklch(0.4 0.13 145)'
                      : 'var(--hub-ink-3)',
                    fontSize: 12,
                  }}
                >
                  {toolResultCompressionConfig.enabled ? t('common.active') : t('common.inactive')}
                </span>
              </span>
            </div>
            <span className="text-[var(--hub-ink-3)]">
              {sectionsVisible.toolResultCompressionConfig ? '−' : '+'}
            </span>
          </div>

          {sectionsVisible.toolResultCompressionConfig && (
            <div className="px-6 py-5 border-t border-[var(--hub-line-2)]">
              <div
                className="flex items-center justify-between mb-4"
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--hub-line)',
                  borderRadius: 8,
                  background: 'var(--hub-bg-2)',
                }}
              >
                <div>
                  <h3 className="font-medium" style={{ color: 'var(--hub-ink)', fontSize: 13 }}>
                    {t('settings.toolResultCompressionEnable') || 'Enable compression'}
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--hub-ink-3)' }}>
                    {t('settings.toolResultCompressionDescription') ||
                      'Reduce large text tool outputs before they reach MCP clients. Changes apply to the next tool call.'}
                  </p>
                </div>
                <Switch
                  disabled={loading}
                  checked={toolResultCompressionConfig.enabled}
                  onCheckedChange={(checked) =>
                    handleToolResultCompressionEnabledChange(checked)
                  }
                />
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                  <div className="mb-2">
                    <h3 className="font-medium text-gray-700">
                      {t('settings.toolResultCompressionStrategy') || 'Strategy'}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {t('settings.toolResultCompressionStrategyDescription') ||
                        'Auto detects JSON, logs, search output, diffs, and plain text.'}
                    </p>
                  </div>
                  <select
                    value={tempToolResultCompressionConfig.strategy}
                    onChange={(e) =>
                      handleToolResultCompressionConfigChange(
                        'strategy',
                        e.target.value as any,
                      )
                    }
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 bg-white dark:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select"
                    disabled={loading}
                  >
                    <option value="auto">Auto</option>
                    <option value="json">JSON</option>
                    <option value="log">Log</option>
                    <option value="search">Search</option>
                    <option value="diff">Diff</option>
                    <option value="text">Text</option>
                  </select>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        {t('settings.toolResultCompressionMinTokens') || 'Minimum tokens'}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {t('settings.toolResultCompressionMinTokensDescription') ||
                          'Only compress text blocks at or above this size.'}
                      </p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={tempToolResultCompressionConfig.minTokens}
                      onChange={(e) =>
                        handleToolResultCompressionConfigChange('minTokens', e.target.value)
                      }
                      className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                      disabled={loading}
                    />
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        {t('settings.toolResultCompressionMaxOutputTokens') ||
                          'Output token budget'}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {t('settings.toolResultCompressionMaxOutputTokensDescription') ||
                          'Target maximum tokens for each compressed text block.'}
                      </p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={tempToolResultCompressionConfig.maxOutputTokens}
                      onChange={(e) =>
                        handleToolResultCompressionConfigChange(
                          'maxOutputTokens',
                          e.target.value,
                        )
                      }
                      className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                      disabled={loading}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={handleSaveToolResultCompressionConfig}
                  disabled={loading}
                  className="hub-btn primary"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* OAuth Server Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_OAUTH_SERVER}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] py-3 px-5"
            onClick={() => toggleSection('oauthServerConfig')}
          >
            <div className="flex items-center gap-2.5">
              <Lock size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">{t('pages.settings.oauthServer')}</h2>
            </div>
            <span className="text-[var(--hub-ink-3)]">{sectionsVisible.oauthServerConfig ? '−' : '+'}</span>
          </div>

          {sectionsVisible.oauthServerConfig && (
            <div className="space-y-4 pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">{t('settings.enableOauthServer')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.enableOauthServerDescription')}
                  </p>
                </div>
                <Switch
                  disabled={loading}
                  checked={oauthServerConfig.enabled}
                  onCheckedChange={(checked) => handleOAuthServerToggle('enabled', checked)}
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">{t('settings.requireClientSecret')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.requireClientSecretDescription')}
                  </p>
                </div>
                <Switch
                  disabled={loading || !oauthServerConfig.enabled}
                  checked={oauthServerConfig.requireClientSecret}
                  onCheckedChange={(checked) =>
                    handleOAuthServerToggle('requireClientSecret', checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">{t('settings.requireState')}</h3>
                  <p className="text-sm text-gray-500">{t('settings.requireStateDescription')}</p>
                </div>
                <Switch
                  disabled={loading || !oauthServerConfig.enabled}
                  checked={oauthServerConfig.requireState}
                  onCheckedChange={(checked) => handleOAuthServerToggle('requireState', checked)}
                />
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.accessTokenLifetime')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.accessTokenLifetimeDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={tempOAuthServerConfig.accessTokenLifetime}
                    onChange={(e) =>
                      handleOAuthServerNumberChange('accessTokenLifetime', e.target.value)
                    }
                    placeholder={t('settings.accessTokenLifetimePlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveOAuthServerNumberConfig('accessTokenLifetime')}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.refreshTokenLifetime')}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.refreshTokenLifetimeDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={tempOAuthServerConfig.refreshTokenLifetime}
                    onChange={(e) =>
                      handleOAuthServerNumberChange('refreshTokenLifetime', e.target.value)
                    }
                    placeholder={t('settings.refreshTokenLifetimePlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveOAuthServerNumberConfig('refreshTokenLifetime')}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.authorizationCodeLifetime')}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.authorizationCodeLifetimeDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={tempOAuthServerConfig.authorizationCodeLifetime}
                    onChange={(e) =>
                      handleOAuthServerNumberChange('authorizationCodeLifetime', e.target.value)
                    }
                    placeholder={t('settings.authorizationCodeLifetimePlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveOAuthServerNumberConfig('authorizationCodeLifetime')}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.allowedScopes')}</h3>
                  <p className="text-sm text-gray-500">{t('settings.allowedScopesDescription')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={tempOAuthServerConfig.allowedScopes}
                    onChange={(e) => handleOAuthServerTextChange('allowedScopes', e.target.value)}
                    placeholder={t('settings.allowedScopesPlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={saveOAuthServerAllowedScopes}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-medium text-gray-700">
                      {t('settings.enableDynamicRegistration')}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {t('settings.dynamicRegistrationDescription')}
                    </p>
                  </div>
                  <Switch
                    disabled={loading || !oauthServerConfig.enabled}
                    checked={oauthServerConfig.dynamicRegistration.enabled}
                    onCheckedChange={(checked) =>
                      handleDynamicRegistrationToggle({ enabled: checked })
                    }
                  />
                </div>

                <div>
                  <div className="mb-2">
                    <h3 className="font-medium text-gray-700">
                      {t('settings.dynamicRegistrationAllowedGrantTypes')}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {t('settings.dynamicRegistrationAllowedGrantTypesDescription')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={tempOAuthServerConfig.dynamicRegistrationAllowedGrantTypes}
                      onChange={(e) =>
                        handleOAuthServerTextChange(
                          'dynamicRegistrationAllowedGrantTypes',
                          e.target.value,
                        )
                      }
                      placeholder={t('settings.dynamicRegistrationAllowedGrantTypesPlaceholder')}
                      className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                      disabled={
                        loading ||
                        !oauthServerConfig.enabled ||
                        !oauthServerConfig.dynamicRegistration.enabled
                      }
                    />
                    <button
                      onClick={saveOAuthServerGrantTypes}
                      disabled={
                        loading ||
                        !oauthServerConfig.enabled ||
                        !oauthServerConfig.dynamicRegistration.enabled
                      }
                      className="hub-btn primary"
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-700">
                      {t('settings.dynamicRegistrationAuth')}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {t('settings.dynamicRegistrationAuthDescription')}
                    </p>
                  </div>
                  <Switch
                    disabled={
                      loading ||
                      !oauthServerConfig.enabled ||
                      !oauthServerConfig.dynamicRegistration.enabled
                    }
                    checked={oauthServerConfig.dynamicRegistration.requiresAuthentication}
                    onCheckedChange={(checked) =>
                      handleDynamicRegistrationToggle({ requiresAuthentication: checked })
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* MCPRouter Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_INSTALL_CONFIG}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] py-3 px-5"
            onClick={() => toggleSection('mcpRouterConfig')}
          >
            <div className="flex items-center gap-2.5">
              <Cloud size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">{t('settings.mcpRouterConfig')}</h2>
            </div>
            <span className="text-[var(--hub-ink-3)]">
              {sectionsVisible.mcpRouterConfig ? '−' : '+'}
            </span>
          </div>

          {sectionsVisible.mcpRouterConfig && (
            <div className="space-y-4 pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.mcpRouterApiKey')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.mcpRouterApiKeyDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="password"
                    value={tempMCPRouterConfig.apiKey}
                    onChange={(e) => handleMCPRouterConfigChange('apiKey', e.target.value)}
                    placeholder={t('settings.mcpRouterApiKeyPlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm border-gray-300 form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveMCPRouterConfig('apiKey')}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.mcpRouterBaseUrl')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.mcpRouterBaseUrlDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={tempMCPRouterConfig.baseUrl}
                    onChange={(e) => handleMCPRouterConfigChange('baseUrl', e.target.value)}
                    placeholder={t('settings.mcpRouterBaseUrlPlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveMCPRouterConfig('baseUrl')}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* Better Auth Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_SYSTEM_CONFIG}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] py-3 px-5"
            onClick={() => toggleSection('betterAuthConfig')}
          >
            <div className="flex items-center gap-2.5">
              <Lock size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">
                {t('settings.betterAuthTitle') || 'Better Auth'}
              </h2>
            </div>
            <span className="text-[var(--hub-ink-3)]">
              {sectionsVisible.betterAuthConfig ? '−' : '+'}
            </span>
          </div>

          {sectionsVisible.betterAuthConfig && (
            <div className="space-y-4 pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
              <div
                className="flex items-start gap-2"
                style={{
                  padding: '8px 12px',
                  borderRadius: 7,
                  background: 'var(--hub-accent-soft)',
                  color: 'var(--hub-accent)',
                  fontSize: 12.5,
                }}
              >
                <span>
                  {t('settings.betterAuthEnvNote') ||
                    'Client IDs and secrets still come from environment variables. Changing Better Auth settings may require an application restart, and the install base URL origin is trusted automatically.'}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">
                    {t('settings.enableBetterAuth') || 'Enable Better Auth'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.enableBetterAuthDescription') ||
                      'Enable social and OIDC login when the required environment variables are configured.'}
                  </p>
                </div>
                <Switch
                  disabled={loading}
                  checked={betterAuthConfig.enabled}
                  onCheckedChange={(checked) => handleBetterAuthToggle({ enabled: checked })}
                />
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.betterAuthBasePath') || 'Auth base path'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.betterAuthBasePathDescription') ||
                      'Relative API path used by the Better Auth routes.'}
                  </p>
                </div>
                <input
                  type="text"
                  value={tempBetterAuthConfig.basePath}
                  onChange={(e) => handleBetterAuthTextChange('basePath', e.target.value)}
                  placeholder="/api/auth/better"
                  className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                  disabled={loading}
                />
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.betterAuthTrustedOrigins') || 'Trusted origins'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.betterAuthTrustedOriginsDescription') ||
                      'Comma-separated origins allowed for Better Auth requests. The install base URL origin is added automatically.'}
                  </p>
                </div>
                <input
                  type="text"
                  value={tempBetterAuthConfig.trustedOrigins}
                  onChange={(e) => handleBetterAuthTextChange('trustedOrigins', e.target.value)}
                  placeholder="https://app.example.com, https://admin.example.com"
                  className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                  disabled={loading}
                />
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md space-y-4">
                <div>
                  <h3 className="font-medium text-gray-700">
                    {t('settings.betterAuthProviders') || 'Providers'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.betterAuthProvidersDescription') ||
                      'Provider switches control which configured login methods are exposed on the sign-in page.'}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-700">Google</h4>
                    <p className="text-sm text-gray-500">
                      {t('settings.betterAuthGoogleDescription') ||
                        'Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'}
                    </p>
                  </div>
                  <Switch
                    disabled={loading}
                    checked={betterAuthConfig.providers.google.enabled}
                    onCheckedChange={(checked) =>
                      handleBetterAuthToggle({
                        providers: {
                          google: { enabled: checked },
                        },
                      } as any)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-700">GitHub</h4>
                    <p className="text-sm text-gray-500">
                      {t('settings.betterAuthGithubDescription') ||
                        'Requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.'}
                    </p>
                  </div>
                  <Switch
                    disabled={loading}
                    checked={betterAuthConfig.providers.github.enabled}
                    onCheckedChange={(checked) =>
                      handleBetterAuthToggle({
                        providers: {
                          github: { enabled: checked },
                        },
                      } as any)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-700">OIDC</h4>
                    <p className="text-sm text-gray-500">
                      {t('settings.betterAuthOidcDescription') ||
                        'Requires OIDC client credentials plus a discovery URL.'}
                    </p>
                  </div>
                  <Switch
                    disabled={loading}
                    checked={betterAuthConfig.providers.oidc.enabled}
                    onCheckedChange={(checked) =>
                      handleBetterAuthToggle({
                        providers: {
                          oidc: { enabled: checked },
                        },
                      } as any)
                    }
                  />
                </div>
              </div>

              {betterAuthConfig.providers.oidc.enabled && (
                <>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        {t('settings.betterAuthOidcProviderId') || 'OIDC provider ID'}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {t('settings.betterAuthOidcProviderIdDescription') ||
                          'Provider identifier used when starting the OIDC login flow.'}
                      </p>
                    </div>
                    <input
                      type="text"
                      value={tempBetterAuthConfig.oidcProviderId}
                      onChange={(e) =>
                        handleBetterAuthTextChange('oidcProviderId', e.target.value)
                      }
                      placeholder="oidc"
                      className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                      disabled={loading}
                    />
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        {t('settings.betterAuthOidcDiscoveryUrl') || 'OIDC discovery URL'}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {t('settings.betterAuthOidcDiscoveryUrlDescription') ||
                          'Well-known OpenID configuration URL published by your identity provider.'}
                      </p>
                    </div>
                    <input
                      type="text"
                      value={tempBetterAuthConfig.oidcDiscoveryUrl}
                      onChange={(e) =>
                        handleBetterAuthTextChange('oidcDiscoveryUrl', e.target.value)
                      }
                      placeholder="https://issuer.example.com/.well-known/openid-configuration"
                      className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                      disabled={loading}
                    />
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        {t('settings.betterAuthOidcScopes') || 'OIDC scopes'}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {t('settings.betterAuthOidcScopesDescription') ||
                          'Comma-separated scopes requested during the OIDC sign-in flow.'}
                      </p>
                    </div>
                    <input
                      type="text"
                      value={tempBetterAuthConfig.oidcScopes}
                      onChange={(e) => handleBetterAuthTextChange('oidcScopes', e.target.value)}
                      placeholder="openid, profile, email"
                      className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                      disabled={loading}
                    />
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
                        {t('settings.betterAuthOidcPrompt') || 'OIDC prompt'}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {t('settings.betterAuthOidcPromptDescription') ||
                          'Optional prompt value sent to the identity provider, such as login or consent.'}
                      </p>
                    </div>
                    <input
                      type="text"
                      value={tempBetterAuthConfig.oidcPrompt}
                      onChange={(e) => handleBetterAuthTextChange('oidcPrompt', e.target.value)}
                      placeholder="login"
                      className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                      disabled={loading}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div>
                      <h3 className="font-medium text-gray-700">
                        {t('settings.betterAuthOidcPkce') || 'Enable PKCE'}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {t('settings.betterAuthOidcPkceDescription') ||
                          'Use PKCE for the OIDC authorization flow.'}
                      </p>
                    </div>
                    <Switch
                      disabled={loading}
                      checked={betterAuthConfig.providers.oidc.pkce}
                      onCheckedChange={(checked) =>
                        handleBetterAuthToggle({
                          providers: {
                            oidc: { pkce: checked },
                          },
                        } as any)
                      }
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end pt-3">
                <button
                  onClick={handleSaveBetterAuthConfig}
                  disabled={loading}
                  className="hub-btn primary"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* System Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_SYSTEM_CONFIG}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] py-3 px-5"
            onClick={() => toggleSection('nameSeparator')}
          >
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">{t('settings.systemSettings')}</h2>
            </div>
            <span className="text-[var(--hub-ink-3)]">{sectionsVisible.nameSeparator ? '−' : '+'}</span>
          </div>

          {sectionsVisible.nameSeparator && (
            <div className="space-y-4 pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.nameSeparatorLabel')}</h3>
                  <p className="text-sm text-gray-500">{t('settings.nameSeparatorDescription')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={tempNameSeparator}
                    onChange={(e) => setTempNameSeparator(e.target.value)}
                    placeholder="-"
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                    maxLength={5}
                  />
                  <button
                    onClick={saveNameSeparator}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">
                    {t('settings.enableSessionRebuild')}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.enableSessionRebuildDescription')}
                  </p>
                </div>
                <Switch
                  disabled={loading}
                  checked={enableSessionRebuild}
                  onCheckedChange={(checked) => updateSessionRebuild(checked)}
                />
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* Route Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_ROUTE_CONFIG}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] py-3 px-5"
            onClick={() => toggleSection('routingConfig')}
          >
            <div className="flex items-center gap-2.5">
              <ShieldCheck size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">{t('pages.settings.routeConfig')}</h2>
            </div>
            <span className="text-[var(--hub-ink-3)]">{sectionsVisible.routingConfig ? '−' : '+'}</span>
          </div>

          {sectionsVisible.routingConfig && (
            <div className="space-y-4 pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">{t('settings.enableGlobalRoute')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.enableGlobalRouteDescription')}
                  </p>
                </div>
                <Switch
                  disabled={loading}
                  checked={routingConfig.enableGlobalRoute}
                  onCheckedChange={(checked) =>
                    handleRoutingConfigChange('enableGlobalRoute', checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">
                    {t('settings.enableGroupNameRoute')}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.enableGroupNameRouteDescription')}
                  </p>
                </div>
                <Switch
                  disabled={loading}
                  checked={routingConfig.enableGroupNameRoute}
                  onCheckedChange={(checked) =>
                    handleRoutingConfigChange('enableGroupNameRoute', checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">{t('settings.skipAuth')}</h3>
                  <p className="text-sm text-gray-500">{t('settings.skipAuthDescription')}</p>
                </div>
                <Switch
                  disabled={loading}
                  checked={routingConfig.skipAuth}
                  onCheckedChange={(checked) => handleRoutingConfigChange('skipAuth', checked)}
                />
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.jsonBodyLimit')}</h3>
                  <p className="text-sm text-gray-500">{t('settings.jsonBodyLimitDescription')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={tempRoutingConfig.jsonBodyLimit}
                    onChange={(e) => handleTempRoutingConfigChange('jsonBodyLimit', e.target.value)}
                    placeholder={t('settings.jsonBodyLimitPlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => handleRoutingConfigChange('jsonBodyLimit', tempRoutingConfig.jsonBodyLimit)}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* Installation Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_INSTALL_CONFIG}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] py-3 px-5"
            onClick={() => toggleSection('installConfig')}
          >
            <div className="flex items-center gap-2.5">
              <Package size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">{t('settings.installConfig')}</h2>
            </div>
            <span className="text-[var(--hub-ink-3)]">{sectionsVisible.installConfig ? '−' : '+'}</span>
          </div>

          {sectionsVisible.installConfig && (
            <div className="space-y-4 pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.baseUrl')}</h3>
                  <p className="text-sm text-gray-500">{t('settings.baseUrlDescription')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={installConfig.baseUrl}
                    onChange={(e) => handleInstallConfigChange('baseUrl', e.target.value)}
                    placeholder={t('settings.baseUrlPlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveInstallConfig('baseUrl')}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.pythonIndexUrl')}</h3>
                  <p className="text-sm text-gray-500">{t('settings.pythonIndexUrlDescription')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={installConfig.pythonIndexUrl}
                    onChange={(e) => handleInstallConfigChange('pythonIndexUrl', e.target.value)}
                    placeholder={t('settings.pythonIndexUrlPlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveInstallConfig('pythonIndexUrl')}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.npmRegistry')}</h3>
                  <p className="text-sm text-gray-500">{t('settings.npmRegistryDescription')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={installConfig.npmRegistry}
                    onChange={(e) => handleInstallConfigChange('npmRegistry', e.target.value)}
                    placeholder={t('settings.npmRegistryPlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveInstallConfig('npmRegistry')}
                    disabled={loading}
                    className="hub-btn primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* Change Password */}
      <div className="hub-card mb-6 overflow-hidden" data-section="password">
        <div
          className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] py-3 px-5"
          onClick={() => toggleSection('password')}
          role="button"
        >
          <div className="flex items-center gap-2.5">
            <KeyRound size={15} className="text-[var(--hub-ink-2)]" />
            <h2 className="font-medium text-[var(--hub-ink)]">{t('auth.changePassword')}</h2>
          </div>
          <span className="text-[var(--hub-ink-3)]">{sectionsVisible.password ? '−' : '+'}</span>
        </div>

        {sectionsVisible.password && (
          <div className="max-w-lg pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
            <ChangePasswordForm onSuccess={handlePasswordChangeSuccess} />
          </div>
        )}
      </div>

      {/* Export MCP Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_EXPORT_CONFIG}>
        <div className="hub-card mb-6 overflow-hidden">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)] py-3 px-5"
            onClick={() => toggleSection('exportConfig')}
          >
            <div className="flex items-center gap-2.5">
              <FileDown size={15} className="text-[var(--hub-ink-2)]" />
              <h2 className="font-medium text-[var(--hub-ink)]">{t('settings.exportMcpSettings')}</h2>
            </div>
            <span className="text-[var(--hub-ink-3)]">{sectionsVisible.exportConfig ? '−' : '+'}</span>
          </div>

          {sectionsVisible.exportConfig && (
            <div className="space-y-4 pb-4 px-6 pt-4 border-t border-[var(--hub-line-2)]">
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="mb-4">
                  <h3 className="font-medium text-gray-700">{t('settings.mcpSettingsJson')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.mcpSettingsJsonDescription')}
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleCopyConfig}
                      disabled={!mcpSettingsJson}
                      className="hub-btn primary"
                    >
                      {copiedConfig ? <Check size={16} /> : <Copy size={16} />}
                      {copiedConfig ? t('common.copied') : t('settings.copyToClipboard')}
                    </button>
                    <button
                      onClick={handleDownloadConfig}
                      disabled={!mcpSettingsJson}
                      className="hub-btn"
                    >
                      <Download size={16} />
                      {t('settings.downloadJson')}
                    </button>
                  </div>
                  {mcpSettingsJson && (
                    <div className="mt-3">
                      <pre className="bg-gray-900 text-gray-100 p-4 rounded-md overflow-x-auto text-xs max-h-96">
                        {mcpSettingsJson}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>
    </div>
  );
};

export default SettingsPage;
