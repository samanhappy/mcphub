import { Request, Response } from 'express';
import {
  ApiResponse,
  AddServerRequest,
  McpSettings,
  BatchCreateServersRequest,
  BatchCreateServersResponse,
  BatchServerResult,
  ServerConfig,
} from '../types/index.js';
import {
  getServersInfo,
  addServer,
  addOrUpdateServer,
  removeServer,
  notifyToolChanged,
  syncToolEmbedding,
  toggleServerStatus,
  reconnectServer,
} from '../services/mcpService.js';
import { loadSettings } from '../config/index.js';
import { syncAllServerToolsEmbeddings } from '../services/vectorSearchService.js';
import { createSafeJSON } from '../utils/serialization.js';
import { cloneDefaultOAuthServerConfig } from '../constants/oauthServerDefaults.js';
import { getServerDao, getGroupDao, getSystemConfigDao } from '../dao/DaoFactory.js';
import { getBearerKeyDao } from '../dao/DaoFactory.js';

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

export const getAllSettings = async (_: Request, res: Response): Promise<void> => {
  try {
    // Get base settings from file (for OAuth clients, tokens, users, etc.)
    const fileSettings = loadSettings();

    // Get servers from DAO (supports both file and database modes)
    const serverDao = getServerDao();
    const servers = await serverDao.findAll();

    // Convert servers array to mcpServers map format
    const mcpServers: McpSettings['mcpServers'] = {};
    for (const server of servers) {
      const { name, ...config } = server;
      mcpServers[name] = config;
    }

    // Get groups from DAO
    const groupDao = getGroupDao();
    const groups = await groupDao.findAll();

    // Get system config from DAO
    const systemConfigDao = getSystemConfigDao();
    const systemConfig = await systemConfigDao.get();

    // Ensure smart routing config has DB URL set if environment variable is present
    const dbUrlEnv = process.env.DB_URL || '';
    if (!systemConfig.smartRouting) {
      systemConfig.smartRouting = {
        enabled: false,
        dbUrl: dbUrlEnv ? '${DB_URL}' : '',
        openaiApiBaseUrl: '',
        openaiApiKey: '',
        openaiApiEmbeddingModel: '',
      };
    } else if (!systemConfig.smartRouting.dbUrl) {
      systemConfig.smartRouting.dbUrl = dbUrlEnv ? '${DB_URL}' : '';
    }

    // Get bearer auth keys from DAO
    const bearerKeyDao = getBearerKeyDao();
    const bearerKeys = await bearerKeyDao.findAll();

    // Merge all data into settings object
    const settings: McpSettings = {
      ...fileSettings,
      mcpServers,
      groups,
      systemConfig,
      bearerKeys,
    };

    const response: ApiResponse = {
      success: true,
      data: createSafeJSON(settings),
    };
    res.json(response);
  } catch (error) {
    console.error('Failed to get server settings:', error);
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

// Batch create servers - validates and creates multiple servers in one request
export const batchCreateServers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { servers } = req.body as BatchCreateServersRequest;

    // Validate request body
    if (!servers || !Array.isArray(servers)) {
      res.status(400).json({
        success: false,
        message: 'Request body must contain a "servers" array',
      });
      return;
    }

    if (servers.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Servers array cannot be empty',
      });
      return;
    }

    // Helper function to validate a single server configuration
    const validateServerConfig = (
      name: string,
      config: ServerConfig,
    ): { valid: boolean; message?: string } => {
      if (!name || typeof name !== 'string') {
        return { valid: false, message: 'Server name is required and must be a string' };
      }

      if (!config || typeof config !== 'object') {
        return { valid: false, message: 'Server configuration is required and must be an object' };
      }

      if (
        !config.url &&
        !config.openapi?.url &&
        !config.openapi?.schema &&
        (!config.command || !config.args)
      ) {
        return {
          valid: false,
          message:
            'Server configuration must include either a URL, OpenAPI specification URL or schema, or command with arguments',
        };
      }

      // Validate server type if specified
      if (config.type && !['stdio', 'sse', 'streamable-http', 'openapi'].includes(config.type)) {
        return {
          valid: false,
          message: 'Server type must be one of: stdio, sse, streamable-http, openapi',
        };
      }

      // Validate URL is provided for sse and streamable-http types
      if ((config.type === 'sse' || config.type === 'streamable-http') && !config.url) {
        return { valid: false, message: `URL is required for ${config.type} server type` };
      }

      // Validate OpenAPI specification URL or schema is provided for openapi type
      if (config.type === 'openapi' && !config.openapi?.url && !config.openapi?.schema) {
        return {
          valid: false,
          message: 'OpenAPI specification URL or schema is required for openapi server type',
        };
      }

      // Validate headers if provided
      if (config.headers && typeof config.headers !== 'object') {
        return { valid: false, message: 'Headers must be an object' };
      }

      // Validate that headers are only used with sse, streamable-http, and openapi types
      if (config.headers && config.type === 'stdio') {
        return { valid: false, message: 'Headers are not supported for stdio server type' };
      }

      return { valid: true };
    };

    // Process each server
    const results: BatchServerResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Get current user for owner field
    const currentUser = (req as any).user;
    const defaultOwner = currentUser?.username || 'admin';

    for (const server of servers) {
      const { name, config } = server;

      // Validate server configuration
      const validation = validateServerConfig(name, config);
      if (!validation.valid) {
        results.push({
          name: name || 'unknown',
          success: false,
          message: validation.message,
        });
        failureCount++;
        continue;
      }

      try {
        // Set default keep-alive interval for SSE servers if not specified
        if ((config.type === 'sse' || (!config.type && config.url)) && !config.keepAliveInterval) {
          config.keepAliveInterval = 60000; // Default 60 seconds for SSE servers
        }

        // Set owner property if not provided
        if (!config.owner) {
          config.owner = defaultOwner;
        }

        // Attempt to add server
        const result = await addServer(name, config);
        if (result.success) {
          results.push({
            name,
            success: true,
          });
          successCount++;
        } else {
          results.push({
            name,
            success: false,
            message: result.message || 'Failed to add server',
          });
          failureCount++;
        }
      } catch (error) {
        results.push({
          name,
          success: false,
          message: error instanceof Error ? error.message : 'Internal server error',
        });
        failureCount++;
      }
    }

    // Notify tool changes if any server was added successfully
    if (successCount > 0) {
      notifyToolChanged();
    }

    // Prepare response
    const response: ApiResponse<BatchCreateServersResponse> = {
      success: successCount > 0, // Success if at least one server was created
      data: {
        success: successCount > 0,
        successCount,
        failureCount,
        results,
      },
    };

    // Return 207 Multi-Status if there were partial failures, 200 if all succeeded, 400 if all failed
    const statusCode = failureCount === 0 ? 200 : successCount === 0 ? 400 : 207;
    res.status(statusCode).json(response);
  } catch (error) {
    console.error('Batch create servers error:', error);
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
    const { config, newName } = req.body;
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

    // Check if server name is being changed
    const isRenaming = newName && newName !== name;

    // If renaming, validate the new name and update references
    if (isRenaming) {
      const serverDao = getServerDao();

      // Check if new name already exists
      if (await serverDao.exists(newName)) {
        res.status(400).json({
          success: false,
          message: `Server name '${newName}' already exists`,
        });
        return;
      }

      // Rename the server
      const renamed = await serverDao.rename(name, newName);
      if (!renamed) {
        res.status(404).json({
          success: false,
          message: 'Server not found',
        });
        return;
      }

      // Update references in groups
      const groupDao = getGroupDao();
      await groupDao.updateServerName(name, newName);

      // Update references in bearer keys
      const bearerKeyDao = getBearerKeyDao();
      await bearerKeyDao.updateServerName(name, newName);
    }

    // Use the final server name (new name if renaming, otherwise original name)
    const finalName = isRenaming ? newName : name;

    const result = await addOrUpdateServer(finalName, config, true); // Allow override for updates
    if (result.success) {
      notifyToolChanged(finalName);
      res.json({
        success: true,
        message: isRenaming
          ? `Server renamed and updated successfully`
          : 'Server updated successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message || 'Server not found or failed to update',
      });
    }
  } catch (error) {
    console.error('Failed to update server:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
};

export const getServerConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;

    // Get server configuration from DAO (supports both file and database modes)
    const serverDao = getServerDao();
    const serverConfig = await serverDao.findById(name);

    if (!serverConfig) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Get runtime info (status, tools) from getServersInfo
    const allServers = await getServersInfo();
    const serverInfo = allServers.find((s) => s.name === name);

    // Extract config without the name field
    const { name: serverName, ...config } = serverConfig;

    const response: ApiResponse = {
      success: true,
      data: {
        name: serverName,
        status: serverInfo?.status || 'disconnected',
        tools: serverInfo?.tools || [],
        config,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get server configuration:', error);
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

export const reloadServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    await reconnectServer(name);

    res.json({
      success: true,
      message: `Server ${name} reloaded successfully`,
    });
  } catch (error) {
    console.error('Failed to reload server:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reload server',
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

    const serverDao = getServerDao();
    const server = await serverDao.findById(serverName);

    if (!server) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Initialize tools config if it doesn't exist
    const tools = server.tools || {};

    // Set the tool's enabled state (preserve existing description if any)
    tools[toolName] = { ...tools[toolName], enabled };

    // Update via DAO (supports both file and database modes)
    const result = await serverDao.updateTools(serverName, tools);

    if (!result) {
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

    const serverDao = getServerDao();
    const server = await serverDao.findById(serverName);

    if (!server) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Initialize tools config if it doesn't exist
    const tools = server.tools || {};

    // Set the tool's description
    if (!tools[toolName]) {
      tools[toolName] = { enabled: true };
    }
    tools[toolName].description = description;

    // Update via DAO (supports both file and database modes)
    const result = await serverDao.updateTools(serverName, tools);

    if (!result) {
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

export const updateSystemConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      routing,
      install,
      smartRouting,
      mcpRouter,
      nameSeparator,
      enableSessionRebuild,
      oauthServer,
    } = req.body;

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

    const hasSessionRebuildUpdate = typeof enableSessionRebuild === 'boolean';

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

    // Get system config from DAO (supports both file and database modes)
    const systemConfigDao = getSystemConfigDao();
    let systemConfig = await systemConfigDao.get();

    if (!systemConfig) {
      systemConfig = {
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

    if (!systemConfig.routing) {
      systemConfig.routing = {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: false,
        bearerAuthKey: '',
        skipAuth: false,
      };
    }

    if (!systemConfig.install) {
      systemConfig.install = {
        pythonIndexUrl: '',
        npmRegistry: '',
        baseUrl: 'http://localhost:3000',
      };
    }

    if (!systemConfig.smartRouting) {
      systemConfig.smartRouting = {
        enabled: false,
        dbUrl: '',
        openaiApiBaseUrl: '',
        openaiApiKey: '',
        openaiApiEmbeddingModel: '',
      };
    }

    if (!systemConfig.mcpRouter) {
      systemConfig.mcpRouter = {
        apiKey: '',
        referer: 'https://www.mcphubx.com',
        title: 'MCPHub',
        baseUrl: 'https://api.mcprouter.to/v1',
      };
    }

    if (!systemConfig.oauthServer) {
      systemConfig.oauthServer = cloneDefaultOAuthServerConfig();
    }

    if (!systemConfig.oauthServer.dynamicRegistration) {
      const defaultConfig = cloneDefaultOAuthServerConfig();
      const defaultDynamic = defaultConfig.dynamicRegistration ?? {
        enabled: false,
        allowedGrantTypes: [],
        requiresAuthentication: false,
      };
      systemConfig.oauthServer.dynamicRegistration = {
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
        systemConfig.routing.enableGlobalRoute = routing.enableGlobalRoute;
      }

      if (typeof routing.enableGroupNameRoute === 'boolean') {
        systemConfig.routing.enableGroupNameRoute = routing.enableGroupNameRoute;
      }

      if (typeof routing.enableBearerAuth === 'boolean') {
        systemConfig.routing.enableBearerAuth = routing.enableBearerAuth;
      }

      if (typeof routing.bearerAuthKey === 'string') {
        systemConfig.routing.bearerAuthKey = routing.bearerAuthKey;
      }

      if (typeof routing.skipAuth === 'boolean') {
        systemConfig.routing.skipAuth = routing.skipAuth;
      }
    }

    if (install) {
      if (typeof install.pythonIndexUrl === 'string') {
        systemConfig.install.pythonIndexUrl = install.pythonIndexUrl;
      }
      if (typeof install.npmRegistry === 'string') {
        systemConfig.install.npmRegistry = install.npmRegistry;
      }
      if (typeof install.baseUrl === 'string') {
        systemConfig.install.baseUrl = install.baseUrl;
      }
    }

    // Track smartRouting state and configuration changes
    const wasSmartRoutingEnabled = systemConfig.smartRouting.enabled || false;
    const previousSmartRoutingConfig = { ...systemConfig.smartRouting };
    let needsSync = false;

    if (smartRouting) {
      if (typeof smartRouting.enabled === 'boolean') {
        // If enabling Smart Routing, validate required fields
        if (smartRouting.enabled) {
          const currentDbUrl =
            process.env.DB_URL || smartRouting.dbUrl || systemConfig.smartRouting.dbUrl;
          const currentOpenaiApiKey =
            smartRouting.openaiApiKey || systemConfig.smartRouting.openaiApiKey;

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
        systemConfig.smartRouting.enabled = smartRouting.enabled;
      }
      if (typeof smartRouting.dbUrl === 'string') {
        systemConfig.smartRouting.dbUrl = smartRouting.dbUrl;
      }
      if (typeof smartRouting.openaiApiBaseUrl === 'string') {
        systemConfig.smartRouting.openaiApiBaseUrl = smartRouting.openaiApiBaseUrl;
      }
      if (typeof smartRouting.openaiApiKey === 'string') {
        systemConfig.smartRouting.openaiApiKey = smartRouting.openaiApiKey;
      }
      if (typeof smartRouting.openaiApiEmbeddingModel === 'string') {
        systemConfig.smartRouting.openaiApiEmbeddingModel = smartRouting.openaiApiEmbeddingModel;
      }

      // Check if we need to sync embeddings
      const isNowEnabled = systemConfig.smartRouting.enabled || false;
      const hasConfigChanged =
        previousSmartRoutingConfig.dbUrl !== systemConfig.smartRouting.dbUrl ||
        previousSmartRoutingConfig.openaiApiBaseUrl !==
          systemConfig.smartRouting.openaiApiBaseUrl ||
        previousSmartRoutingConfig.openaiApiKey !== systemConfig.smartRouting.openaiApiKey ||
        previousSmartRoutingConfig.openaiApiEmbeddingModel !==
          systemConfig.smartRouting.openaiApiEmbeddingModel;

      // Sync if: first time enabling OR smart routing is enabled and any config changed
      needsSync = (!wasSmartRoutingEnabled && isNowEnabled) || (isNowEnabled && hasConfigChanged);
    }

    if (mcpRouter) {
      if (typeof mcpRouter.apiKey === 'string') {
        systemConfig.mcpRouter.apiKey = mcpRouter.apiKey;
      }
      if (typeof mcpRouter.referer === 'string') {
        systemConfig.mcpRouter.referer = mcpRouter.referer;
      }
      if (typeof mcpRouter.title === 'string') {
        systemConfig.mcpRouter.title = mcpRouter.title;
      }
      if (typeof mcpRouter.baseUrl === 'string') {
        systemConfig.mcpRouter.baseUrl = mcpRouter.baseUrl;
      }
    }

    if (oauthServer) {
      const target = systemConfig.oauthServer;
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
      systemConfig.nameSeparator = nameSeparator;
    }

    if (typeof enableSessionRebuild === 'boolean') {
      systemConfig.enableSessionRebuild = enableSessionRebuild;
    }

    // Save using DAO (supports both file and database modes)
    try {
      await systemConfigDao.update(systemConfig);
      res.json({
        success: true,
        data: systemConfig,
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
    } catch (saveError) {
      console.error('Failed to save system configuration:', saveError);
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

    const serverDao = getServerDao();
    const server = await serverDao.findById(serverName);

    if (!server) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Initialize prompts config if it doesn't exist
    const prompts = server.prompts || {};

    // Set the prompt's enabled state (preserve existing description if any)
    prompts[promptName] = { ...prompts[promptName], enabled };

    // Update via DAO (supports both file and database modes)
    const result = await serverDao.updatePrompts(serverName, prompts);

    if (!result) {
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

    const serverDao = getServerDao();
    const server = await serverDao.findById(serverName);

    if (!server) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    // Initialize prompts config if it doesn't exist
    const prompts = server.prompts || {};

    // Set the prompt's description
    if (!prompts[promptName]) {
      prompts[promptName] = { enabled: true };
    }
    prompts[promptName].description = description;

    // Update via DAO (supports both file and database modes)
    const result = await serverDao.updatePrompts(serverName, prompts);

    if (!result) {
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
