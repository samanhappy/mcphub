import { Request, Response } from 'express';
import { ApiResponse, AddServerRequest } from '../types/index.js';
import {
  getServersInfo,
  addServer,
  addOrUpdateServer,
  removeServer,
  notifyToolChanged,
  syncToolEmbedding,
  toggleServerStatus,
} from '../services/mcpService.js';
import { loadSettings, saveSettings } from '../config/index.js';
import { syncAllServerToolsEmbeddings } from '../services/vectorSearchService.js';
import { createSafeJSON } from '../utils/serialization.js';
import { cloneDefaultOAuthServerConfig } from '../constants/oauthServerDefaults.js';

export const getAllServers = async (_: Request, res: Response): Promise<void> => {
  try {
    const serversInfo = await getServersInfo();
    const response: ApiResponse = {
      success: true,
      data: createSafeJSON(serversInfo),
    };
    res.json(response);
  } catch (error) {
    console.error('Failed to get servers information:', error);
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
      data: createSafeJSON(settings),
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

    if (
      !config.url &&
      !config.openapi?.url &&
      !config.openapi?.schema &&
      (!config.command || !config.args)
    ) {
      res.status(400).json({
        success: false,
        message:
          'Server configuration must include either a URL, OpenAPI specification URL or schema, or command with arguments',
      });
      return;
    }

    // Validate the server type if specified
    if (config.type && !['stdio', 'sse', 'streamable-http', 'openapi'].includes(config.type)) {
      res.status(400).json({
        success: false,
        message: 'Server type must be one of: stdio, sse, streamable-http, openapi',
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

    // Validate that OpenAPI specification URL or schema is provided for openapi type
    if (config.type === 'openapi' && !config.openapi?.url && !config.openapi?.schema) {
      res.status(400).json({
        success: false,
        message: 'OpenAPI specification URL or schema is required for openapi server type',
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

    // Validate that headers are only used with sse, streamable-http, and openapi types
    if (config.headers && config.type === 'stdio') {
      res.status(400).json({
        success: false,
        message: 'Headers are not supported for stdio server type',
      });
      return;
    }

    // Set default keep-alive interval for SSE servers if not specified
    if ((config.type === 'sse' || (!config.type && config.url)) && !config.keepAliveInterval) {
      config.keepAliveInterval = 60000; // Default 60 seconds for SSE servers
    }

    // Set owner property - use current user's username, default to 'admin'
    if (!config.owner) {
      const currentUser = (req as any).user;
      config.owner = currentUser?.username || 'admin';
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

    const result = await removeServer(name);
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

    if (
      !config.url &&
      !config.openapi?.url &&
      !config.openapi?.schema &&
      (!config.command || !config.args)
    ) {
      res.status(400).json({
        success: false,
        message:
          'Server configuration must include either a URL, OpenAPI specification URL or schema, or command with arguments',
      });
      return;
    }

    // Validate the server type if specified
    if (config.type && !['stdio', 'sse', 'streamable-http', 'openapi'].includes(config.type)) {
      res.status(400).json({
        success: false,
        message: 'Server type must be one of: stdio, sse, streamable-http, openapi',
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

    // Validate that OpenAPI specification URL or schema is provided for openapi type
    if (config.type === 'openapi' && !config.openapi?.url && !config.openapi?.schema) {
      res.status(400).json({
        success: false,
        message: 'OpenAPI specification URL or schema is required for openapi server type',
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

    // Validate that headers are only used with sse, streamable-http, and openapi types
    if (config.headers && config.type === 'stdio') {
      res.status(400).json({
        success: false,
        message: 'Headers are not supported for stdio server type',
      });
      return;
    }

    // Set default keep-alive interval for SSE servers if not specified
    if ((config.type === 'sse' || (!config.type && config.url)) && !config.keepAliveInterval) {
      config.keepAliveInterval = 60000; // Default 60 seconds for SSE servers
    }

    // Set owner property if not provided - use current user's username, default to 'admin'
    if (!config.owner) {
      const currentUser = (req as any).user;
      config.owner = currentUser?.username || 'admin';
    }

    const result = await addOrUpdateServer(name, config, true); // Allow override for updates
    if (result.success) {
      notifyToolChanged(name);
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

export const getServerConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const allServers = await getServersInfo();
    const serverInfo = allServers.find((s) => s.name === name);
    if (!serverInfo) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: {
        name,
        status: serverInfo ? serverInfo.status : 'disconnected',
        tools: serverInfo ? serverInfo.tools : [],
        config: serverInfo,
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

// Toggle tool status for a specific server
export const toggleTool = async (req: Request, res: Response): Promise<void> => {
  try {
    // Decode URL-encoded parameters to handle slashes in server/tool names
    const serverName = decodeURIComponent(req.params.serverName);
    const toolName = decodeURIComponent(req.params.toolName);
    const { enabled } = req.body;

    if (!serverName || !toolName) {
      res.status(400).json({
        success: false,
        message: 'Server name and tool name are required',
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

    const settings = loadSettings();
    if (!settings.mcpServers[serverName]) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Initialize tools config if it doesn't exist
    if (!settings.mcpServers[serverName].tools) {
      settings.mcpServers[serverName].tools = {};
    }

    // Set the tool's enabled state
    settings.mcpServers[serverName].tools![toolName] = { enabled };

    if (!saveSettings(settings)) {
      res.status(500).json({
        success: false,
        message: 'Failed to save settings',
      });
      return;
    }

    // Notify that tools have changed
    notifyToolChanged();

    res.json({
      success: true,
      message: `Tool ${toolName} ${enabled ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update tool description for a specific server
export const updateToolDescription = async (req: Request, res: Response): Promise<void> => {
  try {
    // Decode URL-encoded parameters to handle slashes in server/tool names
    const serverName = decodeURIComponent(req.params.serverName);
    const toolName = decodeURIComponent(req.params.toolName);
    const { description } = req.body;

    if (!serverName || !toolName) {
      res.status(400).json({
        success: false,
        message: 'Server name and tool name are required',
      });
      return;
    }

    if (typeof description !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Description must be a string',
      });
      return;
    }

    const settings = loadSettings();
    if (!settings.mcpServers[serverName]) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Initialize tools config if it doesn't exist
    if (!settings.mcpServers[serverName].tools) {
      settings.mcpServers[serverName].tools = {};
    }

    // Set the tool's description
    if (!settings.mcpServers[serverName].tools![toolName]) {
      settings.mcpServers[serverName].tools![toolName] = { enabled: true };
    }

    settings.mcpServers[serverName].tools![toolName].description = description;

    if (!saveSettings(settings)) {
      res.status(500).json({
        success: false,
        message: 'Failed to save settings',
      });
      return;
    }

    // Notify that tools have changed
    notifyToolChanged();

    syncToolEmbedding(serverName, toolName);

    res.json({
      success: true,
      message: `Tool ${toolName} description updated successfully`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateSystemConfig = (req: Request, res: Response): void => {
  try {
    const { routing, install, smartRouting, mcpRouter, nameSeparator, enableSessionRebuild, oauthServer } = req.body;
    const currentUser = (req as any).user;

    const hasRoutingUpdate =
      routing &&
      (typeof routing.enableGlobalRoute === 'boolean' ||
        typeof routing.enableGroupNameRoute === 'boolean' ||
        typeof routing.enableBearerAuth === 'boolean' ||
        typeof routing.bearerAuthKey === 'string' ||
        typeof routing.skipAuth === 'boolean');

    const hasInstallUpdate =
      install &&
      (typeof install.pythonIndexUrl === 'string' ||
        typeof install.npmRegistry === 'string' ||
        typeof install.baseUrl === 'string');

    const hasSmartRoutingUpdate =
      smartRouting &&
      (typeof smartRouting.enabled === 'boolean' ||
        typeof smartRouting.dbUrl === 'string' ||
        typeof smartRouting.openaiApiBaseUrl === 'string' ||
        typeof smartRouting.openaiApiKey === 'string' ||
        typeof smartRouting.openaiApiEmbeddingModel === 'string');

    const hasMcpRouterUpdate =
      mcpRouter &&
      (typeof mcpRouter.apiKey === 'string' ||
        typeof mcpRouter.referer === 'string' ||
        typeof mcpRouter.title === 'string' ||
        typeof mcpRouter.baseUrl === 'string');

    const hasNameSeparatorUpdate = typeof nameSeparator === 'string';
    
    const hasSessionRebuildUpdate = typeof enableSessionRebuild !== 'boolean';

    const hasOAuthServerUpdate =
      oauthServer &&
      (typeof oauthServer.enabled === 'boolean' ||
        typeof oauthServer.accessTokenLifetime === 'number' ||
        typeof oauthServer.refreshTokenLifetime === 'number' ||
        typeof oauthServer.authorizationCodeLifetime === 'number' ||
        typeof oauthServer.requireClientSecret === 'boolean' ||
        typeof oauthServer.requireState === 'boolean' ||
        Array.isArray(oauthServer.allowedScopes) ||
        (oauthServer.dynamicRegistration &&
          (typeof oauthServer.dynamicRegistration.enabled === 'boolean' ||
            typeof oauthServer.dynamicRegistration.requiresAuthentication === 'boolean' ||
            Array.isArray(oauthServer.dynamicRegistration.allowedGrantTypes))));

    if (
      !hasRoutingUpdate &&
      !hasInstallUpdate &&
      !hasSmartRoutingUpdate &&
      !hasMcpRouterUpdate &&
      !hasNameSeparatorUpdate &&
      !hasSessionRebuildUpdate &&
      !hasOAuthServerUpdate
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
          skipAuth: false,
        },
        install: {
          pythonIndexUrl: '',
          npmRegistry: '',
          baseUrl: 'http://localhost:3000',
        },
        smartRouting: {
          enabled: false,
          dbUrl: '',
          openaiApiBaseUrl: '',
          openaiApiKey: '',
          openaiApiEmbeddingModel: '',
        },
        mcpRouter: {
          apiKey: '',
          referer: 'https://www.mcphubx.com',
          title: 'MCPHub',
          baseUrl: 'https://api.mcprouter.to/v1',
        },
        oauthServer: cloneDefaultOAuthServerConfig(),
      };
    }

    if (!settings.systemConfig.routing) {
      settings.systemConfig.routing = {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: false,
        bearerAuthKey: '',
        skipAuth: false,
      };
    }

    if (!settings.systemConfig.install) {
      settings.systemConfig.install = {
        pythonIndexUrl: '',
        npmRegistry: '',
        baseUrl: 'http://localhost:3000',
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

    if (!settings.systemConfig.mcpRouter) {
      settings.systemConfig.mcpRouter = {
        apiKey: '',
        referer: 'https://www.mcphubx.com',
        title: 'MCPHub',
        baseUrl: 'https://api.mcprouter.to/v1',
      };
    }

    if (!settings.systemConfig.oauthServer) {
      settings.systemConfig.oauthServer = cloneDefaultOAuthServerConfig();
    }

    if (!settings.systemConfig.oauthServer.dynamicRegistration) {
      const defaultConfig = cloneDefaultOAuthServerConfig();
      const defaultDynamic = defaultConfig.dynamicRegistration ?? {
        enabled: false,
        allowedGrantTypes: [],
        requiresAuthentication: false,
      };
      settings.systemConfig.oauthServer.dynamicRegistration = {
        enabled: defaultDynamic.enabled ?? false,
        allowedGrantTypes: [
          ...(Array.isArray(defaultDynamic.allowedGrantTypes)
            ? defaultDynamic.allowedGrantTypes
            : []),
        ],
        requiresAuthentication: defaultDynamic.requiresAuthentication ?? false,
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

      if (typeof routing.skipAuth === 'boolean') {
        settings.systemConfig.routing.skipAuth = routing.skipAuth;
      }
    }

    if (install) {
      if (typeof install.pythonIndexUrl === 'string') {
        settings.systemConfig.install.pythonIndexUrl = install.pythonIndexUrl;
      }
      if (typeof install.npmRegistry === 'string') {
        settings.systemConfig.install.npmRegistry = install.npmRegistry;
      }
      if (typeof install.baseUrl === 'string') {
        settings.systemConfig.install.baseUrl = install.baseUrl;
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

    if (mcpRouter) {
      if (typeof mcpRouter.apiKey === 'string') {
        settings.systemConfig.mcpRouter.apiKey = mcpRouter.apiKey;
      }
      if (typeof mcpRouter.referer === 'string') {
        settings.systemConfig.mcpRouter.referer = mcpRouter.referer;
      }
      if (typeof mcpRouter.title === 'string') {
        settings.systemConfig.mcpRouter.title = mcpRouter.title;
      }
      if (typeof mcpRouter.baseUrl === 'string') {
        settings.systemConfig.mcpRouter.baseUrl = mcpRouter.baseUrl;
      }
    }

    if (oauthServer) {
      const target = settings.systemConfig.oauthServer;
      if (typeof oauthServer.enabled === 'boolean') {
        target.enabled = oauthServer.enabled;
      }
      if (typeof oauthServer.accessTokenLifetime === 'number') {
        target.accessTokenLifetime = oauthServer.accessTokenLifetime;
      }
      if (typeof oauthServer.refreshTokenLifetime === 'number') {
        target.refreshTokenLifetime = oauthServer.refreshTokenLifetime;
      }
      if (typeof oauthServer.authorizationCodeLifetime === 'number') {
        target.authorizationCodeLifetime = oauthServer.authorizationCodeLifetime;
      }
      if (typeof oauthServer.requireClientSecret === 'boolean') {
        target.requireClientSecret = oauthServer.requireClientSecret;
      }
      if (typeof oauthServer.requireState === 'boolean') {
        target.requireState = oauthServer.requireState;
      }
      if (Array.isArray(oauthServer.allowedScopes)) {
        target.allowedScopes = oauthServer.allowedScopes
          .filter((scope: any): scope is string => typeof scope === 'string')
          .map((scope: string) => scope.trim())
          .filter((scope: string) => scope.length > 0);
      }

      if (oauthServer.dynamicRegistration) {
        const dynamicTarget = target.dynamicRegistration || {
          enabled: false,
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
          requiresAuthentication: false,
        };

        if (typeof oauthServer.dynamicRegistration.enabled === 'boolean') {
          dynamicTarget.enabled = oauthServer.dynamicRegistration.enabled;
        }

        if (Array.isArray(oauthServer.dynamicRegistration.allowedGrantTypes)) {
          dynamicTarget.allowedGrantTypes = oauthServer.dynamicRegistration.allowedGrantTypes
            .filter((grant: any): grant is string => typeof grant === 'string')
            .map((grant: string) => grant.trim())
            .filter((grant: string) => grant.length > 0);
        }

        if (typeof oauthServer.dynamicRegistration.requiresAuthentication === 'boolean') {
          dynamicTarget.requiresAuthentication =
            oauthServer.dynamicRegistration.requiresAuthentication;
        }

        target.dynamicRegistration = dynamicTarget;
      }
    }

    if (typeof nameSeparator === 'string') {
      settings.systemConfig.nameSeparator = nameSeparator;
    }

    if (typeof enableSessionRebuild === 'boolean') {
      settings.systemConfig.enableSessionRebuild = enableSessionRebuild;
    }

    if (saveSettings(settings, currentUser)) {
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

// Toggle prompt status for a specific server
export const togglePrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    // Decode URL-encoded parameters to handle slashes in server/prompt names
    const serverName = decodeURIComponent(req.params.serverName);
    const promptName = decodeURIComponent(req.params.promptName);
    const { enabled } = req.body;

    if (!serverName || !promptName) {
      res.status(400).json({
        success: false,
        message: 'Server name and prompt name are required',
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

    const settings = loadSettings();
    if (!settings.mcpServers[serverName]) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Initialize prompts config if it doesn't exist
    if (!settings.mcpServers[serverName].prompts) {
      settings.mcpServers[serverName].prompts = {};
    }

    // Set the prompt's enabled state
    settings.mcpServers[serverName].prompts![promptName] = { enabled };

    if (!saveSettings(settings)) {
      res.status(500).json({
        success: false,
        message: 'Failed to save settings',
      });
      return;
    }

    // Notify that tools have changed (as prompts are part of the tool listing)
    notifyToolChanged();

    res.json({
      success: true,
      message: `Prompt ${promptName} ${enabled ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update prompt description for a specific server
export const updatePromptDescription = async (req: Request, res: Response): Promise<void> => {
  try {
    // Decode URL-encoded parameters to handle slashes in server/prompt names
    const serverName = decodeURIComponent(req.params.serverName);
    const promptName = decodeURIComponent(req.params.promptName);
    const { description } = req.body;

    if (!serverName || !promptName) {
      res.status(400).json({
        success: false,
        message: 'Server name and prompt name are required',
      });
      return;
    }

    if (typeof description !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Description must be a string',
      });
      return;
    }

    const settings = loadSettings();
    if (!settings.mcpServers[serverName]) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Initialize prompts config if it doesn't exist
    if (!settings.mcpServers[serverName].prompts) {
      settings.mcpServers[serverName].prompts = {};
    }

    // Set the prompt's description
    if (!settings.mcpServers[serverName].prompts![promptName]) {
      settings.mcpServers[serverName].prompts![promptName] = { enabled: true };
    }

    settings.mcpServers[serverName].prompts![promptName].description = description;

    if (!saveSettings(settings)) {
      res.status(500).json({
        success: false,
        message: 'Failed to save settings',
      });
      return;
    }

    // Notify that tools have changed (as prompts are part of the tool listing)
    notifyToolChanged();

    res.json({
      success: true,
      message: `Prompt ${promptName} description updated successfully`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
