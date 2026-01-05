/**
 * Smart Routing Service
 *
 * This service handles the $smart routing functionality, which provides
 * AI-powered tool discovery using vector semantic search.
 */

import { Tool, ServerInfo } from '../types/index.js';
import { getServersInGroup } from './groupService.js';
import { searchToolsByVector } from './vectorSearchService.js';
import { getSmartRoutingConfig } from '../utils/smartRouting.js';
import { getServerDao } from '../dao/index.js';
import { getGroup } from './sseService.js';

// Reference to serverInfos from mcpService - will be set via init
let serverInfosRef: ServerInfo[] = [];
let getServerInfosFn: () => ServerInfo[] = () => serverInfosRef;
let filterToolsByConfigFn: (serverName: string, tools: Tool[]) => Promise<Tool[]>;
let filterToolsByGroupFn: (
  group: string | undefined,
  serverName: string,
  tools: Tool[],
) => Promise<Tool[]>;

/**
 * Initialize the smart routing service with references to mcpService functions
 */
export const initSmartRoutingService = (
  getServerInfos: () => ServerInfo[],
  filterToolsByConfig: (serverName: string, tools: Tool[]) => Promise<Tool[]>,
  filterToolsByGroup: (
    group: string | undefined,
    serverName: string,
    tools: Tool[],
  ) => Promise<Tool[]>,
) => {
  // Store the getter to avoid stale references while staying ESM-safe
  getServerInfosFn = getServerInfos;
  serverInfosRef = getServerInfos();
  filterToolsByConfigFn = filterToolsByConfig;
  filterToolsByGroupFn = filterToolsByGroup;
};

/**
 * Get current server infos (refreshed each call)
 */
const getServerInfos = (): ServerInfo[] => {
  return getServerInfosFn();
};

/**
 * Helper function to clean $schema field from inputSchema
 */
const cleanInputSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const cleanedSchema = { ...schema };
  delete cleanedSchema.$schema;

  return cleanedSchema;
};

/**
 * Generate the list of smart routing tools based on configuration
 */
