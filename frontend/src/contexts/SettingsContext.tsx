import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ApiResponse, BearerKey, FileStagingConfig } from '@/types';
import type { FakeIpException } from '../../../src/types/network.js';
import type { ToolPolicyRule } from '../../../src/types/toolPolicy.js';
import { validateToolPolicies } from '../../../src/utils/toolPolicy.js';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet, apiPut, apiPost, apiDelete } from '@/utils/fetchInterceptor';
import type {
  BetterAuthConfig,
  InstallConfig,
  MCPRouterConfig,
  OAuthServerConfig,
  RoutingConfig,
  RuntimeSettingsContextValue,
  SettingsActionsContextValue,
  SettingsContextValue,
  SettingsSectionKey,
  SmartRoutingConfig,
  SystemSettings,
  TempRoutingConfig,
  ToolResultCompressionConfig,
} from './settingsTypes';

export type {
  BetterAuthConfig,
  InstallConfig,
  MCPRouterConfig,
  OAuthServerConfig,
  RoutingConfig,
  RuntimeSettingsContextValue,
  SettingsActionsContextValue,
  SettingsContextValue,
  SettingsSectionKey,
  SmartRoutingConfig,
  SystemSettings,
  TempRoutingConfig,
  ToolResultCompressionConfig,
};

const getDefaultOAuthServerConfig = (): OAuthServerConfig => ({
  alwaysShowApprovalScreen: true,
  approvalLifetime: 1209600,
  enabled: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 1209600,
  authorizationCodeLifetime: 300,
  requireClientSecret: false,
  allowedScopes: ['read', 'write'],
  requireState: false,
  dynamicRegistration: {
    enabled: true,
    allowedGrantTypes: ['authorization_code', 'refresh_token'],
    requiresAuthentication: false,
    clientTtl: 2592000,
  },
});

const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'];

const getDefaultBetterAuthConfig = (): BetterAuthConfig => ({
  enabled: true,
  baseUrl: '',
  basePath: '/api/auth/better',
  trustedOrigins: [],
  disablePasswordLogin: false,
  providers: {
    google: {
      enabled: true,
    },
    github: {
      enabled: true,
    },
    oidc: {
      enabled: false,
      providerId: 'oidc',
      discoveryUrl: '',
      scopes: [...DEFAULT_OIDC_SCOPES],
      pkce: true,
      prompt: '',
    },
  },
});

const normalizeStringArray = (value: unknown, fallback: string[] = []): string[] => {
  const normalized = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];

  return normalized.length > 0 ? normalized : [...fallback];
};

const normalizeBetterAuthConfig = (config?: Partial<BetterAuthConfig>): BetterAuthConfig => {
  const defaults = getDefaultBetterAuthConfig();

  return {
    enabled: config?.enabled ?? defaults.enabled,
    baseUrl: config?.baseUrl?.trim() || defaults.baseUrl,
    basePath: config?.basePath?.trim() || defaults.basePath,
    trustedOrigins: normalizeStringArray(config?.trustedOrigins, defaults.trustedOrigins),
    disablePasswordLogin: config?.disablePasswordLogin ?? defaults.disablePasswordLogin,
    providers: {
      google: {
        enabled: config?.providers?.google?.enabled ?? defaults.providers.google.enabled,
      },
      github: {
        enabled: config?.providers?.github?.enabled ?? defaults.providers.github.enabled,
      },
      oidc: {
        enabled: config?.providers?.oidc?.enabled ?? defaults.providers.oidc.enabled,
        providerId:
          config?.providers?.oidc?.providerId?.trim() || defaults.providers.oidc.providerId,
        discoveryUrl: config?.providers?.oidc?.discoveryUrl?.trim() || '',
        scopes: normalizeStringArray(config?.providers?.oidc?.scopes, DEFAULT_OIDC_SCOPES),
        pkce: config?.providers?.oidc?.pkce ?? defaults.providers.oidc.pkce,
        prompt: config?.providers?.oidc?.prompt?.trim() || '',
      },
    },
  };
};

const mergeBetterAuthConfig = (
  current: BetterAuthConfig,
  updates: Partial<BetterAuthConfig>,
): BetterAuthConfig => {
  const nextConfig: Partial<BetterAuthConfig> = {
    ...current,
    ...updates,
    baseUrl: updates.baseUrl ?? current.baseUrl,
    trustedOrigins: updates.trustedOrigins ?? current.trustedOrigins,
    providers: {
      ...current.providers,
      ...updates.providers,
      google: {
        ...current.providers.google,
        ...updates.providers?.google,
      },
      github: {
        ...current.providers.github,
        ...updates.providers?.github,
      },
      oidc: {
        ...current.providers.oidc,
        ...updates.providers?.oidc,
        scopes: updates.providers?.oidc?.scopes ?? current.providers.oidc.scopes,
      },
    },
  };

  return normalizeBetterAuthConfig(nextConfig);
};

