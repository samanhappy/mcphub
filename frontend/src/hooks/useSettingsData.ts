import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiResponse } from '@/types';
import { useToast } from '@/contexts/ToastContext';
import { getApiUrl } from '../utils/runtime';

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
}

interface SmartRoutingConfig {
  enabled: boolean;
  dbUrl: string;
  openaiApiBaseUrl: string;
  openaiApiKey: string;
  openaiApiEmbeddingModel: string;
}

interface SystemSettings {
  systemConfig?: {
    routing?: RoutingConfig;
    install?: InstallConfig;
    smartRouting?: SmartRoutingConfig;
  };
}

interface TempRoutingConfig {
  bearerAuthKey: string;
}

export const useSettingsData = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();

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
  });

  const [smartRoutingConfig, setSmartRoutingConfig] = useState<SmartRoutingConfig>({
    enabled: false,
    dbUrl: '',
    openaiApiBaseUrl: '',
    openaiApiKey: '',
    openaiApiEmbeddingModel: '',
  });

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
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(getApiUrl('/settings'), {
        headers: {
          'x-auth-token': token || '',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data: ApiResponse<SystemSettings> = await response.json();

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
        });
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch settings');
      // 使用一个稳定的 showToast 引用，避免将其加入依赖数组
      showToast(t('errors.failedToFetchSettings'));
    } finally {
      setLoading(false);
    }
  }, [t]); // 移除 showToast 依赖

  // Update routing configuration
  const updateRoutingConfig = async <T extends keyof RoutingConfig>(
    key: T,
    value: RoutingConfig[T],
  ) => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(getApiUrl('/system-config'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || '',
        },
        body: JSON.stringify({
          routing: {
            [key]: value,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        setRoutingConfig({
          ...routingConfig,
          [key]: value,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        showToast(t('errors.failedToUpdateRouteConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update routing config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update routing config');
      showToast(t('errors.failedToUpdateRouteConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update install configuration
  const updateInstallConfig = async (key: keyof InstallConfig, value: string) => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(getApiUrl('/system-config'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || '',
        },
        body: JSON.stringify({
          install: {
            [key]: value,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        setInstallConfig({
          ...installConfig,
          [key]: value,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        showToast(t('errors.failedToUpdateSystemConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update system config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update system config');
      showToast(t('errors.failedToUpdateSystemConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update smart routing configuration
  const updateSmartRoutingConfig = async <T extends keyof SmartRoutingConfig>(
    key: T,
    value: SmartRoutingConfig[T],
  ) => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(getApiUrl('/system-config'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || '',
        },
        body: JSON.stringify({
          smartRouting: {
            [key]: value,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        setSmartRoutingConfig({
          ...smartRoutingConfig,
          [key]: value,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        showToast(data.message || t('errors.failedToUpdateSmartRoutingConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update smart routing config:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to update smart routing config';
      setError(errorMessage);
      showToast(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update multiple smart routing configuration fields at once
  const updateSmartRoutingConfigBatch = async (updates: Partial<SmartRoutingConfig>) => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(getApiUrl('/system-config'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || '',
        },
        body: JSON.stringify({
          smartRouting: updates,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        setSmartRoutingConfig({
          ...smartRoutingConfig,
          ...updates,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        showToast(data.message || t('errors.failedToUpdateSmartRoutingConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update smart routing config:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to update smart routing config';
      setError(errorMessage);
      showToast(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Update multiple routing configuration fields at once
  const updateRoutingConfigBatch = async (updates: Partial<RoutingConfig>) => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(getApiUrl('/system-config'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || '',
        },
        body: JSON.stringify({
          routing: updates,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        setRoutingConfig({
          ...routingConfig,
          ...updates,
        });
        showToast(t('settings.systemConfigUpdated'));
        return true;
      } else {
        showToast(t('errors.failedToUpdateRouteConfig'));
        return false;
      }
    } catch (error) {
      console.error('Failed to update routing config:', error);
      setError(error instanceof Error ? error.message : 'Failed to update routing config');
      showToast(t('errors.failedToUpdateRouteConfig'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Fetch settings when the component mounts or refreshKey changes
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings, refreshKey]);

  useEffect(() => {
    if (routingConfig) {
      setTempRoutingConfig({
        bearerAuthKey: routingConfig.bearerAuthKey,
      });
    }
  }, [routingConfig]);

  return {
    routingConfig,
    tempRoutingConfig,
    setTempRoutingConfig,
    installConfig,
    smartRoutingConfig,
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
  };
};