export const getSmartRoutingTools = async (
  group: string | undefined,
): Promise<{ tools: any[] }> => {
  // Extract target group if pattern is $smart/{group}
  const targetGroup = group?.startsWith('$smart/') ? group.substring(7) : undefined;

  // Get smart routing config to check progressive disclosure setting
  const smartRoutingConfig = await getSmartRoutingConfig();
  const progressiveDisclosure = smartRoutingConfig.progressiveDisclosure ?? false;

  // Get info about available servers, filtered by target group if specified
  let availableServers = getServerInfos().filter(
    (server) => server.status === 'connected' && server.enabled !== false,
  );

  // If a target group is specified, filter servers to only those in the group
  if (targetGroup) {
    const serversInGroup = await getServersInGroup(targetGroup);
    if (serversInGroup && serversInGroup.length > 0) {
      availableServers = availableServers.filter((server) => serversInGroup.includes(server.name));
    }
  }

  // Create simple server information with only server names
  const serversList = availableServers
    .map((server) => {
      return `${server.name}`;
    })
    .join(', ');

  const scopeDescription = targetGroup
    ? `servers in the "${targetGroup}" group`
    : 'all available servers';

  // Base tools that are always available
  const tools: any[] = [];

  if (progressiveDisclosure) {
    // Progressive disclosure mode: search_tools returns minimal info,
    // describe_tool provides full schema
    tools.push(
      {
        name: 'search_tools',
        description: `STEP 1 of 3: Use this tool FIRST to discover and search for relevant tools across ${scopeDescription}. Returns tool names and descriptions only - use describe_tool to get full parameter details before calling.

For optimal results, use specific queries matching your exact needs. Call this tool multiple times with different queries for different parts of complex tasks. Example queries: "image generation tools", "code review tools", "data analysis", "translation capabilities", etc. Results are sorted by relevance using vector similarity.

Workflow: search_tools → describe_tool (for parameter details) → call_tool (to execute)

Available servers: ${serversList}`,
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'The search query to find relevant tools. Be specific and descriptive about the task you want to accomplish.',
            },
            limit: {
              type: 'integer',
              description:
                'Maximum number of results to return. Use higher values (20-30) for broad searches and lower values (5-10) for specific searches.',
              default: 10,
            },
          },
          required: ['query'],
        },
        annotations: {
          title: 'Search Tools',
          readOnlyHint: true,
        },
      },
      {
        name: 'describe_tool',
        description:
          'STEP 2 of 3: Use this tool AFTER search_tools to get the full parameter schema for a specific tool. This provides the complete inputSchema needed to correctly invoke the tool with call_tool.\n\nWorkflow: search_tools → describe_tool → call_tool',
        inputSchema: {
          type: 'object',
          properties: {
            toolName: {
              type: 'string',
              description: 'The exact name of the tool to describe (from search_tools results)',
            },
          },
          required: ['toolName'],
        },
        annotations: {
          title: 'Describe Tool',
          readOnlyHint: true,
        },
      },
      {
        name: 'call_tool',
        description:
          "STEP 3 of 3: Use this tool AFTER describe_tool to actually execute/invoke any tool you found. This is the execution step.\n\nWorkflow: search_tools → describe_tool → call_tool with the chosen tool name and required arguments.\n\nIMPORTANT: Always use describe_tool first to get the tool's inputSchema before invoking to ensure you provide the correct arguments.",
        inputSchema: {
          type: 'object',
          properties: {
            toolName: {
              type: 'string',
              description: 'The exact name of the tool to invoke (from search_tools results)',
            },
            arguments: {
              type: 'object',
              description:
                'The arguments to pass to the tool based on its inputSchema from describe_tool (optional if tool requires no arguments)',
            },
          },
          required: ['toolName'],
        },
        annotations: {
          title: 'Call Tool',
          openWorldHint: true,
        },
      },
    );
  } else {
    // Standard mode: search_tools returns full schema
    tools.push(
      {
        name: 'search_tools',
        description: `STEP 1 of 2: Use this tool FIRST to discover and search for relevant tools across ${scopeDescription}. This tool and call_tool work together as a two-step process: 1) search_tools to find what you need, 2) call_tool to execute it.

For optimal results, use specific queries matching your exact needs. Call this tool multiple times with different queries for different parts of complex tasks. Example queries: "image generation tools", "code review tools", "data analysis", "translation capabilities", etc. Results are sorted by relevance using vector similarity.

After finding relevant tools, you MUST use the call_tool to actually execute them. The search_tools only finds tools - it doesn't execute them.

Available servers: ${serversList}`,
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'The search query to find relevant tools. Be specific and descriptive about the task you want to accomplish.',
            },
            limit: {
              type: 'integer',
              description:
                'Maximum number of results to return. Use higher values (20-30) for broad searches and lower values (5-10) for specific searches.',
              default: 10,
            },
          },
          required: ['query'],
        },
        annotations: {
          title: 'Search Tools',
          readOnlyHint: true,
        },
      },
      {
        name: 'call_tool',
        description:
          "STEP 2 of 2: Use this tool AFTER search_tools to actually execute/invoke any tool you found. This is the execution step - search_tools finds tools, call_tool runs them.\n\nWorkflow: search_tools → examine results → call_tool with the chosen tool name and required arguments.\n\nIMPORTANT: Always check the tool's inputSchema from search_tools results before invoking to ensure you provide the correct arguments. The search results will show you exactly what parameters each tool expects.",
        inputSchema: {
          type: 'object',
          properties: {
            toolName: {
              type: 'string',
              description: 'The exact name of the tool to invoke (from search_tools results)',
            },
            arguments: {
              type: 'object',
              description:
                'The arguments to pass to the tool based on its inputSchema (optional if tool requires no arguments)',
            },
          },
          required: ['toolName'],
        },
        annotations: {
          title: 'Call Tool',
          openWorldHint: true,
        },
      },
    );
  }

  return { tools };
};

