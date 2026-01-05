import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ApiResponse, BearerKey } from '@/types';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet, apiPut, apiPost, apiDelete } from '@/utils/fetchInterceptor';

// Define types for the settings data
interface RoutingConfig {
  enableGlobalRoute: boolean;
  enableGroupNameRoute: boolean;
  enableBearerAuth: boolean;
  bearerAuthKey: string;
  skipAuth: boolean;
}

interface InstallConfig {
  pythonIndexUrl: string;
  npmRegistry: string;
  baseUrl: string;
}

interface SmartRoutingConfig {
  enabled: boolean;
  dbUrl: string;
  openaiApiBaseUrl: string;
  openaiApiKey: string;
  openaiApiEmbeddingModel: string;
  progressiveDisclosure: boolean;
}

interface MCPRouterConfig {
  apiKey: string;
  referer: string;
  title: string;
  baseUrl: string;
}

interface OAuthServerConfig {
  enabled: boolean;
  accessTokenLifetime: number;
  refreshTokenLifetime: number;
  authorizationCodeLifetime: number;
  requireClientSecret: boolean;
  allowedScopes: string[];
  requireState: boolean;
  dynamicRegistration: {
    enabled: boolean;
    allowedGrantTypes: string[];
    requiresAuthentication: boolean;
  };
}

interface SystemSettings {
  systemConfig?: {
    routing?: RoutingConfig;
    install?: InstallConfig;
    smartRouting?: SmartRoutingConfig;
    mcpRouter?: MCPRouterConfig;
    nameSeparator?: string;
    oauthServer?: OAuthServerConfig;
    enableSessionRebuild?: boolean;
  };
  bearerKeys?: BearerKey[];
}

interface TempRoutingConfig {
  bearerAuthKey: string;
}

interface SettingsContextValue {
  routingConfig: RoutingConfig;
  tempRoutingConfig: TempRoutingConfig;
  setTempRoutingConfig: React.Dispatch<React.SetStateAction<TempRoutingConfig>>;
  installConfig: InstallConfig;
  smartRoutingConfig: SmartRoutingConfig;
  mcpRouterConfig: MCPRouterConfig;
  oauthServerConfig: OAuthServerConfig;
  nameSeparator: string;
  enableSessionRebuild: boolean;
  bearerKeys: BearerKey[];
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  triggerRefresh: () => void;
  fetchSettings: () => Promise<void>;
  updateRoutingConfig: (key: keyof RoutingConfig, value: any) => Promise<boolean | undefined>;
  updateInstallConfig: (key: keyof InstallConfig, value: any) => Promise<boolean | undefined>;
  updateSmartRoutingConfig: (
    key: keyof SmartRoutingConfig,
    value: any,
  ) => Promise<boolean | undefined>;
  updateSmartRoutingConfigBatch: (
    updates: Partial<SmartRoutingConfig>,
  ) => Promise<boolean | undefined>;
  updateRoutingConfigBatch: (updates: Partial<RoutingConfig>) => Promise<boolean | undefined>;
  updateMCPRouterConfig: (key: keyof MCPRouterConfig, value: any) => Promise<boolean | undefined>;
  updateMCPRouterConfigBatch: (updates: Partial<MCPRouterConfig>) => Promise<boolean | undefined>;
  updateOAuthServerConfig: (
    key: keyof OAuthServerConfig,
    value: any,
  ) => Promise<boolean | undefined>;
  updateOAuthServerConfigBatch: (
    updates: Partial<OAuthServerConfig>,
  ) => Promise<boolean | undefined>;
  updateNameSeparator: (value: string) => Promise<boolean | undefined>;
  updateSessionRebuild: (value: boolean) => Promise<boolean | undefined>;
  exportMCPSettings: (serverName?: string) => Promise<any>;
  // Bearer key management
  refreshBearerKeys: () => Promise<void>;
  createBearerKey: (payload: Omit<BearerKey, 'id'>) => Promise<BearerKey | null>;
  updateBearerKey: (
    id: string,
    updates: Partial<Omit<BearerKey, 'id'>>,
  ) => Promise<BearerKey | null>;
  deleteBearerKey: (id: string) => Promise<boolean>;
}

