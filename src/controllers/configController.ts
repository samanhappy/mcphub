import { Request, Response } from 'express';
import config from '../config/index.js';
import { loadSettings, loadOriginalSettings } from '../config/index.js';
import { getDataService } from '../services/services.js';
import { DataService } from '../services/dataService.js';
import { IUser } from '../types/index.js';

const dataService: DataService = getDataService();

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
 * This endpoint doesn't require authentication to allow checking if auth should be skipped
 */
export const getPublicConfig = (req: Request, res: Response): void => {
  try {
    const settings = loadSettings();
    const skipAuth = settings.systemConfig?.routing?.skipAuth || false;
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
 * Get MCP settings in JSON format for export/copy
 * Supports both full settings and individual server configuration
 */
export const getMcpSettingsJson = (req: Request, res: Response): void => {
  try {
    const { serverName } = req.query;
    const settings = loadOriginalSettings();
    if (serverName && typeof serverName === 'string') {
      // Return individual server configuration
      const serverConfig = settings.mcpServers[serverName];
      if (!serverConfig) {
        res.status(404).json({
          success: false,
          message: `Server '${serverName}' not found`,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          mcpServers: {
            [serverName]: serverConfig,
          },
        },
      });
    } else {
      // Return full settings
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
