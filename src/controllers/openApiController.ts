import { Request, Response } from 'express';
import {
  generateOpenAPISpec,
  getAvailableServers,
  getToolStats,
  OpenAPIGenerationOptions,
} from '../services/openApiGeneratorService.js';

/**
 * Controller for OpenAPI generation endpoints
 * Provides OpenAPI specifications for MCP tools to enable OpenWebUI integration
 */

/**
 * Generate and return OpenAPI specification
 * GET /api/openapi.json
 */
export const getOpenAPISpec = (req: Request, res: Response): void => {
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

    const openApiSpec = generateOpenAPISpec(options);

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
export const getOpenAPIServers = (req: Request, res: Response): void => {
  try {
    const servers = getAvailableServers();
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
export const getOpenAPIStats = (req: Request, res: Response): void => {
  try {
    const stats = getToolStats();
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
    const { serverName, toolName } = req.params;

    // Import handleCallToolRequest function
    const { handleCallToolRequest } = await import('../services/mcpService.js');

    // Prepare arguments from query params (GET) or body (POST)
    const args = req.method === 'GET' ? req.query : req.body || {};

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
