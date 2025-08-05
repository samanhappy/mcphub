import { apiGet, fetchWithInterceptors } from '../utils/fetchInterceptor';
import { getBasePath } from '../utils/runtime';

export interface SystemConfig {
  routing?: {
    enableGlobalRoute?: boolean;
    enableGroupNameRoute?: boolean;
    enableBearerAuth?: boolean;
    bearerAuthKey?: string;
    skipAuth?: boolean;
  };
  install?: {
    pythonIndexUrl?: string;
    npmRegistry?: string;
  };
  smartRouting?: {
    enabled?: boolean;
    dbUrl?: string;
    openaiApiBaseUrl?: string;
    openaiApiKey?: string;
    openaiApiEmbeddingModel?: string;
  };
}

export interface PublicConfigResponse {
  success: boolean;
  data?: {
    skipAuth?: boolean;
    permissions?: any;
  };
  message?: string;
}

export interface SystemConfigResponse {
  success: boolean;
  data?: {
    systemConfig?: SystemConfig;
  };
  message?: string;
}

/**
 * Get public configuration (skipAuth setting) without authentication
 */
export const getPublicConfig = async (): Promise<{ skipAuth: boolean; permissions?: any }> => {
  try {
    const basePath = getBasePath();
    const response = await fetchWithInterceptors(`${basePath}/public-config`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data: PublicConfigResponse = await response.json();
      return { skipAuth: data.data?.skipAuth === true, permissions: data.data?.permissions || {} };
    }

    return { skipAuth: false };
  } catch (error) {
    console.debug('Failed to get public config:', error);
    return { skipAuth: false };
  }
};

/**
 * Get system configuration without authentication
 * This function tries to get the system configuration first without auth,
 * and if that fails (likely due to auth requirements), it returns null
 */
export const getSystemConfigPublic = async (): Promise<SystemConfig | null> => {
  try {
    const response = await apiGet<SystemConfigResponse>('/settings');

    if (response.success) {
      return response.data?.systemConfig || null;
    }

    return null;
  } catch (error) {
    console.debug('Failed to get system config without auth:', error);
    return null;
  }
};

/**
 * Check if authentication should be skipped based on system configuration
 */
export const shouldSkipAuth = async (): Promise<boolean> => {
  try {
    const config = await getPublicConfig();
    return config.skipAuth;
  } catch (error) {
    console.debug('Failed to check skipAuth setting:', error);
    return false;
  }
};