const getDefaultOAuthServerConfig = (): OAuthServerConfig => ({
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
  },
});

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
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
    enableBearerAuth: false,
    bearerAuthKey: '',
    skipAuth: false,
  });

  const [tempRoutingConfig, setTempRoutingConfig] = useState<TempRoutingConfig>({
    bearerAuthKey: '',
  });

  const [installConfig, setInstallConfig] = useState<InstallConfig>({
    pythonIndexUrl: '',
    npmRegistry: '',
    baseUrl: 'http://localhost:3000',
  });

  const [smartRoutingConfig, setSmartRoutingConfig] = useState<SmartRoutingConfig>({
    enabled: false,
    dbUrl: '',
    openaiApiBaseUrl: '',
    openaiApiKey: '',
    openaiApiEmbeddingModel: '',
    progressiveDisclosure: false,
  });

  const [mcpRouterConfig, setMCPRouterConfig] = useState<MCPRouterConfig>({
    apiKey: '',
    referer: 'https://www.mcphubx.com',
    title: 'MCPHub',
    baseUrl: 'https://api.mcprouter.to/v1',
  });

  const [oauthServerConfig, setOAuthServerConfig] = useState<OAuthServerConfig>(
    getDefaultOAuthServerConfig(),
  );

  const [nameSeparator, setNameSeparator] = useState<string>('-');
  const [enableSessionRebuild, setEnableSessionRebuild] = useState<boolean>(false);
  const [bearerKeys, setBearerKeys] = useState<BearerKey[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Trigger a refresh of the settings data
  const triggerRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  // Fetch current settings
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data: ApiResponse<SystemSettings> = await apiGet('/settings');

      if (data.success && data.data?.systemConfig?.routing) {
        setRoutingConfig({
          enableGlobalRoute: data.data.systemConfig.routing.enableGlobalRoute ?? true,
          enableGroupNameRoute: data.data.systemConfig.routing.enableGroupNameRoute ?? true,
          enableBearerAuth: data.data.systemConfig.routing.enableBearerAuth ?? false,
          bearerAuthKey: data.data.systemConfig.routing.bearerAuthKey || '',
          skipAuth: data.data.systemConfig.routing.skipAuth ?? false,
        });
      }
      if (data.success && data.data?.systemConfig?.install) {
        setInstallConfig({
          pythonIndexUrl: data.data.systemConfig.install.pythonIndexUrl || '',
          npmRegistry: data.data.systemConfig.install.npmRegistry || '',
          baseUrl: data.data.systemConfig.install.baseUrl || 'http://localhost:3000',
        });
      }
      if (data.success && data.data?.systemConfig?.smartRouting) {
        setSmartRoutingConfig({
          enabled: data.data.systemConfig.smartRouting.enabled ?? false,
          dbUrl: data.data.systemConfig.smartRouting.dbUrl || '',
          openaiApiBaseUrl: data.data.systemConfig.smartRouting.openaiApiBaseUrl || '',
          openaiApiKey: data.data.systemConfig.smartRouting.openaiApiKey || '',
          openaiApiEmbeddingModel:
            data.data.systemConfig.smartRouting.openaiApiEmbeddingModel || '',
          progressiveDisclosure: data.data.systemConfig.smartRouting.progressiveDisclosure ?? false,
        });
      }
      if (data.success && data.data?.systemConfig?.mcpRouter) {
        setMCPRouterConfig({
          apiKey: data.data.systemConfig.mcpRouter.apiKey || '',
          referer: data.data.systemConfig.mcpRouter.referer || 'https://www.mcphubx.com',
          title: data.data.systemConfig.mcpRouter.title || 'MCPHub',
          baseUrl: data.data.systemConfig.mcpRouter.baseUrl || 'https://api.mcprouter.to/v1',
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
            ? [...oauth.dynamicRegistration!.allowedGrantTypes!]
            : [...defaultDynamic.allowedGrantTypes];

          setOAuthServerConfig({
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
            },
          });
        } else {
          setOAuthServerConfig(getDefaultOAuthServerConfig());
        }
      }
      if (data.success && data.data?.systemConfig?.nameSeparator !== undefined) {
        setNameSeparator(data.data.systemConfig.nameSeparator);
      }
      if (data.success && data.data?.systemConfig?.enableSessionRebuild !== undefined) {
        setEnableSessionRebuild(data.data.systemConfig.enableSessionRebuild);
      }

      if (data.success && Array.isArray(data.data?.bearerKeys)) {
        setBearerKeys(data.data.bearerKeys);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch settings');
      showToast(t('errors.failedToFetchSettings'));
    } finally {
      setLoading(false);
    }
  }, [t, showToast]);

  // Update routing configuration
  const updateRoutingConfig = async (key: keyof RoutingConfig, value: any) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        routing: {
          [key]: value,
        },
      });

      if (data.success) {
        setRoutingConfig({
          ...routingConfig,
          [key]: value,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update routing config');
        showToast(data.error || t('errors.failedToUpdateRoutingConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update routing config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update routing config');
      showToast(t('errors.failedToUpdateRoutingConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update install configuration
  const updateInstallConfig = async (key: keyof InstallConfig, value: any) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        install: {
          [key]: value,
        },
      });

      if (data.success) {
        setInstallConfig({
          ...installConfig,
          [key]: value,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update install config');
        showToast(data.error || t('errors.failedToUpdateInstallConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update install config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update install config');
      showToast(t('errors.failedToUpdateInstallConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update smart routing configuration
  const updateSmartRoutingConfig = async (key: keyof SmartRoutingConfig, value: any) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        smartRouting: {
          [key]: value,
        },
      });

      if (data.success) {
        setSmartRoutingConfig({
          ...smartRoutingConfig,
          [key]: value,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update smart routing config');
        showToast(data.error || t('errors.failedToUpdateSmartRoutingConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update smart routing config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update smart routing config');
      showToast(t('errors.failedToUpdateSmartRoutingConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Batch update smart routing configuration
  const updateSmartRoutingConfigBatch = async (updates: Partial<SmartRoutingConfig>) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        smartRouting: updates,
      });

      if (data.success) {
        setSmartRoutingConfig({
          ...smartRoutingConfig,
          ...updates,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update smart routing config');
        showToast(data.error || t('errors.failedToUpdateSmartRoutingConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update smart routing config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update smart routing config');
      showToast(t('errors.failedToUpdateSmartRoutingConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Batch update routing configuration
  const updateRoutingConfigBatch = async (updates: Partial<RoutingConfig>) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        routing: updates,
      });

      if (data.success) {
        setRoutingConfig({
          ...routingConfig,
          ...updates,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update routing config');
        showToast(data.error || t('errors.failedToUpdateRoutingConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update routing config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update routing config');
      showToast(t('errors.failedToUpdateRoutingConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update MCP Router configuration
  const updateMCPRouterConfig = async (key: keyof MCPRouterConfig, value: any) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        mcpRouter: {
          [key]: value,
        },
      });

      if (data.success) {
        setMCPRouterConfig({
          ...mcpRouterConfig,
          [key]: value,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update MCP Router config');
        showToast(data.error || t('errors.failedToUpdateMCPRouterConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update MCP Router config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update MCP Router config');
      showToast(t('errors.failedToUpdateMCPRouterConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Batch update MCP Router configuration
  const updateMCPRouterConfigBatch = async (updates: Partial<MCPRouterConfig>) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        mcpRouter: updates,
      });

      if (data.success) {
        setMCPRouterConfig({
          ...mcpRouterConfig,
          ...updates,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update MCP Router config');
        showToast(data.error || t('errors.failedToUpdateMCPRouterConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update MCP Router config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update MCP Router config');
      showToast(t('errors.failedToUpdateMCPRouterConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update OAuth server configuration
  const updateOAuthServerConfig = async (key: keyof OAuthServerConfig, value: any) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        oauthServer: {
          [key]: value,
        },
      });

      if (data.success) {
        setOAuthServerConfig({
          ...oauthServerConfig,
          [key]: value,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update OAuth server config');
        showToast(data.error || t('errors.failedToUpdateOAuthServerConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update OAuth server config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update OAuth server config');
      showToast(t('errors.failedToUpdateOAuthServerConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Batch update OAuth server configuration
  const updateOAuthServerConfigBatch = async (updates: Partial<OAuthServerConfig>) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        oauthServer: updates,
      });

      if (data.success) {
        setOAuthServerConfig({
          ...oauthServerConfig,
          ...updates,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update OAuth server config');
        showToast(data.error || t('errors.failedToUpdateOAuthServerConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update OAuth server config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update OAuth server config');
      showToast(t('errors.failedToUpdateOAuthServerConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update name separator
  const updateNameSeparator = async (value: string) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        nameSeparator: value,
      });

      if (data.success) {
        setNameSeparator(value);
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update name separator');
        showToast(data.error || t('errors.failedToUpdateNameSeparator'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update name separator:', error);
      setError(error instanceof Error ? error.message : 'Failed to update name separator');
      showToast(t('errors.failedToUpdateNameSeparator'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update session rebuild flag
  const updateSessionRebuild = async (value: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiPut('/system-config', {
        enableSessionRebuild: value,
      });

      if (data.success) {
        setEnableSessionRebuild(value);
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        setError(data.error || 'Failed to update session rebuild setting');
        showToast(data.error || t('errors.failedToUpdateSessionRebuild'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update session rebuild setting:', error);
      setError(error instanceof Error ? error.message : 'Failed to update session rebuild setting');
      showToast(t('errors.failedToUpdateSessionRebuild'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const exportMCPSettings = async (serverName?: string) => {
    setLoading(true);
    setError(null);
    try {
      return await apiGet(`/mcp-settings/export?serverName=${serverName ? serverName : ''}`);
    } catch (error) {
      console.error('Failed to export MCP settings:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to export MCP settings';
      setError(errorMessage);
      showToast(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Bearer key management helpers
  const refreshBearerKeys = async () => {
    try {
      const data: ApiResponse<BearerKey[]> = await apiGet('/auth/keys');
      if (data.success && Array.isArray(data.data)) {
        setBearerKeys(data.data);
      }
    } catch (error) {
      console.error('Failed to refresh bearer keys:', error);
      showToast(t('errors.failedToFetchSettings'));
    }
  };

  const createBearerKey = async (payload: Omit<BearerKey, 'id'>): Promise<BearerKey | null> => {
    try {
      const data: ApiResponse<BearerKey> = await apiPost('/auth/keys', payload as any);
      if (data.success && data.data) {
        await refreshBearerKeys();
        showToast(t('settings.systemConfigUpdated'));
        return data.data;
      }
      showToast(data.message || t('errors.failedToUpdateRoutingConfig'));
      return null;
    } catch (error) {
      console.error('Failed to create bearer key:', error);
      showToast(t('errors.failedToUpdateRoutingConfig'));
      return null;
    }
  };

  const updateBearerKey = async (
    id: string,
    updates: Partial<Omit<BearerKey, 'id'>>,
  ): Promise<BearerKey | null> => {
    try {
      const data: ApiResponse<BearerKey> = await apiPut(`/auth/keys/${id}`, updates as any);
      if (data.success && data.data) {
        await refreshBearerKeys();
        showToast(t('settings.systemConfigUpdated'));
        return data.data;
      }
      showToast(data.message || t('errors.failedToUpdateRoutingConfig'));
      return null;
    } catch (error) {
      console.error('Failed to update bearer key:', error);
      showToast(t('errors.failedToUpdateRoutingConfig'));
      return null;
    }
  };

  const deleteBearerKey = async (id: string): Promise<boolean> => {
    try {
      const data: ApiResponse = await apiDelete(`/auth/keys/${id}`);
      if (data.success) {
        await refreshBearerKeys();
        showToast(t('settings.systemConfigUpdated'));
        return true;
      }
      showToast(data.message || t('errors.failedToUpdateRoutingConfig'));
      return false;
    } catch (error) {
      console.error('Failed to delete bearer key:', error);
      showToast(t('errors.failedToUpdateRoutingConfig'));
      return false;
    }
  };

  // Fetch settings when the component mounts or refreshKey changes
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings, refreshKey]);

  // Watch for authentication status changes - refetch settings after login
  useEffect(() => {
    if (auth.isAuthenticated) {
      console.log('[SettingsContext] User authenticated, triggering settings refresh');
      // When user logs in, trigger a refresh to load settings
      triggerRefresh();
    }
  }, [auth.isAuthenticated, triggerRefresh]);

  useEffect(() => {
    if (routingConfig) {
      setTempRoutingConfig({
        bearerAuthKey: routingConfig.bearerAuthKey,
      });
    }
  }, [routingConfig]);

  const value: SettingsContextValue = {
    routingConfig,
    tempRoutingConfig,
    setTempRoutingConfig,
    installConfig,
    smartRoutingConfig,
    mcpRouterConfig,
    oauthServerConfig,
    nameSeparator,
    enableSessionRebuild,
    bearerKeys,
    loading,
    error,
    setError,
    triggerRefresh,
    fetchSettings,
    updateRoutingConfig,
    updateInstallConfig,
    updateSmartRoutingConfig,
    updateSmartRoutingConfigBatch,
    updateRoutingConfigBatch,
    updateMCPRouterConfig,
    updateMCPRouterConfigBatch,
    updateOAuthServerConfig,
    updateOAuthServerConfigBatch,
    updateNameSeparator,
    updateSessionRebuild,
    exportMCPSettings,
    refreshBearerKeys,
    createBearerKey,
    updateBearerKey,
    deleteBearerKey,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};
