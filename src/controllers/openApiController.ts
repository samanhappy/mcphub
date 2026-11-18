import { Request, RequestHandler, Response } from 'express';
import { dump as dumpYaml } from 'js-yaml';
import { OpenAPIV3 } from 'openapi-types';
import {
  generateOpenAPISpec,
  getAvailableServers,
  getToolStats,
  getScopedOpenAPITools,
  OpenAPIRouteScope,
  OpenAPIGenerationOptions,
} from '../services/openApiGeneratorService.js';
import { getServerByName, getServersInfo, handleCallToolRequest } from '../services/mcpService.js';
import { getGroupByIdOrName } from '../services/groupService.js';
import config, { getNameSeparator } from '../config/index.js';
import { convertParametersToTypes } from '../utils/parameterConversion.js';
import { logger } from '../utils/logger.js';
import { isReservedStagingName } from '../services/fileStaging/tools.js';
import { getServerDao, getSystemConfigDao } from '../dao/index.js';
import { findBearerScopeGroup, validateBearerAuth } from '../services/sseService.js';
import { UserContextService } from '../services/userContextService.js';
import { RequestContextService } from '../services/requestContextService.js';
import { withRequestServers } from '../services/mcpRequestScope.js';
import { getDataService } from '../services/services.js';
import { canAccessGroupRoute } from '../utils/groupAccess.js';
import { normalizeToolNameForServer } from '../utils/mcpRouteNames.js';
import { getToolPolicy } from '../services/toolPolicyService.js';

/**
 * Controller for OpenAPI generation endpoints
 * Provides OpenAPI specifications for MCP tools to enable OpenWebUI integration
 */

const isYamlSpecRequest = (req: Request): boolean => req.path.toLowerCase().endsWith('.yaml');

const setOpenAPISpecHeaders = (
  res: Response,
  contentType: 'application/json' | 'application/yaml',
): void => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

