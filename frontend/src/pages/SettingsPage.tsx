import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { Switch } from '@/components/ui/ToggleGroup';
import { useSettingsData } from '@/hooks/useSettingsData';
import { useToast } from '@/contexts/ToastContext';
import { generateRandomKey } from '@/utils/key';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { Copy, Check, Download } from 'lucide-react';

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();

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
    openaiApiBaseUrl: string;
    openaiApiKey: string;
    openaiApiEmbeddingModel: string;
  }>({
    dbUrl: '',
    openaiApiBaseUrl: '',
    openaiApiKey: '',
    openaiApiEmbeddingModel: '',
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

  const {
    routingConfig,
    tempRoutingConfig,
    setTempRoutingConfig,
    installConfig: savedInstallConfig,
    smartRoutingConfig,
    mcpRouterConfig,
    oauthServerConfig,
    nameSeparator,
    enableSessionRebuild,
    loading,
    updateRoutingConfig,
    updateRoutingConfigBatch,
    updateInstallConfig,
    updateSmartRoutingConfig,
    updateSmartRoutingConfigBatch,
    updateMCPRouterConfig,
    updateOAuthServerConfig,
    updateNameSeparator,
    updateSessionRebuild,
    exportMCPSettings,
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
        openaiApiBaseUrl: smartRoutingConfig.openaiApiBaseUrl || '',
        openaiApiKey: smartRoutingConfig.openaiApiKey || '',
        openaiApiEmbeddingModel: smartRoutingConfig.openaiApiEmbeddingModel || '',
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

  const [sectionsVisible, setSectionsVisible] = useState({
    routingConfig: false,
    installConfig: false,
    smartRoutingConfig: false,
    oauthServerConfig: false,
    mcpRouterConfig: false,
    nameSeparator: false,
    password: false,
    exportConfig: false,
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
      | 'exportConfig',
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
    // If enableBearerAuth is turned on and there's no key, generate one first
    if (key === 'enableBearerAuth' && value === true) {
      if (!tempRoutingConfig.bearerAuthKey && !routingConfig.bearerAuthKey) {
        const newKey = generateRandomKey();
        handleBearerAuthKeyChange(newKey);

        // Update both enableBearerAuth and bearerAuthKey in a single call
        const success = await updateRoutingConfigBatch({
          enableBearerAuth: true,
          bearerAuthKey: newKey,
        });

        if (success) {
          // Update tempRoutingConfig to reflect the saved values
          setTempRoutingConfig((prev) => ({
            ...prev,
            bearerAuthKey: newKey,
          }));
        }
        return;
      }
    }

    await updateRoutingConfig(key, value);
  };

  const handleBearerAuthKeyChange = (value: string) => {
    setTempRoutingConfig((prev) => ({
      ...prev,
      bearerAuthKey: value,
    }));
  };

  const saveBearerAuthKey = async () => {
    await updateRoutingConfig('bearerAuthKey', tempRoutingConfig.bearerAuthKey);
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
    key: 'dbUrl' | 'openaiApiBaseUrl' | 'openaiApiKey' | 'openaiApiEmbeddingModel',
    value: string,
  ) => {
    setTempSmartRoutingConfig({
      ...tempSmartRoutingConfig,
      [key]: value,
    });
  };

  const saveSmartRoutingConfig = async (
    key: 'dbUrl' | 'openaiApiBaseUrl' | 'openaiApiKey' | 'openaiApiEmbeddingModel',
  ) => {
    await updateSmartRoutingConfig(key, tempSmartRoutingConfig[key]);
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
      const currentOpenaiApiKey =
        tempSmartRoutingConfig.openaiApiKey || smartRoutingConfig.openaiApiKey;

      if (!currentDbUrl || !currentOpenaiApiKey) {
        const missingFields = [];
        if (!currentDbUrl) missingFields.push(t('settings.dbUrl'));
        if (!currentOpenaiApiKey) missingFields.push(t('settings.openaiApiKey'));

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

      // Save all changes in a single batch update
      await updateSmartRoutingConfigBatch(updates);
    } else {
      // If disabling, just update the enabled status
      await updateSmartRoutingConfig('enabled', value);
    }
  };

  const handlePasswordChangeSuccess = () => {
    setTimeout(() => {
      navigate('/');
    }, 2000);
  };

  const [copiedConfig, setCopiedConfig] = useState(false);
  const [mcpSettingsJson, setMcpSettingsJson] = useState<string>('');

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

  return (
    <div className="container mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">{t('pages.settings.title')}</h1>

      {/* Smart Routing Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_SMART_ROUTING}>
        <div className="bg-white shadow rounded-lg py-4 px-6 mb-6 page-card dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600"
            onClick={() => toggleSection('smartRoutingConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('pages.settings.smartRouting')}</h2>
            <span className="text-gray-500 transition-transform duration-200">
              {sectionsVisible.smartRoutingConfig ? '▼' : '►'}
            </span>
          </div>

          {sectionsVisible.smartRoutingConfig && (
            <div className="space-y-4 mt-4">
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
                  <button
                    onClick={() => saveSmartRoutingConfig('dbUrl')}
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
                    <span className="text-red-500 px-1">*</span>
                    {t('settings.openaiApiKey')}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="password"
                    value={tempSmartRoutingConfig.openaiApiKey}
                    onChange={(e) => handleSmartRoutingConfigChange('openaiApiKey', e.target.value)}
                    placeholder={t('settings.openaiApiKeyPlaceholder')}
                    className="flex-1 mt-1 block w-full py-2 px-3 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm border-gray-300"
                    disabled={loading}
                  />
                  <button
                    onClick={() => saveSmartRoutingConfig('openaiApiKey')}
                    disabled={loading}
                    className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
                <div className="mb-2">
                  <h3 className="font-medium text-gray-700">{t('settings.openaiApiBaseUrl')}</h3>
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
                  <button
                    onClick={() => saveSmartRoutingConfig('openaiApiBaseUrl')}
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
                  <button
                    onClick={() => saveSmartRoutingConfig('openaiApiEmbeddingModel')}
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

      {/* OAuth Server Configuration Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_OAUTH_SERVER}>
        <div className="bg-white shadow rounded-lg py-4 px-6 mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer"
            onClick={() => toggleSection('oauthServerConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('pages.settings.oauthServer')}</h2>
            <span className="text-gray-500">{sectionsVisible.oauthServerConfig ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.oauthServerConfig && (
            <div className="space-y-4 mt-4">
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
        <div className="bg-white shadow rounded-lg py-4 px-6 mb-6 page-card dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer transition-colors duration-200 hover:text-blue-600"
            onClick={() => toggleSection('mcpRouterConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('settings.mcpRouterConfig')}</h2>
            <span className="text-gray-500 transition-transform duration-200">
              {sectionsVisible.mcpRouterConfig ? '▼' : '►'}
            </span>
          </div>

          {sectionsVisible.mcpRouterConfig && (
            <div className="space-y-4 mt-4">
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
        <div className="bg-white shadow rounded-lg py-4 px-6 mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer"
            onClick={() => toggleSection('nameSeparator')}
          >
            <h2 className="font-semibold text-gray-800">{t('settings.systemSettings')}</h2>
            <span className="text-gray-500">{sectionsVisible.nameSeparator ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.nameSeparator && (
            <div className="space-y-4 mt-4">
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
        <div className="bg-white shadow rounded-lg py-4 px-6 mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer"
            onClick={() => toggleSection('routingConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('pages.settings.routeConfig')}</h2>
            <span className="text-gray-500">{sectionsVisible.routingConfig ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.routingConfig && (
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                <div>
                  <h3 className="font-medium text-gray-700">{t('settings.enableBearerAuth')}</h3>
                  <p className="text-sm text-gray-500">
                    {t('settings.enableBearerAuthDescription')}
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

              {routingConfig.enableBearerAuth && (
                <div className="p-3 bg-gray-50 rounded-md">
                  <div className="mb-2">
                    <h3 className="font-medium text-gray-700">{t('settings.bearerAuthKey')}</h3>
                    <p className="text-sm text-gray-500">
                      {t('settings.bearerAuthKeyDescription')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={tempRoutingConfig.bearerAuthKey}
                      onChange={(e) => handleBearerAuthKeyChange(e.target.value)}
                      placeholder={t('settings.bearerAuthKeyPlaceholder')}
                      className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm form-input"
                      disabled={loading || !routingConfig.enableBearerAuth}
                    />
                    <button
                      onClick={saveBearerAuthKey}
                      disabled={loading || !routingConfig.enableBearerAuth}
                      className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50 btn-primary"
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              )}

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
        <div className="bg-white shadow rounded-lg py-4 px-6 mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer"
            onClick={() => toggleSection('installConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('settings.installConfig')}</h2>
            <span className="text-gray-500">{sectionsVisible.installConfig ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.installConfig && (
            <div className="space-y-4 mt-4">
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
      <div
        className="bg-white shadow rounded-lg py-4 px-6 mb-6 dashboard-card"
        data-section="password"
      >
        <div
          className="flex justify-between items-center cursor-pointer"
          onClick={() => toggleSection('password')}
          role="button"
        >
          <h2 className="font-semibold text-gray-800">{t('auth.changePassword')}</h2>
          <span className="text-gray-500">{sectionsVisible.password ? '▼' : '►'}</span>
        </div>

        {sectionsVisible.password && (
          <div className="max-w-lg mt-4">
            <ChangePasswordForm onSuccess={handlePasswordChangeSuccess} />
          </div>
        )}
      </div>

      {/* Export MCP Settings */}
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_EXPORT_CONFIG}>
        <div className="bg-white shadow rounded-lg py-4 px-6 mb-6 dashboard-card">
          <div
            className="flex justify-between items-center cursor-pointer"
            onClick={() => toggleSection('exportConfig')}
          >
            <h2 className="font-semibold text-gray-800">{t('settings.exportMcpSettings')}</h2>
            <span className="text-gray-500">{sectionsVisible.exportConfig ? '▼' : '►'}</span>
          </div>

          {sectionsVisible.exportConfig && (
            <div className="space-y-4 mt-4">
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