/**
 * Handle the search_tools request for smart routing
 */
export const handleSearchToolsRequest = async (
  query: string,
  limit: number,
  sessionId: string,
): Promise<any> => {
  if (!query || typeof query !== 'string') {
    throw new Error('Query parameter is required and must be a string');
  }

  const limitNum = Math.min(Math.max(parseInt(String(limit)) || 10, 1), 100);

  // Dynamically adjust threshold based on query characteristics
  let thresholdNum = 0.3; // Default threshold

  // For more general queries, use a lower threshold to get more diverse results
  if (query.length < 10 || query.split(' ').length <= 2) {
    thresholdNum = 0.2;
  }

  // For very specific queries, use a higher threshold for more precise results
  if (query.length > 30 || query.includes('specific') || query.includes('exact')) {
    thresholdNum = 0.4;
  }

  console.log(`Using similarity threshold: ${thresholdNum} for query: "${query}"`);

  // Determine server filtering based on group
  let group = getGroup(sessionId);
  let servers: string[] | undefined = undefined; // No server filtering by default

  // If group is in format $smart/{group}, filter servers to that group
  if (group?.startsWith('$smart/')) {
    const targetGroup = group.substring(7);
    if (targetGroup) {
      group = targetGroup;
    }
    const serversInGroup = await getServersInGroup(targetGroup);
    if (serversInGroup !== undefined && serversInGroup !== null) {
      servers = serversInGroup;
      if (servers && servers.length > 0) {
        console.log(`Filtering search to servers in group "${targetGroup}": ${servers.join(', ')}`);
      } else {
        console.log(`Group "${targetGroup}" has no servers, search will return no results`);
      }
    }
  }

  const searchResults = await searchToolsByVector(query, limitNum, thresholdNum, servers);
  console.log(`Search results: ${JSON.stringify(searchResults)}`);

  // Get smart routing config to check progressive disclosure setting
  const smartRoutingConfig = await getSmartRoutingConfig();
  const progressiveDisclosure = smartRoutingConfig.progressiveDisclosure ?? false;

  // Find actual tool information from serverInfos by serverName and toolName
  const resolvedTools = await Promise.all(
    searchResults.map(async (result) => {
      // Find the server in serverInfos
      const server = getServerInfos().find(
        (serverInfo) =>
          serverInfo.name === result.serverName &&
          serverInfo.status === 'connected' &&
          serverInfo.enabled !== false,
      );
      if (server && server.tools && server.tools.length > 0) {
        // Find the tool in server.tools
        const actualTool = server.tools.find((tool) => tool.name === result.toolName);
        if (actualTool) {
          // Check if the tool is enabled in configuration
          const tools = await filterToolsByConfigFn(server.name, [actualTool]);
          if (tools.length > 0) {
            // Apply custom description from configuration
            const serverConfig = await getServerDao().findById(server.name);
            const toolConfig = serverConfig?.tools?.[actualTool.name];

            // Return the actual tool info from serverInfos with custom description
            if (progressiveDisclosure) {
              // Progressive disclosure: return only name and description
              return {
                name: actualTool.name,
                description: toolConfig?.description || actualTool.description,
                serverName: result.serverName,
              };
            } else {
              // Standard mode: return full tool info
              return {
                ...actualTool,
                description: toolConfig?.description || actualTool.description,
                serverName: result.serverName,
              };
            }
          }
        }
      }

      // Fallback to search result if server or tool not found or disabled
      if (progressiveDisclosure) {
        return {
          name: result.toolName,
          description: result.description || '',
          serverName: result.serverName,
        };
      } else {
        return {
          name: result.toolName,
          description: result.description || '',
          inputSchema: cleanInputSchema(result.inputSchema || {}),
          serverName: result.serverName,
        };
      }
    }),
  );

  // Filter the resolved tools
  const filterResults = await Promise.all(
    resolvedTools.map(async (tool) => {
      if (tool.name) {
        const serverName = tool.serverName;
        if (serverName) {
          let tools = await filterToolsByConfigFn(serverName, [tool as Tool]);
          if (tools.length === 0) {
            return false;
          }

          tools = await filterToolsByGroupFn(group, serverName, tools);
          return tools.length > 0;
        }
      }
      return true;
    }),
  );
  const tools = resolvedTools.filter((_, i) => filterResults[i]);

  // Build response based on mode
  let guideline: string;
  let nextSteps: string;

  if (progressiveDisclosure) {
    guideline =
      tools.length > 0
        ? "Found relevant tools. Use describe_tool to get the full parameter schema before calling. If these tools don't match exactly what you need, try another search with more specific keywords."
        : 'No tools found. Try broadening your search or using different keywords.';
    nextSteps =
      tools.length > 0
        ? 'Use describe_tool with the toolName to get the full inputSchema, then use call_tool to execute.'
        : 'Consider searching for related capabilities or more general terms.';
  } else {
    guideline =
      tools.length > 0
        ? "Found relevant tools. If these tools don't match exactly what you need, try another search with more specific keywords."
        : 'No tools found. Try broadening your search or using different keywords.';
    nextSteps =
      tools.length > 0
        ? 'To use a tool, call call_tool with the toolName and required arguments.'
        : 'Consider searching for related capabilities or more general terms.';
  }

  const response = {
    tools,
    metadata: {
      query: query,
      threshold: thresholdNum,
      totalResults: tools.length,
      progressiveDisclosure,
      guideline,
      nextSteps,
    },
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response),
      },
    ],
  };
};

