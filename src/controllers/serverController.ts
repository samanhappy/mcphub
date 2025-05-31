import { Request, Response } from 'express';
import { ApiResponse, AddServerRequest } from '../types/index.js';
import {
  getServersInfo,
  addServer,
  removeServer,
  updateMcpServer,
  notifyToolChanged,
  toggleServerStatus,
} from '../services/mcpService.js';
import { loadSettings, saveSettings } from '../config/index.js';
import { syncAllServerToolsEmbeddings } from '../services/vectorSearchService.js';

export const getAllServers = (_: Request, res: Response): void => {
  try {
    const serversInfo = getServersInfo();
    const response: ApiResponse = {
      success: true,
      data: serversInfo,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get servers information',
    });
  }
};

export const getAllSettings = (_: Request, res: Response): void => {
  try {
    const settings = loadSettings();
    const response: ApiResponse = {
      success: true,
      data: settings,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get server settings',
    });
  }
};

export const createServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, config } = req.body as AddServerRequest;
    if (!name || typeof name !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    if (!config || typeof config !== 'object') {
      res.status(400).json({
        success: false,
        message: 'Server configuration is required',
      });
      return;
    }

    if (!config.url && (!config.command || !config.args)) {
      res.status(400).json({
        success: false,
        message: 'Server configuration must include either a URL or command with arguments',
      });
      return;
    }

    // Validate the server type if specified
    if (config.type && !['stdio', 'sse', 'streamable-http'].includes(config.type)) {
      res.status(400).json({
        success: false,
        message: 'Server type must be one of: stdio, sse, streamable-http',
      });
      return;
    }

    // Validate that URL is provided for sse and streamable-http types
    if ((config.type === 'sse' || config.type === 'streamable-http') && !config.url) {
      res.status(400).json({
        success: false,
        message: `URL is required for ${config.type} server type`,
      });
      return;
    }

    // Validate headers if provided
    if (config.headers && typeof config.headers !== 'object') {
      res.status(400).json({
        success: false,
        message: 'Headers must be an object',
      });
      return;
    }

    // Validate that headers are only used with sse and streamable-http types
    if (config.headers && config.type === 'stdio') {
      res.status(400).json({
        success: false,
        message: 'Headers are not supported for stdio server type',
      });
      return;
    }

    const result = await addServer(name, config);
    if (result.success) {
      notifyToolChanged();
      res.json({
        success: true,
        message: 'Server added successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message || 'Failed to add server',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deleteServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    const result = removeServer(name);
    if (result.success) {
      notifyToolChanged();
      res.json({
        success: true,
        message: 'Server removed successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message || 'Server not found or failed to remove',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const { config } = req.body;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    if (!config || typeof config !== 'object') {
      res.status(400).json({
        success: false,
        message: 'Server configuration is required',
      });
      return;
    }

    if (!config.url && (!config.command || !config.args)) {
      res.status(400).json({
        success: false,
        message: 'Server configuration must include either a URL or command with arguments',
      });
      return;
    }

    // Validate the server type if specified
    if (config.type && !['stdio', 'sse', 'streamable-http'].includes(config.type)) {
      res.status(400).json({
        success: false,
        message: 'Server type must be one of: stdio, sse, streamable-http',
      });
      return;
    }

    // Validate that URL is provided for sse and streamable-http types
    if ((config.type === 'sse' || config.type === 'streamable-http') && !config.url) {
      res.status(400).json({
        success: false,
        message: `URL is required for ${config.type} server type`,
      });
      return;
    }

    // Validate headers if provided
    if (config.headers && typeof config.headers !== 'object') {
      res.status(400).json({
        success: false,
        message: 'Headers must be an object',
      });
      return;
    }

    // Validate that headers are only used with sse and streamable-http types
    if (config.headers && config.type === 'stdio') {
      res.status(400).json({
        success: false,
        message: 'Headers are not supported for stdio server type',
      });
      return;
    }

    const result = await updateMcpServer(name, config);
    if (result.success) {
      notifyToolChanged();
      res.json({
        success: true,
        message: 'Server updated successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message || 'Server not found or failed to update',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getServerConfig = (req: Request, res: Response): void => {
  try {
    const { name } = req.params;
    const settings = loadSettings();
    if (!settings.mcpServers || !settings.mcpServers[name]) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    const serverInfo = getServersInfo().find((s) => s.name === name);
    const serverConfig = settings.mcpServers[name];
    const response: ApiResponse = {
      success: true,
      data: {
        name,
        status: serverInfo ? serverInfo.status : 'disconnected',
        tools: serverInfo ? serverInfo.tools : [],
        config: serverConfig,
      },
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get server configuration',
    });
  }
};

export const toggleServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const { enabled } = req.body;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    if (typeof enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Enabled status must be a boolean',
      });
      return;
    }

    const result = await toggleServerStatus(name, enabled);
    if (result.success) {
      notifyToolChanged();
      res.json({
        success: true,
        message: result.message || `Server ${enabled ? 'enabled' : 'disabled'} successfully`,
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message || 'Server not found or failed to toggle status',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateSystemConfig = (req: Request, res: Response): void => {
  try {
    const { routing, install, smartRouting } = req.body;

    if (
      (!routing ||
        (typeof routing.enableGlobalRoute !== 'boolean' &&
          typeof routing.enableGroupNameRoute !== 'boolean' &&
          typeof routing.enableBearerAuth !== 'boolean' &&
          typeof routing.bearerAuthKey !== 'string')) &&
      (!install ||
        (typeof install.pythonIndexUrl !== 'string' && typeof install.npmRegistry !== 'string')) &&
      (!smartRouting ||
        (typeof smartRouting.enabled !== 'boolean' &&
          typeof smartRouting.dbUrl !== 'string' &&
          typeof smartRouting.openaiApiBaseUrl !== 'string' &&
          typeof smartRouting.openaiApiKey !== 'string' &&
          typeof smartRouting.openaiApiEmbeddingModel !== 'string'))
    ) {
      res.status(400).json({
        success: false,
        message: 'Invalid system configuration provided',
      });
      return;
    }

    const settings = loadSettings();
    if (!settings.systemConfig) {
      settings.systemConfig = {
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: false,
          bearerAuthKey: '',
        },
        install: {
          pythonIndexUrl: '',
          npmRegistry: '',
        },
        smartRouting: {
          enabled: false,
          dbUrl: '',
          openaiApiBaseUrl: '',
          openaiApiKey: '',
          openaiApiEmbeddingModel: '',
        },
      };
    }

    if (!settings.systemConfig.routing) {
      settings.systemConfig.routing = {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: false,
        bearerAuthKey: '',
      };
    }

    if (!settings.systemConfig.install) {
      settings.systemConfig.install = {
        pythonIndexUrl: '',
        npmRegistry: '',
      };
    }

    if (!settings.systemConfig.smartRouting) {
      settings.systemConfig.smartRouting = {
        enabled: false,
        dbUrl: '',
        openaiApiBaseUrl: '',
        openaiApiKey: '',
        openaiApiEmbeddingModel: '',
      };
    }

    if (routing) {
      if (typeof routing.enableGlobalRoute === 'boolean') {
        settings.systemConfig.routing.enableGlobalRoute = routing.enableGlobalRoute;
      }

      if (typeof routing.enableGroupNameRoute === 'boolean') {
        settings.systemConfig.routing.enableGroupNameRoute = routing.enableGroupNameRoute;
      }

      if (typeof routing.enableBearerAuth === 'boolean') {
        settings.systemConfig.routing.enableBearerAuth = routing.enableBearerAuth;
      }

      if (typeof routing.bearerAuthKey === 'string') {
        settings.systemConfig.routing.bearerAuthKey = routing.bearerAuthKey;
      }
    }

    if (install) {
      if (typeof install.pythonIndexUrl === 'string') {
        settings.systemConfig.install.pythonIndexUrl = install.pythonIndexUrl;
      }
      if (typeof install.npmRegistry === 'string') {
        settings.systemConfig.install.npmRegistry = install.npmRegistry;
      }
    }

    // Track smartRouting state and configuration changes
    const wasSmartRoutingEnabled = settings.systemConfig.smartRouting.enabled || false;
    const previousSmartRoutingConfig = { ...settings.systemConfig.smartRouting };
    let needsSync = false;

    if (smartRouting) {
      if (typeof smartRouting.enabled === 'boolean') {
        // If enabling Smart Routing, validate required fields
        if (smartRouting.enabled) {
          const currentDbUrl = smartRouting.dbUrl || settings.systemConfig.smartRouting.dbUrl;
          const currentOpenaiApiKey =
            smartRouting.openaiApiKey || settings.systemConfig.smartRouting.openaiApiKey;

          if (!currentDbUrl || !currentOpenaiApiKey) {
            const missingFields = [];
            if (!currentDbUrl) missingFields.push('Database URL');
            if (!currentOpenaiApiKey) missingFields.push('OpenAI API Key');

            res.status(400).json({
              success: false,
              message: `Smart Routing requires the following fields: ${missingFields.join(', ')}`,
            });
            return;
          }
        }
        settings.systemConfig.smartRouting.enabled = smartRouting.enabled;
      }
      if (typeof smartRouting.dbUrl === 'string') {
        settings.systemConfig.smartRouting.dbUrl = smartRouting.dbUrl;
      }
      if (typeof smartRouting.openaiApiBaseUrl === 'string') {
        settings.systemConfig.smartRouting.openaiApiBaseUrl = smartRouting.openaiApiBaseUrl;
      }
      if (typeof smartRouting.openaiApiKey === 'string') {
        settings.systemConfig.smartRouting.openaiApiKey = smartRouting.openaiApiKey;
      }
      if (typeof smartRouting.openaiApiEmbeddingModel === 'string') {
        settings.systemConfig.smartRouting.openaiApiEmbeddingModel =
          smartRouting.openaiApiEmbeddingModel;
      }

      // Check if we need to sync embeddings
      const isNowEnabled = settings.systemConfig.smartRouting.enabled || false;
      const hasConfigChanged =
        previousSmartRoutingConfig.dbUrl !== settings.systemConfig.smartRouting.dbUrl ||
        previousSmartRoutingConfig.openaiApiBaseUrl !==
          settings.systemConfig.smartRouting.openaiApiBaseUrl ||
        previousSmartRoutingConfig.openaiApiKey !==
          settings.systemConfig.smartRouting.openaiApiKey ||
        previousSmartRoutingConfig.openaiApiEmbeddingModel !==
          settings.systemConfig.smartRouting.openaiApiEmbeddingModel;

      // Sync if: first time enabling OR smart routing is enabled and any config changed
      needsSync = (!wasSmartRoutingEnabled && isNowEnabled) || (isNowEnabled && hasConfigChanged);
    }

    if (saveSettings(settings)) {
      res.json({
        success: true,
        data: settings.systemConfig,
        message: 'System configuration updated successfully',
      });

      // If smart routing configuration changed, sync all existing server tools
      if (needsSync) {
        console.log('SmartRouting configuration changed - syncing all existing server tools...');
        // Run sync asynchronously to avoid blocking the response
        syncAllServerToolsEmbeddings().catch((error) => {
          console.error('Failed to sync server tools embeddings:', error);
        });
      }
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to save system configuration',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
