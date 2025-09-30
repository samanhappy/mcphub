import { OpenAPIV3 } from 'openapi-types';
import { Tool } from '../types/index.js';
import { getServersInfo } from './mcpService.js';
import config from '../config/index.js';
import { loadSettings, getNameSeparator } from '../config/index.js';

/**
 * Service for generating OpenAPI 3.x specifications from MCP tools
 * This enables integration with OpenWebUI and other OpenAPI-compatible systems
 */

export interface OpenAPIGenerationOptions {
  title?: string;
  description?: string;
  version?: string;
  serverUrl?: string;
  includeDisabledTools?: boolean;
  groupFilter?: string;
  serverFilter?: string[];
}

/**
 * Convert MCP tool input schema to OpenAPI parameter or request body schema
 */
function convertToolSchemaToOpenAPI(tool: Tool): {
  parameters?: OpenAPIV3.ParameterObject[];
  requestBody?: OpenAPIV3.RequestBodyObject;
} {
  const schema = tool.inputSchema as any;

  if (!schema || typeof schema !== 'object') {
    return {};
  }

  // If schema has properties, convert them to parameters or request body
  if (schema.properties && typeof schema.properties === 'object') {
    const properties = schema.properties;
    const required = Array.isArray(schema.required) ? schema.required : [];

    // For simple tools with only primitive parameters, use query parameters
    const hasComplexTypes = Object.values(properties).some(
      (prop: any) =>
        prop.type === 'object' ||
        prop.type === 'array' ||
        (prop.type === 'string' && prop.enum && prop.enum.length > 10),
    );

    if (!hasComplexTypes && Object.keys(properties).length <= 10) {
      // Use query parameters for simple tools
      const parameters: OpenAPIV3.ParameterObject[] = Object.entries(properties).map(
        ([name, prop]: [string, any]) => ({
          name,
          in: 'query',
          required: required.includes(name),
          description: prop.description || `Parameter ${name}`,
          schema: {
            type: prop.type || 'string',
            ...(prop.enum && { enum: prop.enum }),
            ...(prop.default !== undefined && { default: prop.default }),
            ...(prop.format && { format: prop.format }),
          },
        }),
      );

      return { parameters };
    } else {
      // Use request body for complex tools
      const requestBody: OpenAPIV3.RequestBodyObject = {
        required: required.length > 0,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties,
              ...(required.length > 0 && { required }),
            },
          },
        },
      };

      return { requestBody };
    }
  }

  return {};
}

/**
 * Generate OpenAPI operation from MCP tool
 */
function generateOperationFromTool(tool: Tool, serverName: string): OpenAPIV3.OperationObject {
  const { parameters, requestBody } = convertToolSchemaToOpenAPI(tool);
  const operation: OpenAPIV3.OperationObject = {
    summary: tool.description || `Execute ${tool.name} tool`,
    description: tool.description || `Execute the ${tool.name} tool from ${serverName} server`,
    operationId: `${serverName}_${tool.name}`,
    tags: [serverName],
    ...(parameters && parameters.length > 0 && { parameters }),
    ...(requestBody && { requestBody }),
    responses: {
      '200': {
        description: 'Successful tool execution',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                content: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      text: { type: 'string' },
                    },
                  },
                },
                isError: { type: 'boolean' },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - invalid parameters',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };

  return operation;
}

/**
 * Generate OpenAPI specification from MCP tools
 */