const RuntimeSettingsContext = createContext<RuntimeSettingsContextValue | undefined>(undefined);
const SettingsActionsContext = createContext<SettingsActionsContextValue | undefined>(undefined);

/**
 * Subscribe only to read-only runtime settings. Non-settings views should use
 * this hook so saving a settings section does not trigger unrelated re-renders.
 */
export const useRuntimeSettings = (): RuntimeSettingsContextValue => {
  const context = useContext(RuntimeSettingsContext);
  if (!context) {
    throw new Error('useRuntimeSettings must be used within a SettingsProvider');
  }
  return context;
};

/**
 * Subscribe to settings write operations, per-section saving flags, and Bearer Key helpers.
 */
export const useSettingsActions = (): SettingsActionsContextValue => {
  const context = useContext(SettingsActionsContext);
  if (!context) {
    throw new Error('useSettingsActions must be used within a SettingsProvider');
  }
  return context;
};

/**
 * Backward-compatible combined hook merging runtime settings and write actions.
 */
export const useSettings = (): SettingsContextValue => {
  const runtime = useRuntimeSettings();
  const actions = useSettingsActions();
  return useMemo(() => ({ ...runtime, ...actions }), [runtime, actions]);
};

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { auth } = useAuth();

  const [routingConfig, setRoutingConfig] = useState<RoutingConfig>({
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
    enableBearerAuth: true,
    bearerAuthKey: '',
    bearerAuthHeaderName: 'Authorization',
    allowAuthorizationPassthrough: false,
    jsonBodyLimit: '1mb',
    skipAuth: false,
  });

  const [tempRoutingConfig, setTempRoutingConfig] = useState<TempRoutingConfig>({
    bearerAuthKey: '',
    bearerAuthHeaderName: 'Authorization',
    jsonBodyLimit: '1mb',
  });

  const [installConfig, setInstallConfig] = useState<InstallConfig>({
    pythonIndexUrl: '',
    npmRegistry: '',
    baseUrl: 'http://localhost:3000',
  });

  const [smartRoutingConfig, setSmartRoutingConfig] = useState<SmartRoutingConfig>({
    enabled: false,
    dbUrl: '',
    basePacingDelayMs: undefined,
    embeddingProvider: 'openai',
    embeddingEncodingFormat: 'auto',
    embeddingDimensions: undefined,
    embeddingDimensionsApiPassthrough: false,
    llmProviderBaseUrl: '',
    llmProviderApiKey: '',
    embeddingModel: '',
    azureOpenaiEndpoint: '',
    azureOpenaiApiKey: '',
    azureOpenaiApiVersion: '',
    azureOpenaiEmbeddingDeployment: '',
    azureOpenaiEmbeddingModel: '',
    progressiveDisclosure: false,
    embeddingMaxTokens: undefined,
    embeddingQueryPrefix: '',
    embeddingDocumentPrefix: '',
    similarityThreshold: undefined,
    fullSchemaTopN: undefined,
  });

  const [toolResultCompressionConfig, setToolResultCompressionConfig] =
    useState<ToolResultCompressionConfig>({
      enabled: false,
      minTokens: 2000,
      maxOutputTokens: 1200,
      strategy: 'auto',
    });

  const [fileStagingConfig, setFileStagingConfig] = useState<FileStagingConfig>({
    enabled: false,
    maxFileBytes: 100 * 1024 * 1024,
    inlineMaxBytes: 1024 * 1024,
    perUserQuotaBytes: 1024 * 1024 * 1024,
    globalQuotaBytes: 10 * 1024 * 1024 * 1024,
    ttlHours: 24,
    downloadTtlSeconds: 300,
    uploadTtlSeconds: 900,
    maxFilesPerUser: 100,
    cleanupIntervalMinutes: 15,
  });

  const [mcpRouterConfig, setMCPRouterConfig] = useState<MCPRouterConfig>({
    apiKey: '',
    referer: 'https://www.mcphub.app',
    title: 'MCPHub',
    baseUrl: 'https://api.mcprouter.to/v1',
  });

  const [oauthServerConfig, setOAuthServerConfig] = useState<OAuthServerConfig>(
    getDefaultOAuthServerConfig(),
  );
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [betterAuthConfig, setBetterAuthConfig] = useState<BetterAuthConfig>(
    getDefaultBetterAuthConfig(),
  );

  const [normalizeToolNames, setNormalizeToolNames] = useState(false);
  const [nameSeparator, setNameSeparator] = useState<string>('-');
  const [skillImportProxy, setSkillImportProxy] = useState('server');
  const [enableSessionRebuild, setEnableSessionRebuild] = useState<boolean>(false);
  const [fakeIpExceptions, setFakeIpExceptions] = useState<FakeIpException[]>([]);
  const [allowedCidrs, setAllowedCidrs] = useState<string[]>([]);
  const [toolPolicies, setToolPolicies] = useState<ToolPolicyRule[]>();
  const [storeToolPayload, setStoreToolPayload] = useState<boolean>(true);
  const [bearerKeys, setBearerKeys] = useState<BearerKey[]>([]);

  const [initialLoading, setInitialLoading] = useState(false);
  const [savingSections, setSavingSections] = useState<
    Partial<Record<SettingsSectionKey, boolean>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const setSectionSaving = useCallback((section: SettingsSectionKey, saving: boolean) => {
    setSavingSections((prev) => {
      if (Boolean(prev[section]) === saving) return prev;
      return { ...prev, [section]: saving };
    });
  }, []);

  const isSectionSaving = useCallback(
    (section: SettingsSectionKey) => Boolean(savingSections[section]),
    [savingSections],
  );

  const anySectionSaving = useMemo(
    () => Object.values(savingSections).some(Boolean),
    [savingSections],
  );

  const loading = initialLoading || anySectionSaving;

  const triggerRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const fetchSettings = useCallback(async () => {
    setInitialLoading(true);
    setError(null);

    try {
      const data: ApiResponse<SystemSettings> = await apiGet('/settings');

      if (data.success && data.data?.systemConfig) {
        const rules =
          data.data.systemConfig.toolPolicies === undefined
            ? []
            : data.data.systemConfig.toolPolicies;
        validateToolPolicies(rules);
        setToolPolicies(rules);
      }
      if (data.success && data.data?.systemConfig?.routing) {
        const routing = data.data.systemConfig.routing;
        setRoutingConfig({
          enableGlobalRoute: routing.enableGlobalRoute ?? true,
          enableGroupNameRoute: routing.enableGroupNameRoute ?? true,
          enableBearerAuth: routing.enableBearerAuth ?? true,
          bearerAuthKey: routing.bearerAuthKey || '',
          bearerAuthHeaderName: routing.bearerAuthHeaderName || 'Authorization',
          allowAuthorizationPassthrough: routing.allowAuthorizationPassthrough === true,
          jsonBodyLimit: routing.jsonBodyLimit || '1mb',
          skipAuth: routing.skipAuth ?? false,
        });
      }
      if (data.success && data.data?.systemConfig?.install) {
        const install = data.data.systemConfig.install;
        setInstallConfig({
          pythonIndexUrl: install.pythonIndexUrl || '',
          npmRegistry: install.npmRegistry || '',
          baseUrl: install.baseUrl || 'http://localhost:3000',
        });
      }
      if (data.success && data.data?.systemConfig?.smartRouting) {
        const sr = data.data.systemConfig.smartRouting;
        setSmartRoutingConfig({
          enabled: sr.enabled ?? false,
          dbUrl: sr.dbUrl || '',
          basePacingDelayMs: sr.basePacingDelayMs,
          embeddingProvider: sr.embeddingProvider === 'azure_openai' ? 'azure_openai' : 'openai',
          embeddingEncodingFormat:
            sr.embeddingEncodingFormat === 'base64'
              ? 'base64'
              : sr.embeddingEncodingFormat === 'float'
                ? 'float'
                : 'auto',
          embeddingDimensions: sr.embeddingDimensions,
          embeddingDimensionsApiPassthrough: sr.embeddingDimensionsApiPassthrough ?? false,
          llmProviderBaseUrl: sr.llmProviderBaseUrl || '',
          llmProviderApiKey: sr.llmProviderApiKey || '',
          embeddingModel: sr.embeddingModel || '',
          azureOpenaiEndpoint: sr.azureOpenaiEndpoint || '',
          azureOpenaiApiKey: sr.azureOpenaiApiKey || '',
          azureOpenaiApiVersion: sr.azureOpenaiApiVersion || '',
          azureOpenaiEmbeddingDeployment: sr.azureOpenaiEmbeddingDeployment || '',
          azureOpenaiEmbeddingModel: sr.azureOpenaiEmbeddingModel || '',
          progressiveDisclosure: sr.progressiveDisclosure ?? false,
          embeddingMaxTokens: sr.embeddingMaxTokens,
          embeddingQueryPrefix: sr.embeddingQueryPrefix || '',
          embeddingDocumentPrefix: sr.embeddingDocumentPrefix || '',
          similarityThreshold: sr.similarityThreshold,
          fullSchemaTopN: sr.fullSchemaTopN,
          toolDefinitionFields: sr.toolDefinitionFields,
          envOverriddenFields: sr.envOverriddenFields ?? [],
        });
      }
      if (data.success && data.data?.systemConfig?.toolResultCompression) {
        const compression = data.data.systemConfig.toolResultCompression;
        const strategy = compression.strategy;
        setToolResultCompressionConfig({
          enabled: compression.enabled ?? false,
          minTokens: compression.minTokens || 2000,
          maxOutputTokens: compression.maxOutputTokens || 1200,
          strategy: ['auto', 'json', 'log', 'search', 'diff', 'text'].includes(strategy)
            ? strategy
            : 'auto',
        });
      }
      if (data.success && data.data?.systemConfig?.fileStaging) {
        const fileStaging = data.data.systemConfig.fileStaging;
        setFileStagingConfig({
          enabled: fileStaging.enabled ?? false,
          maxFileBytes: fileStaging.maxFileBytes || 100 * 1024 * 1024,
          inlineMaxBytes: fileStaging.inlineMaxBytes || 1024 * 1024,
          perUserQuotaBytes: fileStaging.perUserQuotaBytes || 1024 * 1024 * 1024,
          globalQuotaBytes: fileStaging.globalQuotaBytes || 10 * 1024 * 1024 * 1024,
          ttlHours: fileStaging.ttlHours || 24,
          downloadTtlSeconds: fileStaging.downloadTtlSeconds || 300,
          uploadTtlSeconds: fileStaging.uploadTtlSeconds || 900,
          maxFilesPerUser: fileStaging.maxFilesPerUser || 100,
          cleanupIntervalMinutes: fileStaging.cleanupIntervalMinutes || 15,
        });
      }
      if (data.success && data.data?.systemConfig?.mcpRouter) {
        const router = data.data.systemConfig.mcpRouter;
        setMCPRouterConfig({
          apiKey: router.apiKey || '',
          referer: router.referer || 'https://www.mcphub.app',
          title: router.title || 'MCPHub',
          baseUrl: router.baseUrl || 'https://api.mcprouter.to/v1',
        });
      }
      if (data.success) {
        if (data.data?.systemConfig?.oauthServer) {
          const oauth = data.data.systemConfig.oauthServer;
          const defaultOauthConfig = getDefaultOAuthServerConfig();
          const defaultDynamic = defaultOauthConfig.dynamicRegistration;
          const allowedScopes = Array.isArray(oauth.allowedScopes)
            ? [...oauth.allowedScopes]
            : [...defaultOauthConfig.allowedScopes];
          const dynamicAllowedGrantTypes = Array.isArray(
            oauth.dynamicRegistration?.allowedGrantTypes,
          )
            ? [...oauth.dynamicRegistration.allowedGrantTypes]
            : [...defaultDynamic.allowedGrantTypes];

          setOAuthServerConfig({
            alwaysShowApprovalScreen: oauth.alwaysShowApprovalScreen ?? true,
            approvalLifetime: oauth.approvalLifetime ?? 1209600,
            enabled: oauth.enabled ?? defaultOauthConfig.enabled,
            accessTokenLifetime:
              oauth.accessTokenLifetime ?? defaultOauthConfig.accessTokenLifetime,
            refreshTokenLifetime:
              oauth.refreshTokenLifetime ?? defaultOauthConfig.refreshTokenLifetime,
            authorizationCodeLifetime:
              oauth.authorizationCodeLifetime ?? defaultOauthConfig.authorizationCodeLifetime,
            requireClientSecret:
              oauth.requireClientSecret ?? defaultOauthConfig.requireClientSecret,
            requireState: oauth.requireState ?? defaultOauthConfig.requireState,
            allowedScopes,
            dynamicRegistration: {
              enabled: oauth.dynamicRegistration?.enabled ?? defaultDynamic.enabled,
              allowedGrantTypes: dynamicAllowedGrantTypes,
              requiresAuthentication:
                oauth.dynamicRegistration?.requiresAuthentication ??
                defaultDynamic.requiresAuthentication,
              clientTtl: oauth.dynamicRegistration?.clientTtl ?? defaultDynamic.clientTtl,
            },
          });
        } else {
          setOAuthServerConfig(getDefaultOAuthServerConfig());
        }

        setAllowRegistration(data.data?.systemConfig?.auth?.allowRegistration === true);
        setBetterAuthConfig(normalizeBetterAuthConfig(data.data?.systemConfig?.auth?.betterAuth));
        setFakeIpExceptions(data.data?.systemConfig?.network?.fakeIpExceptions ?? []);
        setAllowedCidrs(data.data?.systemConfig?.network?.allowedCidrs ?? []);
        setNormalizeToolNames(data.data?.systemConfig?.normalizeToolNames === true);
        setSkillImportProxy(data.data?.systemConfig?.install?.skillImportProxy ?? 'server');
      }
      if (data.success && data.data?.systemConfig?.nameSeparator !== undefined) {
        setNameSeparator(data.data.systemConfig.nameSeparator);
      }
      if (data.success && data.data?.systemConfig?.enableSessionRebuild !== undefined) {
        setEnableSessionRebuild(data.data.systemConfig.enableSessionRebuild);
      }
      if (data.success && data.data?.systemConfig?.activityLog?.storeToolPayload !== undefined) {
        setStoreToolPayload(data.data.systemConfig.activityLog.storeToolPayload);
      }
      if (data.success && Array.isArray(data.data?.bearerKeys)) {
        setBearerKeys(data.data.bearerKeys);
      }
    } catch (err) {
      console.error('Failed to fetch settings', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to fetch settings');
      showToast(t('errors.failedToFetchSettings'), 'error');
    } finally {
      setInitialLoading(false);
    }
  }, [t, showToast]);

  const runSystemConfigUpdate = useCallback(
    async <TData = unknown>(
      section: SettingsSectionKey,
      payload: Record<string, unknown>,
      onSuccess: (responseData: TData) => void,
      fallbackErrorKey: string,
      fallbackMessage: string,
    ): Promise<boolean> => {
      setSectionSaving(section, true);
      setError(null);
      try {
        const data = await apiPut<ApiResponse<TData>>('/system-config', payload);
        if (data.success) {
          onSuccess(data.data as TData);
          showToast(t('settings.systemConfigUpdated'), 'success');
          return true;
        }
        const message = data.message || data.error || t(fallbackErrorKey) || fallbackMessage;
        setError(message);
        showToast(message, 'error');
        return false;
      } catch (err) {
        console.error(`Failed to update ${section} config`, { payload, error: err });
        const message = err instanceof Error ? err.message : fallbackMessage;
        setError(message);
        showToast(t(fallbackErrorKey) || message, 'error');
        return false;
      } finally {
        setSectionSaving(section, false);
      }
    },
    [setSectionSaving, showToast, t],
  );

  const updateRoutingConfig = useCallback(
    async (key: keyof RoutingConfig, value: unknown) =>
      runSystemConfigUpdate(
        'routing',
        { routing: { [key]: value } },
        () => setRoutingConfig((prev) => ({ ...prev, [key]: value })),
        'errors.failedToUpdateRoutingConfig',
        'Failed to update routing config',
      ),
    [runSystemConfigUpdate],
  );

  const updateRoutingConfigBatch = useCallback(
    async (updates: Partial<RoutingConfig>) =>
      runSystemConfigUpdate(
        'routing',
        { routing: updates },
        () => setRoutingConfig((prev) => ({ ...prev, ...updates })),
        'errors.failedToUpdateRoutingConfig',
        'Failed to update routing config',
      ),
    [runSystemConfigUpdate],
  );

  const updateInstallConfig = useCallback(
    async (key: keyof InstallConfig, value: unknown) =>
      runSystemConfigUpdate(
        'install',
        { install: { [key]: value } },
        () => setInstallConfig((prev) => ({ ...prev, [key]: value })),
        'errors.failedToUpdateInstallConfig',
        'Failed to update install config',
      ),
    [runSystemConfigUpdate],
  );

  const updateInstallConfigBatch = useCallback(
    async (updates: Partial<InstallConfig & { skillImportProxy?: string }>) =>
      runSystemConfigUpdate(
        'install',
        { install: updates },
        () => {
          const { skillImportProxy: nextProxy, ...installFields } = updates;
          if (Object.keys(installFields).length > 0) {
            setInstallConfig((prev) => ({ ...prev, ...installFields }));
          }
          if (nextProxy !== undefined) {
            setSkillImportProxy(nextProxy);
          }
        },
        'errors.failedToUpdateInstallConfig',
        'Failed to update install config',
      ),
    [runSystemConfigUpdate],
  );

  const updateSkillImportProxy = useCallback(
    async (value: string): Promise<boolean> =>
      runSystemConfigUpdate(
        'skillImportProxy',
        { install: { skillImportProxy: value } },
        () => setSkillImportProxy(value),
        'skills.proxySaveFailed',
        'Failed to update skill import proxy',
      ),
    [runSystemConfigUpdate],
  );

  const updateSmartRoutingConfig = useCallback(
    async (key: keyof SmartRoutingConfig, value: unknown) =>
      runSystemConfigUpdate(
        'smartRouting',
        { smartRouting: { [key]: value } },
        () => setSmartRoutingConfig((prev) => ({ ...prev, [key]: value })),
        'errors.failedToUpdateSmartRoutingConfig',
        'Failed to update smart routing config',
      ),
    [runSystemConfigUpdate],
  );

  const updateSmartRoutingConfigBatch = useCallback(
    async (updates: Partial<SmartRoutingConfig>) =>
      runSystemConfigUpdate(
        'smartRouting',
        { smartRouting: updates },
        () => setSmartRoutingConfig((prev) => ({ ...prev, ...updates })),
        'errors.failedToUpdateSmartRoutingConfig',
        'Failed to update smart routing config',
      ),
    [runSystemConfigUpdate],
  );

  const updateToolResultCompressionConfig = useCallback(
    async (key: keyof ToolResultCompressionConfig, value: unknown) =>
      runSystemConfigUpdate(
        'toolResultCompression',
        { toolResultCompression: { [key]: value } },
        () => setToolResultCompressionConfig((prev) => ({ ...prev, [key]: value })),
        'errors.failedToUpdateSettings',
        'Failed to update tool result compression config',
      ),
    [runSystemConfigUpdate],
  );

  const updateToolResultCompressionConfigBatch = useCallback(
    async (updates: Partial<ToolResultCompressionConfig>) =>
      runSystemConfigUpdate(
        'toolResultCompression',
        { toolResultCompression: updates },
        () => setToolResultCompressionConfig((prev) => ({ ...prev, ...updates })),
        'errors.failedToUpdateSettings',
        'Failed to update tool result compression config',
      ),
    [runSystemConfigUpdate],
  );

  const updateFileStagingConfigBatch = useCallback(
    async (updates: Partial<FileStagingConfig>) =>
      runSystemConfigUpdate(
        'fileStaging',
        { fileStaging: updates },
        () => setFileStagingConfig((prev) => ({ ...prev, ...updates })),
        'errors.failedToUpdateSettings',
        'Failed to update file staging config',
      ),
    [runSystemConfigUpdate],
  );

  const updateMCPRouterConfig = useCallback(
    async (key: keyof MCPRouterConfig, value: unknown) =>
      runSystemConfigUpdate(
        'mcpRouter',
        { mcpRouter: { [key]: value } },
        () => setMCPRouterConfig((prev) => ({ ...prev, [key]: value })),
        'errors.failedToUpdateMCPRouterConfig',
        'Failed to update MCP Router config',
      ),
    [runSystemConfigUpdate],
  );

  const updateMCPRouterConfigBatch = useCallback(
    async (updates: Partial<MCPRouterConfig>) =>
      runSystemConfigUpdate(
        'mcpRouter',
        { mcpRouter: updates },
        () => setMCPRouterConfig((prev) => ({ ...prev, ...updates })),
        'errors.failedToUpdateMCPRouterConfig',
        'Failed to update MCP Router config',
      ),
    [runSystemConfigUpdate],
  );

  const updateOAuthServerConfig = useCallback(
    async (key: keyof OAuthServerConfig, value: unknown) =>
      runSystemConfigUpdate(
        'oauthServer',
        { oauthServer: { [key]: value } },
        () => setOAuthServerConfig((prev) => ({ ...prev, [key]: value })),
        'errors.failedToUpdateOAuthServerConfig',
        'Failed to update OAuth server config',
      ),
    [runSystemConfigUpdate],
  );

  const updateOAuthServerConfigBatch = useCallback(
    async (updates: Partial<OAuthServerConfig>) =>
      runSystemConfigUpdate(
        'oauthServer',
        { oauthServer: updates },
        () =>
          setOAuthServerConfig((prev) => ({
            ...prev,
            ...updates,
            dynamicRegistration: updates.dynamicRegistration
              ? { ...prev.dynamicRegistration, ...updates.dynamicRegistration }
              : prev.dynamicRegistration,
          })),
        'errors.failedToUpdateOAuthServerConfig',
        'Failed to update OAuth server config',
      ),
    [runSystemConfigUpdate],
  );

  const updateAllowRegistration = useCallback(
    async (value: boolean) => {
      await runSystemConfigUpdate(
        'allowRegistration',
        { auth: { allowRegistration: value } },
        () => setAllowRegistration(value),
        'errors.failedToUpdateSettings',
        'Failed to update registration setting',
      );
    },
    [runSystemConfigUpdate],
  );

  const updateBetterAuthConfigBatch = useCallback(
    async (updates: Partial<BetterAuthConfig>) =>
      runSystemConfigUpdate(
        'betterAuth',
        { auth: { betterAuth: updates } },
        () => setBetterAuthConfig((current) => mergeBetterAuthConfig(current, updates)),
        'errors.failedToUpdateBetterAuthConfig',
        'Failed to update Better Auth config',
      ),
    [runSystemConfigUpdate],
  );

  const updateNameSeparator = useCallback(
    async (value: string) =>
      runSystemConfigUpdate(
        'nameSeparator',
        { nameSeparator: value },
        () => setNameSeparator(value),
        'errors.failedToUpdateNameSeparator',
        'Failed to update name separator',
      ),
    [runSystemConfigUpdate],
  );

  const updateNormalizeToolNames = useCallback(
    async (value: boolean) =>
      runSystemConfigUpdate(
        'normalizeToolNames',
        { normalizeToolNames: value },
        () => setNormalizeToolNames(value),
        'settings.toolNameCompatibilityUpdateFailed',
        'Failed to update tool name compatibility setting',
      ),
    [runSystemConfigUpdate],
  );

  const updateSessionRebuild = useCallback(
    async (value: boolean) =>
      runSystemConfigUpdate(
        'sessionRebuild',
        { enableSessionRebuild: value },
        () => setEnableSessionRebuild(value),
        'errors.failedToUpdateSessionRebuild',
        'Failed to update session rebuild setting',
      ),
    [runSystemConfigUpdate],
  );

  const updateToolPolicies = useCallback(
    async (rules: ToolPolicyRule[]): Promise<boolean> =>
      runSystemConfigUpdate(
        'toolPolicies',
        { toolPolicies: rules },
        () => setToolPolicies(rules),
        'settings.toolPolicies.saveFailed',
        'Failed to save tool policies',
      ),
    [runSystemConfigUpdate],
  );

  const updateFakeIpExceptions = useCallback(
    async (value: FakeIpException[]): Promise<boolean> =>
      runSystemConfigUpdate<{ network?: { fakeIpExceptions?: FakeIpException[] } }>(
        'fakeIpExceptions',
        { network: { fakeIpExceptions: value } },
        (responseData) => setFakeIpExceptions(responseData?.network?.fakeIpExceptions ?? value),
        'settings.fakeIp.saveFailed',
        'Failed to update fake IP exceptions',
      ),
    [runSystemConfigUpdate],
  );

  const updateAllowedCidrs = useCallback(
    async (value: string[]): Promise<boolean> =>
      runSystemConfigUpdate<{ network?: { allowedCidrs?: string[] } }>(
        'allowedCidrs',
        { network: { allowedCidrs: value } },
        (responseData) => setAllowedCidrs(responseData?.network?.allowedCidrs ?? value),
        'settings.allowedCidrsUpdateFailed',
        'Failed to update allowed CIDRs',
      ),
    [runSystemConfigUpdate],
  );

  const updateStoreToolPayload = useCallback(
    async (value: boolean) =>
      runSystemConfigUpdate(
        'storeToolPayload',
        { activityLog: { storeToolPayload: value } },
        () => setStoreToolPayload(value),
        'settings.storeToolPayloadUpdateFailed',
        'Failed to update activity log setting',
      ),
    [runSystemConfigUpdate],
  );

  const exportMCPSettings = useCallback(
    async (serverName?: string) => {
      setSectionSaving('exportConfig', true);
      setError(null);
      try {
        return await apiGet(`/mcp-settings/export?serverName=${serverName ? serverName : ''}`);
      } catch (err) {
        console.error('Failed to export MCP settings', { serverName, error: err });
        const errorMessage = err instanceof Error ? err.message : 'Failed to export MCP settings';
        setError(errorMessage);
        showToast(errorMessage, 'error');
        return undefined;
      } finally {
        setSectionSaving('exportConfig', false);
      }
    },
    [setSectionSaving, showToast],
  );

  const refreshBearerKeys = useCallback(async () => {
    try {
      const data: ApiResponse<BearerKey[]> = await apiGet('/auth/keys');
      if (data.success && Array.isArray(data.data)) {
        setBearerKeys(data.data);
      }
    } catch (err) {
      console.error('Failed to refresh bearer keys', { error: err });
      showToast(t('errors.failedToFetchSettings'), 'error');
    }
  }, [showToast, t]);

  const createBearerKey = useCallback(
    async (
      payload: Pick<BearerKey, 'name'> & Partial<Omit<BearerKey, 'id' | 'name' | 'token'>>,
    ): Promise<BearerKey | null> => {
      setSectionSaving('bearerKeys', true);
      try {
        const data: ApiResponse<BearerKey> = await apiPost('/auth/keys', payload);
        if (data.success && data.data) {
          await refreshBearerKeys();
          showToast(t('settings.systemConfigUpdated'), 'success');
          return data.data;
        }
        showToast(data.message || t('errors.failedToUpdateRoutingConfig'), 'error');
        return null;
      } catch (err) {
        console.error('Failed to create bearer key', { error: err });
        showToast(t('errors.failedToUpdateRoutingConfig'), 'error');
        return null;
      } finally {
        setSectionSaving('bearerKeys', false);
      }
    },
    [refreshBearerKeys, setSectionSaving, showToast, t],
  );

  const updateBearerKey = useCallback(
    async (
      id: string,
      updates: Partial<Omit<BearerKey, 'id'>>,
    ): Promise<BearerKey | null> => {
      setSectionSaving('bearerKeys', true);
      try {
        const data: ApiResponse<BearerKey> = await apiPut(`/auth/keys/${id}`, updates);
        if (data.success && data.data) {
          await refreshBearerKeys();
          showToast(t('settings.systemConfigUpdated'), 'success');
          return data.data;
        }
        showToast(data.message || t('errors.failedToUpdateRoutingConfig'), 'error');
        return null;
      } catch (err) {
        console.error('Failed to update bearer key', { id, error: err });
        showToast(t('errors.failedToUpdateRoutingConfig'), 'error');
        return null;
      } finally {
        setSectionSaving('bearerKeys', false);
      }
    },
    [refreshBearerKeys, setSectionSaving, showToast, t],
  );

  const deleteBearerKey = useCallback(
    async (id: string): Promise<boolean> => {
      setSectionSaving('bearerKeys', true);
      try {
        const data: ApiResponse = await apiDelete(`/auth/keys/${id}`);
        if (data.success) {
          await refreshBearerKeys();
          showToast(t('settings.systemConfigUpdated'), 'success');
          return true;
        }
        showToast(data.message || t('errors.failedToUpdateRoutingConfig'), 'error');
        return false;
      } catch (err) {
        console.error('Failed to delete bearer key', { id, error: err });
        showToast(t('errors.failedToUpdateRoutingConfig'), 'error');
        return false;
      } finally {
        setSectionSaving('bearerKeys', false);
      }
    },
    [refreshBearerKeys, setSectionSaving, showToast, t],
  );

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings, refreshKey]);

  useEffect(() => {
    if (auth.isAuthenticated) {
      triggerRefresh();
    }
  }, [auth.isAuthenticated, triggerRefresh]);

  useEffect(() => {
    setTempRoutingConfig({
      bearerAuthKey: routingConfig.bearerAuthKey,
      bearerAuthHeaderName: routingConfig.bearerAuthHeaderName,
      jsonBodyLimit: routingConfig.jsonBodyLimit,
    });
  }, [routingConfig]);

  const runtimeValue = useMemo<RuntimeSettingsContextValue>(
    () => ({
      toolPolicies,
      routingConfig,
      installConfig,
      smartRoutingConfig,
      toolResultCompressionConfig,
      fileStagingConfig,
      mcpRouterConfig,
      oauthServerConfig,
      allowRegistration,
      betterAuthConfig,
      normalizeToolNames,
      nameSeparator,
      skillImportProxy,
      enableSessionRebuild,
      fakeIpExceptions,
      allowedCidrs,
      storeToolPayload,
      initialLoading,
      error,
    }),
    [
      toolPolicies,
      routingConfig,
      installConfig,
      smartRoutingConfig,
      toolResultCompressionConfig,
      fileStagingConfig,
      mcpRouterConfig,
      oauthServerConfig,
      allowRegistration,
      betterAuthConfig,
      normalizeToolNames,
      nameSeparator,
      skillImportProxy,
      enableSessionRebuild,
      fakeIpExceptions,
      allowedCidrs,
      storeToolPayload,
      initialLoading,
      error,
    ],
  );

  const actionsValue = useMemo<SettingsActionsContextValue>(
    () => ({
      bearerKeys,
      tempRoutingConfig,
      setTempRoutingConfig,
      savingSections,
      isSectionSaving,
      loading,
      setError,
      triggerRefresh,
      fetchSettings,
      updateToolPolicies,
      updateRoutingConfig,
      updateRoutingConfigBatch,
      updateInstallConfig,
      updateInstallConfigBatch,
      updateSkillImportProxy,
      updateSmartRoutingConfig,
      updateSmartRoutingConfigBatch,
      updateToolResultCompressionConfig,
      updateToolResultCompressionConfigBatch,
      updateFileStagingConfigBatch,
      updateMCPRouterConfig,
      updateMCPRouterConfigBatch,
      updateOAuthServerConfig,
      updateOAuthServerConfigBatch,
      updateAllowRegistration,
      updateBetterAuthConfigBatch,
      updateNameSeparator,
      updateNormalizeToolNames,
      updateSessionRebuild,
      updateFakeIpExceptions,
      updateAllowedCidrs,
      updateStoreToolPayload,
      exportMCPSettings,
      refreshBearerKeys,
      createBearerKey,
      updateBearerKey,
      deleteBearerKey,
    }),
    [
      bearerKeys,
      tempRoutingConfig,
      savingSections,
      isSectionSaving,
      loading,
      triggerRefresh,
      fetchSettings,
      updateToolPolicies,
      updateRoutingConfig,
      updateRoutingConfigBatch,
      updateInstallConfig,
      updateInstallConfigBatch,
      updateSkillImportProxy,
      updateSmartRoutingConfig,
      updateSmartRoutingConfigBatch,
      updateToolResultCompressionConfig,
      updateToolResultCompressionConfigBatch,
      updateFileStagingConfigBatch,
      updateMCPRouterConfig,
      updateMCPRouterConfigBatch,
      updateOAuthServerConfig,
      updateOAuthServerConfigBatch,
      updateAllowRegistration,
      updateBetterAuthConfigBatch,
      updateNameSeparator,
      updateNormalizeToolNames,
      updateSessionRebuild,
      updateFakeIpExceptions,
      updateAllowedCidrs,
      updateStoreToolPayload,
      exportMCPSettings,
      refreshBearerKeys,
      createBearerKey,
      updateBearerKey,
      deleteBearerKey,
    ],
  );

  return (
    <RuntimeSettingsContext.Provider value={runtimeValue}>
      <SettingsActionsContext.Provider value={actionsValue}>
        {children}
      </SettingsActionsContext.Provider>
    </RuntimeSettingsContext.Provider>
  );
};
