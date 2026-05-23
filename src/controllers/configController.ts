import { Request, Response } from 'express';
import config from '../config/index.js';
import { getDataService } from '../services/services.js';
import { DataService } from '../services/dataService.js';
import { IUser } from '../types/index.js';
import {
  getGroupDao,
  getOAuthClientDao,
  getOAuthTokenDao,
  getServerDao,
  getSystemConfigDao,
  getUserConfigDao,
  getUserDao,
  getBearerKeyDao,
} from '../dao/DaoFactory.js';
import { getBetterAuthRuntimeConfig } from '../services/betterAuthConfig.js';

const dataService: DataService = getDataService();

const requireAdmin = (req: Request, res: Response): boolean => {
  const user = (req as any).user;
  if (!user || !user.isAdmin) {
    res.status(403).json({
      success: false,
      message: 'Admin privileges required',
    });
    return false;
  }
  return true;
};

/**
 * Get runtime configuration for frontend
 */
export const getRuntimeConfig = (req: Request, res: Response): void => {
  try {
    const runtimeConfig = {
      basePath: config.basePath,
      version: config.mcpHubVersion,
      name: config.mcpHubName,
    };

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json({
      success: true,
      data: runtimeConfig,
    });
  } catch (error) {
    console.error('Error getting runtime config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get runtime configuration',
    });
  }
};

/**
 * Get public system configuration (only skipAuth setting)
 * This endpoint doesn't require authentication to allow checking if dashboard login should be skipped
 */
export const getPublicConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const systemConfig = await getSystemConfigDao().get();
    const skipAuth = systemConfig?.routing?.skipAuth || false;
    let permissions = {};
    if (skipAuth) {
      const user: IUser = {
        username: 'guest',
        password: '',
        isAdmin: true,
      };
      permissions = dataService.getPermissions(user);
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json({
      success: true,
      data: {
        skipAuth,
        permissions,
        betterAuth: await getBetterAuthRuntimeConfig(systemConfig),
      },
    });
  } catch (error) {
    console.error('Error getting public config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get public configuration',
    });
  }
};

/**
 * Recursively remove null values from an object
 */
const omitSensitiveFields = <T extends Record<string, any>, K extends keyof T & string>(
  items: T[],
  fields: readonly K[],
): Omit<T, K>[] =>
  items.map((item) => {
    const sanitized = { ...item };
    for (const field of fields) {
      delete sanitized[field];
    }
    return sanitized;
  });

const removeNullValues = <T>(obj: T): T => {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => removeNullValues(item)) as T;
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null) {
        result[key] = removeNullValues(value);
      }
    }
    return result as T;
  }
  return obj;
};

/**
 * Get MCP settings in JSON format for export/copy
 * Supports both full settings and individual server configuration
 */
export const getMcpSettingsJson = async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  try {
    const { serverName } = req.query;
    if (serverName && typeof serverName === 'string') {
      // Return individual server configuration using DAO
      const serverDao = getServerDao();
      const serverConfig = await serverDao.findById(serverName);
      if (!serverConfig) {
        res.status(404).json({
          success: false,
          message: `Server '${serverName}' not found`,
        });
        return;
      }

      // Remove the 'name' field from config as it's used as the key
      const { name, ...configWithoutName } = serverConfig;
      // Remove null values from the config
      const cleanedConfig = removeNullValues(configWithoutName);
      res.json({
        success: true,
        data: {
          mcpServers: {
            [name]: cleanedConfig,
          },
        },
      });
    } else {
      // Return full settings via DAO layer (supports both file and database modes)
      const [
        servers,
        users,
        groups,
        systemConfig,
        userConfigs,
        oauthClients,
        oauthTokens,
        bearerKeys,
      ] = await Promise.all([
        getServerDao().findAll(),
        getUserDao().findAll(),
        getGroupDao().findAll(),
        getSystemConfigDao().get(),
        getUserConfigDao().getAll(),
        getOAuthClientDao().findAll(),
        getOAuthTokenDao().findAll(),
        getBearerKeyDao().findAll(),
      ]);

      const mcpServers: Record<string, any> = {};
      for (const { name: serverConfigName, ...config } of servers) {
        mcpServers[serverConfigName] = removeNullValues(config);
      }

      const settings = {
        mcpServers,
        users: omitSensitiveFields(users, ['password']),
        groups,
        systemConfig,
        userConfigs,
        oauthClients: omitSensitiveFields(oauthClients, ['clientSecret']),
        oauthTokens: omitSensitiveFields(oauthTokens, ['accessToken', 'refreshToken']),
        bearerKeys: omitSensitiveFields(bearerKeys, ['token']),
      };

      res.json({
        success: true,
        data: settings,
      });
    }
  } catch (error) {
    console.error('Error getting MCP settings JSON:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get MCP settings',
    });
  }
};