/**
 * Handle the describe_tool request for smart routing (progressive disclosure mode)
 */
export const handleDescribeToolRequest = async (
  toolName: string,
  sessionId: string,
): Promise<any> => {
  if (!toolName || typeof toolName !== 'string') {
    throw new Error('toolName parameter is required and must be a string');
  }

  console.log(`Handling describe_tool request for: ${toolName}`);

  // Determine group filtering
  let group = getGroup(sessionId);
  if (group?.startsWith('$smart/')) {
    group = group.substring(7);
  }

  // Find the tool across all connected servers
  for (const serverInfo of getServerInfos()) {
    if (serverInfo.status !== 'connected' || serverInfo.enabled === false) {
      continue;
    }

    // Check if this server has the tool
    const tool = serverInfo.tools?.find((t) => t.name === toolName);
    if (!tool) {
      continue;
    }

    // Check if the tool is enabled in configuration
    const tools = await filterToolsByConfigFn(serverInfo.name, [tool]);
    if (tools.length === 0) {
      continue;
    }

    // Apply group filtering if applicable
    if (group) {
      const filteredTools = await filterToolsByGroupFn(group, serverInfo.name, tools);
      if (filteredTools.length === 0) {
        continue;
      }
    }

    // Get custom description from configuration
    const serverConfig = await getServerDao().findById(serverInfo.name);
    const toolConfig = serverConfig?.tools?.[tool.name];

    // Return full tool information
    const toolInfo = {
      name: tool.name,
      description: toolConfig?.description || tool.description,
      inputSchema: cleanInputSchema(tool.inputSchema),
      serverName: serverInfo.name,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            tool: toolInfo,
            metadata: {
              message: `Full schema for tool '${toolName}'. Use call_tool with the toolName and arguments based on the inputSchema.`,
            },
          }),
        },
      ],
    };
  }

  // Tool not found
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: `Tool '${toolName}' not found or not available`,
          metadata: {
            message:
              'The specified tool was not found. Use search_tools to discover available tools.',
          },
        }),
      },
    ],
    isError: true,
  };
};

/**
 * Check if the given group is a smart routing group
 */
export const isSmartRoutingGroup = (group: string | undefined): boolean => {
  return group === '$smart' || (group?.startsWith('$smart/') ?? false);
};