export async function generateOpenAPISpec(
  options: OpenAPIGenerationOptions = {},
): Promise<OpenAPIV3.Document> {
  const serverInfos = await getServersInfo();

  // Filter servers based on options
  let filteredServers = serverInfos.filter(
    (server) =>
      server.status === 'connected' &&
      (!options.serverFilter || options.serverFilter.includes(server.name)),
  );

  // Apply group filter if specified
  const groupConfig: Map<string, string[] | 'all'> = new Map();
  if (options.groupFilter) {
    const { getGroupByIdOrName } = await import('./groupService.js');
    const group = getGroupByIdOrName(options.groupFilter);
    if (group) {
      // Extract server names and their tool configurations from group
      const groupServerNames: string[] = [];
      for (const server of group.servers) {
        if (typeof server === 'string') {
          groupServerNames.push(server);
          groupConfig.set(server, 'all');
        } else {
          groupServerNames.push(server.name);
          groupConfig.set(server.name, server.tools || 'all');
        }
      }
      // Filter to only servers in the group
      filteredServers = filteredServers.filter((server) => groupServerNames.includes(server.name));
    } else {
      // Group not found, return empty specification
      filteredServers = [];
    }
  }

  // Collect all tools from filtered servers
  const allTools: Array<{ tool: Tool; serverName: string }> = [];

  for (const serverInfo of filteredServers) {
    const tools = options.includeDisabledTools
      ? serverInfo.tools
      : serverInfo.tools.filter((tool) => tool.enabled !== false);

    // Apply group-specific tool filtering if group filter is specified
    let filteredTools = tools;
    if (options.groupFilter && groupConfig.has(serverInfo.name)) {
      const allowedTools = groupConfig.get(serverInfo.name);
      if (allowedTools !== 'all') {
        // Filter tools to only include those specified in the group configuration
        const separator = getNameSeparator();
        filteredTools = tools.filter(
          (tool) =>
            Array.isArray(allowedTools) &&
            allowedTools.includes(tool.name.replace(serverInfo.name + separator, '')),
        );
      }
    }

    for (const tool of filteredTools) {
      allTools.push({ tool, serverName: serverInfo.name });
    }
  }

  // Generate paths from tools
  const paths: OpenAPIV3.PathsObject = {};

  for (const { tool, serverName } of allTools) {
    const operation = generateOperationFromTool(tool, serverName);
    const { requestBody } = convertToolSchemaToOpenAPI(tool);

    // Create path for the tool
    const pathName = `/tools/${serverName}/${tool.name}`;
    const method = requestBody ? 'post' : 'get';

    if (!paths[pathName]) {
      paths[pathName] = {};
    }

    paths[pathName][method] = operation;
  }

  const settings = loadSettings();
  // Get server URL
  const baseUrl =
    options.serverUrl ||
    settings.systemConfig?.install?.baseUrl ||
    `http://localhost:${config.port}`;
  const serverUrl = `${baseUrl}${config.basePath}/api`;

  // Generate OpenAPI document
  const openApiDoc: OpenAPIV3.Document = {
    openapi: '3.0.3',
    info: {
      title: options.title || 'MCPHub API',
      description:
        options.description ||
        'OpenAPI specification for MCP tools managed by MCPHub. This enables integration with OpenWebUI and other OpenAPI-compatible systems.',
      version: options.version || '1.0.0',
      contact: {
        name: 'MCPHub',
        url: 'https://github.com/samanhappy/mcphub',
      },
      license: {
        name: 'ISC',
        url: 'https://github.com/samanhappy/mcphub/blob/main/LICENSE',
      },
    },
    servers: [
      {
        url: serverUrl,
        description: 'MCPHub API Server',
      },
    ],
    paths,
    components: {
      schemas: {
        ToolResponse: {
          type: 'object',
          properties: {
            content: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  text: { type: 'string' },
                },
              },
            },
            isError: { type: 'boolean' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: filteredServers.map((server) => ({
      name: server.name,
      description: `Tools from ${server.name} server`,
    })),
  };

  return openApiDoc;
}

/**
 * Get available server names for filtering
 */
export async function getAvailableServers(): Promise<string[]> {
  const serverInfos = await getServersInfo();
  return serverInfos.filter((server) => server.status === 'connected').map((server) => server.name);
}

/**
 * Get statistics about available tools
 */
export async function getToolStats(): Promise<{
  totalServers: number;
  totalTools: number;
  serverBreakdown: Array<{ name: string; toolCount: number; status: string }>;
}> {
  const serverInfos = await getServersInfo();

  const serverBreakdown = serverInfos.map((server) => ({
    name: server.name,
    toolCount: server.tools.length,
    status: server.status,
  }));

  const totalTools = serverInfos
    .filter((server) => server.status === 'connected')
    .reduce((sum, server) => sum + server.tools.length, 0);

  return {
    totalServers: serverInfos.filter((server) => server.status === 'connected').length,
    totalTools,
    serverBreakdown,
  };
}