const sendOpenAPISpec = (req: Request, res: Response, openApiSpec: OpenAPIV3.Document): void => {
  if (isYamlSpecRequest(req)) {
    setOpenAPISpecHeaders(res, 'application/yaml');
    res.send(dumpYaml(openApiSpec, { noRefs: true, lineWidth: -1 }));
    return;
  }

  setOpenAPISpecHeaders(res, 'application/json');
  res.json(openApiSpec);
};

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

    sendOpenAPISpec(req, res, openApiSpec);
  } catch (error) {
    logger.error('Error generating OpenAPI specification:', error);
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
    logger.error('Error getting available servers:', error);
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
    logger.error('Error getting tool statistics:', error);
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

    // Hub built-ins are MCP-only in PR1; the OpenAPI surface is a dashboard
    // integration and must not mint staging capabilities.
    if (isReservedStagingName(toolName)) {
      res.status(400).json({ success: false, message: 'Unknown tool' });
      return;
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
    logger.error('Error executing tool via OpenAPI:', error);
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

    sendOpenAPISpec(req, res, openApiSpec);
  } catch (error) {
    logger.error('Error generating server OpenAPI specification:', error);
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
    const group = await getGroupByIdOrName(name);
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

    sendOpenAPISpec(req, res, openApiSpec);
  } catch (error) {
    logger.error('Error generating group OpenAPI specification:', error);
    res.status(500).json({
      error: 'Failed to generate group OpenAPI specification',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

const withOpenAPIRoute =
  (
    handler: (req: Request, res: Response, scope: OpenAPIRouteScope) => Promise<void>,
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      const routeName = req.params.group;
      const group = routeName ? await findBearerScopeGroup(routeName) : null;
      const auth = await validateBearerAuth(req, group);
      if (!auth.valid) {
        if (auth.reason === 'unavailable') res.setHeader('Retry-After', '30');
        const status =
          auth.reason === 'unavailable' ? 503 : auth.reason === 'forbidden' ? 403 : 401;
        res.status(status).json({ error: 'OpenAPI authentication failed' });
        return;
      }

      const routing = (await getSystemConfigDao().get())?.routing;
      if (!routeName && routing?.enableGlobalRoute === false) {
        res.status(403).json({ error: 'Global routes are disabled' });
        return;
      }
      if (
        group &&
        (!canAccessGroupRoute(group, auth.user) ||
          (group.id !== routeName && routing?.enableGroupNameRoute === false))
      ) {
        res.status(403).json({ error: 'Group access denied' });
        return;
      }

      const members =
        group &&
        new Set(group.servers.map((entry) => (typeof entry === 'string' ? entry : entry.name)));
      const excluded = new Set(auth.excludedServerNames);
      const visible = getDataService().filterData(await getServerDao().findAll(), auth.user);
      const serverNames = new Set<string>(
        visible
          .filter(
            (server) =>
              server.enabled !== false &&
              !excluded.has(server.name) &&
              (members ? members.has(server.name) : !routeName || server.name === routeName),
          )
          .map((server) => server.name),
      );
      if (routeName && !group && !serverNames.has(routeName)) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const contexts = RequestContextService.getInstance();
      await UserContextService.getInstance().runWithContext(
        () =>
          contexts.runWithRequestContext(req, async () => {
            contexts.setBearerKeyContext(auth.keyId, auth.keyName);
            contexts.setKeyKindContext(auth.kind);
            contexts.setBearerKeyExclusions(auth.excludedServerNames);
            contexts.setHostedAuthContext(auth.hostedAuth);
            contexts.setUsernameContext(auth.user?.username);
            // REST requests never inherit a route or session from the MCP transport.
            contexts.setGroupContext('');
            const context = contexts.getRequestContext()!;
            context.stateless = true;
            context.sessionId = undefined;
            const policy = await getToolPolicy(undefined, group?.id);
            await handler(req, res, { serverNames, group, routeName, policy });
          }),
        auth.user ?? null,
      );
    } catch (error) {
      next(error);
    }
  };

export const getScopedOpenAPISpec = withOpenAPIRoute(async (req, res, scope) => {
  const routeLabel = scope.group?.name ?? scope.routeName;
  const options: OpenAPIGenerationOptions = {
    scope,
    title:
      typeof req.query.title === 'string'
        ? req.query.title
        : routeLabel
          ? `${routeLabel} MCP API`
          : undefined,
    description: typeof req.query.description === 'string' ? req.query.description : undefined,
    version: typeof req.query.version === 'string' ? req.query.version : undefined,
    serverUrl: typeof req.query.serverUrl === 'string' ? req.query.serverUrl : undefined,
    serverFilter: typeof req.query.servers === 'string' ? req.query.servers.split(',') : undefined,
  };
  if (!scope.routeName && typeof req.query.group === 'string') {
    options.groupFilter = req.query.group;
  }
  sendOpenAPISpec(req, res, await generateOpenAPISpec(options));
});

export const executeScopedOpenAPITool = withOpenAPIRoute(async (req, res, scope) => {
  // Express also dispatches HEAD to GET handlers unless a HEAD route matches first.
  if (req.method === 'HEAD') {
    res.setHeader('Allow', 'GET, POST');
    res.sendStatus(405);
    return;
  }
  if (config.readonly && req.method === 'POST') {
    res.status(403).json({ error: 'POST is disabled in read-only mode' });
    return;
  }
  const { serverName, toolName } = req.params;
  const runtime = scope.serverNames.has(serverName) ? getServerByName(serverName) : undefined;
  const server = runtime && (await getServersInfo()).find((info) => info.name === serverName);
  const tools = server ? getScopedOpenAPITools(scope, serverName, server.tools) : [];
  const tool = tools.find(
    (entry) => normalizeToolNameForServer(serverName, entry.name) === toolName,
  );
  if (!runtime || !tool) {
    res.status(404).json({ error: 'Tool not found' });
    return;
  }

  const args = req.method === 'GET' ? req.query : req.body || {};
  const result = await withRequestServers([runtime], () =>
    handleCallToolRequest(
      { params: { name: tool.name, arguments: convertParametersToTypes(args, tool.inputSchema) } },
      { server: serverName, headers: req.headers },
      scope.group?.id,
    ),
  );
  res.json(result);
});
