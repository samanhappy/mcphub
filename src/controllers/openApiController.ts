import { Request, Response } from 'express';
import {
  generateOpenAPISpec,
  getAvailableServers,
  getToolStats,
  OpenAPIGenerationOptions,
} from '../services/openApiGeneratorService.js';
import { getServerByName } from '../services/mcpService.js';
import { getGroupByIdOrName } from '../services/groupService.js';
import { getNameSeparator } from '../config/index.js';
import { convertParametersToTypes } from '../utils/parameterConversion.js';

/**
 * Controller for OpenAPI generation endpoints
 * Provides OpenAPI specifications for MCP tools to enable OpenWebUI integration
 */

/**
 * Generate and return OpenAPI specification
 * GET /api/openapi.json
 */
export const getOpenAPISpec = async (req: Request, res: Response): Promise<void> => {
  try {
    const options: OpenAPIGenerationOptions = {
      title: req.query.title as string,
      description: req.query.description as string,
      version: req.query.version as string,
      serverUrl: req.query.serverUrl as string,
      includeDisabledTools: req.query.includeDisabled === 'true',
      groupFilter: req.query.group as string,
      serverFilter: req.query.servers ? (req.query.servers as string).split(',') : undefined,
    };

    const openApiSpec = await generateOpenAPISpec(options);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    res.json(openApiSpec);
  } catch (error) {
    console.error('Error generating OpenAPI specification:', error);
    res.status(500).json({
      error: 'Failed to generate OpenAPI specification',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get available servers for filtering
 * GET /api/openapi/servers
 */
export const getOpenAPIServers = async (req: Request, res: Response): Promise<void> => {
  try {
    const servers = await getAvailableServers();
    res.json({
      success: true,
      data: servers,
    });
  } catch (error) {
    console.error('Error getting available servers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get available servers',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get tool statistics
 * GET /api/openapi/stats
 */
export const getOpenAPIStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await getToolStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error getting tool statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get tool statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Execute tool via OpenAPI-compatible endpoint
 * This allows OpenWebUI to call MCP tools directly
 * POST /api/tools/:serverName/:toolName
 * GET /api/tools/:serverName/:toolName (for simple tools)
 */
export const executeToolViaOpenAPI = async (req: Request, res: Response): Promise<void> => {
  try {
    // Decode URL-encoded parameters to handle slashes in server/tool names
    const serverName = decodeURIComponent(req.params.serverName);
    let toolName = decodeURIComponent(req.params.toolName);

    // Import handleCallToolRequest function
    const { handleCallToolRequest } = await import('../services/mcpService.js');

    // Get the server info to access the tool's input schema
    const serverInfo = getServerByName(serverName);
    let inputSchema: Record<string, any> = {};

    if (serverInfo) {
      // Find the tool in the server's tools list
      const fullToolName = `${serverName}${getNameSeparator()}${toolName}`;
      const tool = serverInfo.tools.find(
        (t: any) => t.name === fullToolName || t.name === toolName,
      );
      if (tool) {
        toolName = tool.name; // Use the matched tool's actual name (with server prefix if applicable) for the subsequent call to handleCallToolRequest.
        if (tool.inputSchema) {
          inputSchema = tool.inputSchema as Record<string, any>;
        }
      }
    }

    // Prepare arguments from query params (GET) or body (POST)
    let args = req.method === 'GET' ? req.query : req.body || {};
    args = convertParametersToTypes(args, inputSchema);

    // Create a mock request structure that matches what handleCallToolRequest expects
    const mockRequest = {
      params: {
        name: toolName, // Just use the tool name without server prefix as it gets added by handleCallToolRequest
        arguments: args,
      },
    };

    const extra = {
      sessionId: (req.headers['x-session-id'] as string) || 'openapi-session',
      server: serverName,
      headers: req.headers, // Pass all request headers for potential passthrough
    };

    const result = await handleCallToolRequest(mockRequest, extra);

    // Return the result in OpenAPI format (matching MCP tool response structure)
    res.json(result);
  } catch (error) {
    console.error('Error executing tool via OpenAPI:', error);
    res.status(500).json({
      error: 'Failed to execute tool',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Generate and return OpenAPI specification for a specific server
 * GET /api/openapi/:name.json
 */
export const getServerOpenAPISpec = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;

    // Check if server exists
    const availableServers = await getAvailableServers();
    if (!availableServers.includes(name)) {
      res.status(404).json({
        error: 'Server not found',
        message: `Server '${name}' is not connected or does not exist`,
      });
      return;
    }

    const options: OpenAPIGenerationOptions = {
      title: (req.query.title as string) || `${name} MCP API`,
      description:
        (req.query.description as string) || `OpenAPI specification for ${name} MCP server tools`,
      version: req.query.version as string,
      serverUrl: req.query.serverUrl as string,
      includeDisabledTools: req.query.includeDisabled === 'true',
      serverFilter: [name], // Filter to only this server
    };

    const openApiSpec = await generateOpenAPISpec(options);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    res.json(openApiSpec);
  } catch (error) {
    console.error('Error generating server OpenAPI specification:', error);
    res.status(500).json({
      error: 'Failed to generate server OpenAPI specification',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Generate and return OpenAPI specification for a specific group
 * GET /api/openapi/group/:groupName.json
 */
export const getGroupOpenAPISpec = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;

    // Check if group exists
    const group = getGroupByIdOrName(name);
    if (!group) {
      getServerOpenAPISpec(req, res);
      return;
    }

    const options: OpenAPIGenerationOptions = {
      title: (req.query.title as string) || `${group.name} Group MCP API`,
      description:
        (req.query.description as string) || `OpenAPI specification for ${group.name} group tools`,
      version: req.query.version as string,
      serverUrl: req.query.serverUrl as string,
      includeDisabledTools: req.query.includeDisabled === 'true',
      groupFilter: name, // Use existing group filter functionality
    };

    const openApiSpec = await generateOpenAPISpec(options);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    res.json(openApiSpec);
  } catch (error) {
    console.error('Error generating group OpenAPI specification:', error);
    res.status(500).json({
      error: 'Failed to generate group OpenAPI specification',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
