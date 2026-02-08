import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { Switch } from '@/components/ui/ToggleGroup';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { useSettingsData } from '@/hooks/useSettingsData';
import { useToast } from '@/contexts/ToastContext';
import { generateRandomKey } from '@/utils/key';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { Copy, Check, Download, Edit, Trash2 } from 'lucide-react';
import type { BearerKey } from '@/types';
import { useServerContext } from '@/contexts/ServerContext';
import { useGroupData } from '@/hooks/useGroupData';

interface BearerKeyRowProps {
  keyData: BearerKey;
  loading: boolean;
  availableServers: { value: string; label: string }[];
  availableGroups: { value: string; label: string }[];
  onSave: (
    id: string,
    payload: {
      name: string;
      token: string;
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
  onSave,
  onDelete,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(keyData.name);
  const [token, setToken] = useState(keyData.token);
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
      setToken(keyData.token);
      setEnabled(keyData.enabled);
      setAccessType(keyData.accessType || 'all');
      setSelectedGroups(keyData.allowedGroups || []);
      setSelectedServers(keyData.allowedServers || []);
    }
  }, [keyData, isEditing]);

  const handleCopyToken = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(keyData.token);
        showToast(t('common.copySuccess') || 'Copied to clipboard', 'success');
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = keyData.token;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          showToast(t('common.copySuccess') || 'Copied to clipboard', 'success');
        } catch (err) {
          showToast(t('common.copyFailed') || 'Copy failed', 'error');
        }
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Failed to copy', error);
      showToast(t('common.copyFailed') || 'Copy failed', 'error');
    }
  };

  const handleSave = async () => {
    if (accessType === 'groups' && selectedGroups.length === 0) {
      showToast(t('settings.selectAtLeastOneGroup') || 'Please select at least one group', 'error');
      return;
    }
    if (accessType === 'servers' && selectedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneServer') || 'Please select at least one server',
        'error',
      );
      return;
    }
    if (accessType === 'custom' && selectedGroups.length === 0 && selectedServers.length === 0) {
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
        token,
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
        <td colSpan={5} className="p-0 border-b border-gray-200">
          <div className="bg-gray-50 p-5">
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
                <input
                  type="text"
                  className="block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input transition-shadow duration-200"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="w-40">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.bearerKeyEnabled') || 'Status'}
                </label>
                <div className="flex items-center h-[38px] px-3 bg-white border border-gray-300 rounded-md">
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

              <div className="w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.bearerKeyAccessType') || 'Access scope'}
                </label>
                <select
                  className="block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select transition-shadow duration-200"
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
              </div>

              {/* Show single selector for groups or servers mode */}
              {!isCustomMode && (
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
              {isCustomMode && (
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
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 h-[38px]"
                >
                  {t('common.cancel') || 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading || saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary h-[38px]"
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
    <tr className="hover:bg-gray-50">
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
          <button
            onClick={handleCopyToken}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title={t('common.copy') || 'Copy'}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        <span
          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${keyData.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
        >
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

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { allServers: servers } = useServerContext(); // Use allServers for settings (not paginated)
  const { groups } = useGroupData();

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
    embeddingProvider: 'openai' | 'azure_openai';
    openaiApiBaseUrl: string;
    openaiApiKey: string;
    openaiApiEmbeddingModel: string;
    azureOpenaiEndpoint: string;
    azureOpenaiApiKey: string;
    azureOpenaiApiVersion: string;
    azureOpenaiEmbeddingDeployment: string;
  }>({
    dbUrl: '',
    embeddingProvider: 'openai',
    openaiApiBaseUrl: '',
    openaiApiKey: '',
    openaiApiEmbeddingModel: '',
    azureOpenaiEndpoint: '',
    azureOpenaiApiKey: '',
    azureOpenaiApiVersion: '2024-02-15-preview',
    azureOpenaiEmbeddingDeployment: '',
  });

  const [tempMCPRouterConfig, setTempMCPRouterConfig] = useState<{
    apiKey: string;
    referer: string;
    title: string;
    baseUrl: string;
  }>({
    apiKey: '',
    referer: 'https://www.mcphubx.com',
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

  const [tempNameSeparator, setTempNameSeparator] = useState<string>('-');
  const [showAddBearerKeyForm, setShowAddBearerKeyForm] = useState(false);

  const {
    routingConfig,
    installConfig: savedInstallConfig,
    smartRoutingConfig,
    mcpRouterConfig,
    oauthServerConfig,
    nameSeparator,
    enableSessionRebuild,
    loading,
    bearerKeys,
    updateRoutingConfig,
    updateInstallConfig,
    updateSmartRoutingConfig,
    updateSmartRoutingConfigBatch,
    updateMCPRouterConfig,
    updateOAuthServerConfig,
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
        embeddingProvider:
          smartRoutingConfig.embeddingProvider === 'azure_openai' ? 'azure_openai' : 'openai',
        openaiApiBaseUrl: smartRoutingConfig.openaiApiBaseUrl || '',
        openaiApiKey: smartRoutingConfig.openaiApiKey || '',
        openaiApiEmbeddingModel: smartRoutingConfig.openaiApiEmbeddingModel || '',
        azureOpenaiEndpoint: smartRoutingConfig.azureOpenaiEndpoint || '',
        azureOpenaiApiKey: smartRoutingConfig.azureOpenaiApiKey || '',
        azureOpenaiApiVersion: smartRoutingConfig.azureOpenaiApiVersion || '2024-02-15-preview',
        azureOpenaiEmbeddingDeployment: smartRoutingConfig.azureOpenaiEmbeddingDeployment || '',
      });
    }
  }, [smartRoutingConfig]);

  // Update local tempMCPRouterConfig when mcpRouterConfig changes
  useEffect(() => {
    if (mcpRouterConfig) {
      setTempMCPRouterConfig({
        apiKey: mcpRouterConfig.apiKey || '',
        referer: mcpRouterConfig.referer || 'https://www.mcphubx.com',
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

  // Update local tempNameSeparator when nameSeparator changes
  useEffect(() => {
    setTempNameSeparator(nameSeparator);
  }, [nameSeparator]);

  // Refresh bearer keys when component mounts
  useEffect(() => {
    refreshBearerKeys();
  }, []);

  const [sectionsVisible, setSectionsVisible] = useState({
    routingConfig: false,
    installConfig: false,
    smartRoutingConfig: false,
    oauthServerConfig: false,
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
      | 'oauthServerConfig'
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
      | 'skipAuth',
    value: boolean | string,
  ) => {
    await updateRoutingConfig(key, value);
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
      | 'embeddingProvider'
      | 'openaiApiBaseUrl'
      | 'openaiApiKey'
      | 'openaiApiEmbeddingModel'
      | 'azureOpenaiEndpoint'
      | 'azureOpenaiApiKey'
      | 'azureOpenaiApiVersion'
      | 'azureOpenaiEmbeddingDeployment',
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
        const currentOpenaiApiKey =
          tempSmartRoutingConfig.openaiApiKey || smartRoutingConfig.openaiApiKey;
        if (!currentOpenaiApiKey) {
          missingFields.push(t('settings.openaiApiKey') || 'OpenAI API Key');
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
      if (tempSmartRoutingConfig.embeddingProvider !== smartRoutingConfig.embeddingProvider) {
        updates.embeddingProvider = tempSmartRoutingConfig.embeddingProvider;
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
    if (tempSmartRoutingConfig.embeddingProvider !== smartRoutingConfig.embeddingProvider) {
      updates.embeddingProvider = tempSmartRoutingConfig.embeddingProvider;
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

    if (Object.keys(updates).length > 0) {
      await updateSmartRoutingConfigBatch(updates);
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
    token: string;
    enabled: boolean;
    accessType: 'all' | 'groups' | 'servers' | 'custom';
    allowedGroups: string;
    allowedServers: string;
  }>({
    name: '',
    token: '',
    enabled: true,
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
    if (!newBearerKey.name || !newBearerKey.token) {
      showToast(t('settings.bearerKeyRequired') || 'Name and token are required', 'error');
      return;
    }

    if (newBearerKey.accessType === 'groups' && newSelectedGroups.length === 0) {
      showToast(t('settings.selectAtLeastOneGroup') || 'Please select at least one group', 'error');
      return;
    }
    if (newBearerKey.accessType === 'servers' && newSelectedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneServer') || 'Please select at least one server',
        'error',
      );
      return;
    }
    if (
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

    await createBearerKey({
      name: newBearerKey.name,
      token: newBearerKey.token,
      enabled: newBearerKey.enabled,
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

    setNewBearerKey({
      name: '',
      token: '',
      enabled: true,
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
      token: string;
      enabled: boolean;
      accessType: 'all' | 'groups' | 'servers' | 'custom';
      allowedGroups: string;
      allowedServers: string;
    },
  ) => {
    await updateBearerKey(id, {
      name: payload.name,
      token: payload.token,
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
    <div className="container mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">{t('pages.settings.title')}</h1>

      {/* Bearer Keys Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_ROUTE_CONFIG}>
        <div className="bg-white shadow rounded-lg mb-6 page-card dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
            onClick={() => toggleSection('bearerKeys')}
          >
            <h2 className="font-semibold text-gray-800">
              {t('settings.bearerKeysSectionTitle') || 'Bearer authentication keys'}
            </h2>
            <span className="text-gray-500 transition-transform duration-200">
              {sectionsVisible.bearerKeys ? '▼' : '►'}
            </span>
          </div>

          {sectionsVisible.bearerKeys && (
            <div className="space-y-4 pb-4 px-6">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  {t('settings.bearerKeysSectionDescription') ||
                    'Manage multiple bearer authentication keys with different access scopes.'}
                </p>
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

              {/* Existing keys */}
              {bearerKeys.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {t('settings.noBearerKeys') || 'No bearer keys configured yet.'}
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-lg">
                    <thead className="bg-gray-50">
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
                    <tbody className="bg-white divide-y divide-gray-200">
                      {bearerKeys.map((key) => (
                        <BearerKeyRow
                          key={key.id}
                          keyData={key}
                          loading={loading}
                          availableServers={availableServers}
                          availableGroups={availableGroups}
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
                <div className="mt-6 border-t border-gray-200 pt-6">
                  <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
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
                      <div className="md:col-span-3">
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
                      <div className="md:col-span-9">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('settings.bearerKeyToken') || 'Token'}
                        </label>
                        <div className="flex rounded-md shadow-sm">
                          <input
                            type="text"
                            className="flex-1 block w-full py-2 px-3 border border-gray-300 rounded-l-md rounded-r-none border-r-0 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input transition-shadow duration-200"
                            placeholder="sk-..."
                            value={newBearerKey.token}
                            onChange={(e) =>
                              setNewBearerKey((prev) => ({ ...prev, token: e.target.value }))
                            }
                            disabled={loading}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setNewBearerKey((prev) => ({ ...prev, token: generateRandomKey() }))
                            }
                            disabled={loading}
                            className="relative -ml-[5px] inline-flex items-center px-4 py-2 border border-gray-300 bg-gray-100 text-gray-700 text-sm font-medium rounded-r-md rounded-l-none hover:bg-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 z-10"
                          >
                            {t('settings.generate') || 'Generate'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-4 mb-2">
                      <div className="w-40">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('settings.bearerKeyEnabled') || 'Status'}
                        </label>
                        <div className="flex items-center h-[38px] px-3 bg-white border border-gray-300 rounded-md">
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

                      <div className="w-48">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t('settings.bearerKeyAccessType') || 'Access scope'}
                        </label>
                        <select
                          className="block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select transition-shadow duration-200"
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
                      </div>

                      {newBearerKey.accessType !== 'custom' && (
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

                      {newBearerKey.accessType === 'custom' && (
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
                          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 h-[38px]"
                        >
                          {t('common.cancel') || 'Cancel'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateBearerKey}
                          disabled={loading}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary h-[38px]"
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
      </PermissionChecker>

      {/* Smart Routing Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_SMART_ROUTING}>
        <div className="bg-white shadow rounded-lg mb-6 page-card dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
            onClick={() => toggleSection('smartRoutingConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('pages.settings.smartRouting')}</h2>
            <span className="text-gray-500 transition-transform duration-200">
              {sectionsVisible.smartRoutingConfig ? '▼' : '►'}
            </span>
          </div>

          {sectionsVisible.smartRoutingConfig && (
            <div className="space-y-4 pb-4 px-6">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">{t('settings.enableSmartRouting')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.enableSmartRoutingDescription')}
                  </p>
                </div>
                <Switch
                  disabled={loading}
                  checked={smartRoutingConfig.enabled}
                  onCheckedChange={(checked) => handleSmartRoutingEnabledChange(checked)}
                />
              </div>

              {/* hide when DB_URL env is set */}
              {smartRoutingConfig.dbUrl !== '${DB_URL}' && (
                <div className="p-3 bg-gray-50 rounded-md">
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

              <div className="p-3 bg-gray-50 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">
                    {t('settings.embeddingProvider') || 'Embedding Provider'}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-select"
                    value={tempSmartRoutingConfig.embeddingProvider}
                    onChange={(e) =>
                      handleSmartRoutingConfigChange(
                        'embeddingProvider',
                        e.target.value as 'openai' | 'azure_openai',
                      )
                    }
                    disabled={loading}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="azure_openai">Azure OpenAI</option>
                  </select>
                </div>
              </div>

              {tempSmartRoutingConfig.embeddingProvider === 'openai' ? (
                <>
                  <div className="p-3 bg-gray-50 rounded-md">
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

                  <div className="p-3 bg-gray-50 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
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
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-md">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-700">
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
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 bg-gray-50 rounded-md">
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

                  <div className="p-3 bg-gray-50 rounded-md">
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

                  <div className="p-3 bg-gray-50 rounded-md">
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

                  <div className="p-3 bg-gray-50 rounded-md">
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
                </>
              )}

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">
                    {t('settings.progressiveDisclosure')}
                  </h3>
                  <p className="text-sm text-gray-500">
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

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveSmartRoutingConfig}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
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
        <div className="bg-white shadow rounded-lg mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
            onClick={() => toggleSection('oauthServerConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('pages.settings.oauthServer')}</h2>
            <span className="text-gray-500">{sectionsVisible.oauthServerConfig ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.oauthServerConfig && (
            <div className="space-y-4 pb-4 px-6">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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

              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-md space-y-4">
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
                      className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
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
        <div className="bg-white shadow rounded-lg mb-6 page-card dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
            onClick={() => toggleSection('mcpRouterConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('settings.mcpRouterConfig')}</h2>
            <span className="text-gray-500 transition-transform duration-200">
              {sectionsVisible.mcpRouterConfig ? '▼' : '►'}
            </span>
          </div>

          {sectionsVisible.mcpRouterConfig && (
            <div className="space-y-4 pb-4 px-6">
              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* System Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_SYSTEM_CONFIG}>
        <div className="bg-white shadow rounded-lg mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
            onClick={() => toggleSection('nameSeparator')}
          >
            <h2 className="font-semibold text-gray-800">{t('settings.systemSettings')}</h2>
            <span className="text-gray-500">{sectionsVisible.nameSeparator ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.nameSeparator && (
            <div className="space-y-4 pb-4 px-6">
              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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
        <div className="bg-white shadow rounded-lg mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
            onClick={() => toggleSection('routingConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('pages.settings.routeConfig')}</h2>
            <span className="text-gray-500">{sectionsVisible.routingConfig ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.routingConfig && (
            <div className="space-y-4 pb-4 px-6">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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
            </div>
          )}
        </div>
      </PermissionChecker>

      {/* Installation Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_INSTALL_CONFIG}>
        <div className="bg-white shadow rounded-lg mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
            onClick={() => toggleSection('installConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('settings.installConfig')}</h2>
            <span className="text-gray-500">{sectionsVisible.installConfig ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.installConfig && (
            <div className="space-y-4 pb-4 px-6">
              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
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
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
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
      <div className="bg-white shadow rounded-lg mb-6 dashboard-card" data-section="password">
        <div
          className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
          onClick={() => toggleSection('password')}
          role="button"
        >
          <h2 className="font-semibold text-gray-800">{t('auth.changePassword')}</h2>
          <span className="text-gray-500">{sectionsVisible.password ? '▼' : '►'}</span>
        </div>

        {sectionsVisible.password && (
          <div className="max-w-lg pb-4 px-6">
            <ChangePasswordForm onSuccess={handlePasswordChangeSuccess} />
          </div>
        )}
      </div>

      {/* Export MCP Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_EXPORT_CONFIG}>
        <div className="bg-white shadow rounded-lg mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600 py-4 px-6"
            onClick={() => toggleSection('exportConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('settings.exportMcpSettings')}</h2>
            <span className="text-gray-500">{sectionsVisible.exportConfig ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.exportConfig && (
            <div className="space-y-4 pb-4 px-6">
              <div className="p-3 bg-gray-50 rounded-md">
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
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                    >
                      {copiedConfig ? <Check size={16} /> : <Copy size={16} />}
                      {copiedConfig ? t('common.copied') : t('settings.copyToClipboard')}
                    </button>
                    <button
                      onClick={handleDownloadConfig}
                      disabled={!mcpSettingsJson}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
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
