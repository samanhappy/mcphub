import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ServerInfo, ServerConfig, ToolInfo } from '../types/index.js';
import { loadSettings, saveSettings, expandEnvVars, replaceEnvVars } from '../config/index.js';
import config from '../config/index.js';
import { getGroup } from './sseService.js';
import { getServersInGroup } from './groupService.js';
import { saveToolsAsVectorEmbeddings, searchToolsByVector } from './vectorSearchService.js';

const servers: { [sessionId: string]: Server } = {};

export const initUpstreamServers = async (): Promise<void> => {
  await registerAllTools(true);
};

export const getMcpServer = (sessionId?: string, group?: string): Server => {
  if (!sessionId) {
    return createMcpServer(config.mcpHubName, config.mcpHubVersion, group);
  }

  if (!servers[sessionId]) {
    const serverGroup = group || getGroup(sessionId);
    const server = createMcpServer(config.mcpHubName, config.mcpHubVersion, serverGroup);
    servers[sessionId] = server;
  } else {
    console.log(`MCP server already exists for sessionId: ${sessionId}`);
  }
  return servers[sessionId];
};

export const deleteMcpServer = (sessionId: string): void => {
  delete servers[sessionId];
};

export const notifyToolChanged = async () => {
  await registerAllTools(false);
  Object.values(servers).forEach((server) => {
    server
      .sendToolListChanged()
      .catch((error) => {
        console.warn('Failed to send tool list changed notification:', error.message);
      })
      .then(() => {
        console.log('Tool list changed notification sent successfully');
      });
  });
};

export const syncToolEmbedding = async (serverName: string, toolName: string) => {
  const serverInfo = getServerByName(serverName);
  if (!serverInfo) {
    console.warn(`Server not found: ${serverName}`);
    return;
  }
  const tool = serverInfo.tools.find((t) => t.name === toolName);
  if (!tool) {
    console.warn(`Tool not found: ${toolName} on server: ${serverName}`);
    return;
  }
  // Save tool as vector embedding for search
  saveToolsAsVectorEmbeddings(serverName, [tool]);
};

// Store all server information
let serverInfos: ServerInfo[] = [];

// Initialize MCP server clients
export const initializeClientsFromSettings = (isInit: boolean): ServerInfo[] => {
  const settings = loadSettings();
  const existingServerInfos = serverInfos;
  serverInfos = [];

  for (const [name, conf] of Object.entries(settings.mcpServers)) {
    // Skip disabled servers
    if (conf.enabled === false) {
      console.log(`Skipping disabled server: ${name}`);
      serverInfos.push({
        name,
        status: 'disconnected',
        error: null,
        tools: [],
        createTime: Date.now(),
        enabled: false,
      });
      continue;
    }

    // Check if server is already connected
    const existingServer = existingServerInfos.find(
      (s) => s.name === name && s.status === 'connected',
    );
    if (existingServer) {
      serverInfos.push({
        ...existingServer,
        enabled: conf.enabled === undefined ? true : conf.enabled,
      });
      console.log(`Server '${name}' is already connected.`);
      continue;
    }

    let transport;
    if (conf.type === 'streamable-http') {
      const options: any = {};
      if (conf.headers && Object.keys(conf.headers).length > 0) {
        options.requestInit = {
          headers: conf.headers,
        };
      }
      transport = new StreamableHTTPClientTransport(new URL(conf.url || ''), options);
    } else if (conf.url) {
      // Default to SSE only when 'conf.type' is not specified and 'conf.url' is available
      const options: any = {};
      if (conf.headers && Object.keys(conf.headers).length > 0) {
        options.eventSourceInit = {
          headers: conf.headers,
        };
        options.requestInit = {
          headers: conf.headers,
        };
      }
      transport = new SSEClientTransport(new URL(conf.url), options);
    } else if (conf.command && conf.args) {
      // If type is stdio or if command and args are provided without type
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>), // Inherit all environment variables from parent process
        ...replaceEnvVars(conf.env || {}), // Override with configured env vars
      };
      env['PATH'] = expandEnvVars(process.env.PATH as string) || '';

      // Add UV_DEFAULT_INDEX from settings if available (for Python packages)
      const settings = loadSettings(); // Add UV_DEFAULT_INDEX from settings if available (for Python packages)
      if (
        settings.systemConfig?.install?.pythonIndexUrl &&
        (conf.command === 'uvx' || conf.command === 'uv' || conf.command === 'python')
      ) {
        env['UV_DEFAULT_INDEX'] = settings.systemConfig.install.pythonIndexUrl;
      }

      // Add npm_config_registry from settings if available (for NPM packages)
      if (
        settings.systemConfig?.install?.npmRegistry &&
        (conf.command === 'npm' ||
          conf.command === 'npx' ||
          conf.command === 'pnpm' ||
          conf.command === 'yarn' ||
          conf.command === 'node')
      ) {
        env['npm_config_registry'] = settings.systemConfig.install.npmRegistry;
      }

      transport = new StdioClientTransport({
        command: conf.command,
        args: conf.args,
        env: env,
        stderr: 'pipe',
      });
      transport.stderr?.on('data', (data) => {
        console.log(`[${name}] [child] ${data}`);
      });
    } else {
      console.warn(`Skipping server '${name}': missing required configuration`);
      serverInfos.push({
        name,
        status: 'disconnected',
        error: 'Missing required configuration',
        tools: [],
        createTime: Date.now(),
      });
      continue;
    }

    const client = new Client(
      {
        name: `mcp-client-${name}`,
        version: '1.0.0',
      },
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {},
        },
      },
    );
    const timeout = isInit ? Number(config.initTimeout) : Number(config.timeout);
    client
      .connect(transport, { timeout: timeout })
      .then(() => {
        console.log(`Successfully connected client for server: ${name}`);

        client
          .listTools({}, { timeout: timeout })
          .then((tools) => {
            console.log(`Successfully listed ${tools.tools.length} tools for server: ${name}`);
            const serverInfo = getServerByName(name);
            if (!serverInfo) {
              console.warn(`Server info not found for server: ${name}`);
              return;
            }

            serverInfo.tools = tools.tools.map((tool) => ({
              name: name + '/' + tool.name,
              description: tool.description || '',
              inputSchema: tool.inputSchema || {},
            }));
            serverInfo.status = 'connected';
            serverInfo.error = null;

            // Save tools as vector embeddings for search
            saveToolsAsVectorEmbeddings(name, serverInfo.tools);
          })
          .catch((error) => {
            console.error(
              `Failed to list tools for server ${name} by error: ${error} with stack: ${error.stack}`,
            );
            const serverInfo = getServerByName(name);
            if (serverInfo) {
              serverInfo.status = 'disconnected';
              serverInfo.error = `Failed to list tools: ${error.stack} `;
            }
          });
      })
      .catch((error) => {
        console.error(
          `Failed to connect client for server ${name} by error: ${error} with stack: ${error.stack}`,
        );
        const serverInfo = getServerByName(name);
        if (serverInfo) {
          serverInfo.status = 'disconnected';
          serverInfo.error = `Failed to connect: ${error.stack} `;
        }
      });
    serverInfos.push({
      name,
      status: 'connecting',
      error: null,
      tools: [],
      client,
      transport,
      createTime: Date.now(),
    });
    console.log(`Initialized client for server: ${name}`);
  }

  return serverInfos;
};

// Register all MCP tools
export const registerAllTools = async (isInit: boolean): Promise<void> => {
  initializeClientsFromSettings(isInit);
};

// Get all server information
export const getServersInfo = (): Omit<ServerInfo, 'client' | 'transport'>[] => {
  const settings = loadSettings();
  const infos = serverInfos.map(({ name, status, tools, createTime, error }) => {
    const serverConfig = settings.mcpServers[name];
    const enabled = serverConfig ? serverConfig.enabled !== false : true;

    // Add enabled status and custom description to each tool
    const toolsWithEnabled = tools.map((tool) => {
      const toolConfig = serverConfig?.tools?.[tool.name];
      return {
        ...tool,
        description: toolConfig?.description || tool.description, // Use custom description if available
        enabled: toolConfig?.enabled !== false, // Default to true if not explicitly disabled
      };
    });

    return {
      name,
      status,
      error,
      tools: toolsWithEnabled,
      createTime,
      enabled,
    };
  });
  infos.sort((a, b) => {
    if (a.enabled === b.enabled) return 0;
    return a.enabled ? -1 : 1;
  });
  return infos;
};

// Get server by name
const getServerByName = (name: string): ServerInfo | undefined => {
  return serverInfos.find((serverInfo) => serverInfo.name === name);
};

// Filter tools by server configuration
const filterToolsByConfig = (serverName: string, tools: ToolInfo[]): ToolInfo[] => {
  const settings = loadSettings();
  const serverConfig = settings.mcpServers[serverName];

  if (!serverConfig || !serverConfig.tools) {
    // If no tool configuration exists, all tools are enabled by default
    return tools;
  }

  return tools.filter((tool) => {
    const toolConfig = serverConfig.tools?.[tool.name];
    // If tool is not in config, it's enabled by default
    return toolConfig?.enabled !== false;
  });
};

// Get server by tool name
const getServerByTool = (toolName: string): ServerInfo | undefined => {
  return serverInfos.find((serverInfo) => serverInfo.tools.some((tool) => tool.name === toolName));
};

// Add new server
export const addServer = async (
  name: string,
  config: ServerConfig,
): Promise<{ success: boolean; message?: string }> => {
  try {
    const settings = loadSettings();
    if (settings.mcpServers[name]) {
      return { success: false, message: 'Server name already exists' };
    }

    settings.mcpServers[name] = config;
    if (!saveSettings(settings)) {
      return { success: false, message: 'Failed to save settings' };
    }

    return { success: true, message: 'Server added successfully' };
  } catch (error) {
    console.error(`Failed to add server: ${name}`, error);
    return { success: false, message: 'Failed to add server' };
  }
};

// Remove server
export const removeServer = (name: string): { success: boolean; message?: string } => {
  try {
    const settings = loadSettings();
    if (!settings.mcpServers[name]) {
      return { success: false, message: 'Server not found' };
    }

    delete settings.mcpServers[name];

    if (!saveSettings(settings)) {
      return { success: false, message: 'Failed to save settings' };
    }

    serverInfos = serverInfos.filter((serverInfo) => serverInfo.name !== name);
    return { success: true, message: 'Server removed successfully' };
  } catch (error) {
    console.error(`Failed to remove server: ${name}`, error);
    return { success: false, message: `Failed to remove server: ${error}` };
  }
};

// Update existing server
export const updateMcpServer = async (
  name: string,
  config: ServerConfig,
): Promise<{ success: boolean; message?: string }> => {
  try {
    const settings = loadSettings();
    if (!settings.mcpServers[name]) {
      return { success: false, message: 'Server not found' };
    }

    settings.mcpServers[name] = config;
    if (!saveSettings(settings)) {
      return { success: false, message: 'Failed to save settings' };
    }

    closeServer(name);

    serverInfos = serverInfos.filter((serverInfo) => serverInfo.name !== name);
    return { success: true, message: 'Server updated successfully' };
  } catch (error) {
    console.error(`Failed to update server: ${name}`, error);
    return { success: false, message: 'Failed to update server' };
  }
};

// Close server client and transport
function closeServer(name: string) {
  const serverInfo = serverInfos.find((serverInfo) => serverInfo.name === name);
  if (serverInfo && serverInfo.client && serverInfo.transport) {
    serverInfo.client.close();
    serverInfo.transport.close();
    console.log(`Closed client and transport for server: ${serverInfo.name}`);
    // TODO kill process
  }
}

// Toggle server enabled status
export const toggleServerStatus = async (
  name: string,
  enabled: boolean,
): Promise<{ success: boolean; message?: string }> => {
  try {
    const settings = loadSettings();
    if (!settings.mcpServers[name]) {
      return { success: false, message: 'Server not found' };
    }

    // Update the enabled status in settings
    settings.mcpServers[name].enabled = enabled;

    if (!saveSettings(settings)) {
      return { success: false, message: 'Failed to save settings' };
    }

    // If disabling, disconnect the server and remove from active servers
    if (!enabled) {
      closeServer(name);

      // Update the server info to show as disconnected and disabled
      const index = serverInfos.findIndex((s) => s.name === name);
      if (index !== -1) {
        serverInfos[index] = {
          ...serverInfos[index],
          status: 'disconnected',
          enabled: false,
        };
      }
    }

    return { success: true, message: `Server ${enabled ? 'enabled' : 'disabled'} successfully` };
  } catch (error) {
    console.error(`Failed to toggle server status: ${name}`, error);
    return { success: false, message: 'Failed to toggle server status' };
  }
};

export const handleListToolsRequest = async (_: any, extra: any) => {
  const sessionId = extra.sessionId || '';
  const group = getGroup(sessionId);
  console.log(`Handling ListToolsRequest for group: ${group}`);

  // Special handling for $smart group to return special tools
  if (group === '$smart') {
    return {
      tools: [
        {
          name: 'search_tools',
          description: (() => {
            // Get info about available servers
            const availableServers = serverInfos.filter(
              (server) => server.status === 'connected' && server.enabled !== false,
            );
            // Create simple server information with only server names
            const serversList = availableServers
              .map((server) => {
                return `${server.name}`;
              })
              .join(', ');
            return `STEP 1 of 2: Use this tool FIRST to discover and search for relevant tools across all available servers. This tool and call_tool work together as a two-step process: 1) search_tools to find what you need, 2) call_tool to execute it.

For optimal results, use specific queries matching your exact needs. Call this tool multiple times with different queries for different parts of complex tasks. Example queries: "image generation tools", "code review tools", "data analysis", "translation capabilities", etc. Results are sorted by relevance using vector similarity.

After finding relevant tools, you MUST use the call_tool to actually execute them. The search_tools only finds tools - it doesn't execute them.

Available servers: ${serversList}`;
          })(),
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
        },
      ],
    };
  }

  const allServerInfos = serverInfos.filter((serverInfo) => {
    if (serverInfo.enabled === false) return false;
    if (!group) return true;
    const serversInGroup = getServersInGroup(group);
    if (!serversInGroup || serversInGroup.length === 0) return serverInfo.name === group;
    return serversInGroup.includes(serverInfo.name);
  });

  const allTools = [];
  for (const serverInfo of allServerInfos) {
    if (serverInfo.tools && serverInfo.tools.length > 0) {
      // Filter tools based on server configuration and apply custom descriptions
      const enabledTools = filterToolsByConfig(serverInfo.name, serverInfo.tools);

      // Apply custom descriptions from configuration
      const settings = loadSettings();
      const serverConfig = settings.mcpServers[serverInfo.name];
      const toolsWithCustomDescriptions = enabledTools.map((tool) => {
        const toolConfig = serverConfig?.tools?.[tool.name];
        return {
          ...tool,
          description: toolConfig?.description || tool.description, // Use custom description if available
        };
      });

      allTools.push(...toolsWithCustomDescriptions);
    }
  }

  return {
    tools: allTools,
  };
};

export const handleCallToolRequest = async (request: any, extra: any) => {
  console.log(`Handling CallToolRequest for tool: ${JSON.stringify(request.params)}`);
  try {
    // Special handling for agent group tools
    if (request.params.name === 'search_tools') {
      const { query, limit = 10 } = request.params.arguments || {};

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
      const servers = undefined; // No server filtering

      const searchResults = await searchToolsByVector(query, limitNum, thresholdNum, servers);
      console.log(`Search results: ${JSON.stringify(searchResults)}`);
      // Find actual tool information from serverInfos by serverName and toolName
      const tools = searchResults
        .map((result) => {
          // Find the server in serverInfos
          const server = serverInfos.find(
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
              const enabledTools = filterToolsByConfig(server.name, [actualTool]);
              if (enabledTools.length > 0) {
                // Apply custom description from configuration
                const settings = loadSettings();
                const serverConfig = settings.mcpServers[server.name];
                const toolConfig = serverConfig?.tools?.[actualTool.name];

                // Return the actual tool info from serverInfos with custom description
                return {
                  ...actualTool,
                  description: toolConfig?.description || actualTool.description,
                };
              }
            }
          }

          // Fallback to search result if server or tool not found or disabled
          return {
            name: result.toolName,
            description: result.description || '',
            inputSchema: result.inputSchema || {},
          };
        })
        .filter((tool) => {
          // Additional filter to remove tools that are disabled
          if (tool.name) {
            const serverName = searchResults.find((r) => r.toolName === tool.name)?.serverName;
            if (serverName) {
              const enabledTools = filterToolsByConfig(serverName, [tool as ToolInfo]);
              return enabledTools.length > 0;
            }
          }
          return true; // Keep fallback results
        });

      // Add usage guidance to the response
      const response = {
        tools,
        metadata: {
          query: query,
          threshold: thresholdNum,
          totalResults: tools.length,
          guideline:
            tools.length > 0
              ? "Found relevant tools. If these tools don't match exactly what you need, try another search with more specific keywords."
              : 'No tools found. Try broadening your search or using different keywords.',
          nextSteps:
            tools.length > 0
              ? 'To use a tool, call call_tool with the toolName and required arguments.'
              : 'Consider searching for related capabilities or more general terms.',
        },
      };

      // Return in the same format as handleListToolsRequest
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response),
          },
        ],
      };
    }

    // Special handling for call_tool
    if (request.params.name === 'call_tool') {
      let { toolName, arguments: toolArgs = {} } = request.params.arguments || {};

      if (!toolName) {
        throw new Error('toolName parameter is required');
      }

      // arguments parameter is now optional

      let targetServerInfo: ServerInfo | undefined;
      if (extra && extra.server) {
        targetServerInfo = getServerByName(extra.server);
      } else {
        // Find the first server that has this tool
        targetServerInfo = serverInfos.find(
          (serverInfo) =>
            serverInfo.status === 'connected' &&
            serverInfo.enabled !== false &&
            serverInfo.tools.some((tool) => tool.name === toolName),
        );
      }

      if (!targetServerInfo) {
        throw new Error(`No available servers found with tool: ${toolName}`);
      }

      // Check if the tool exists on the server
      const toolExists = targetServerInfo.tools.some((tool) => tool.name === toolName);
      if (!toolExists) {
        throw new Error(`Tool '${toolName}' not found on server '${targetServerInfo.name}'`);
      }

      // Call the tool on the target server
      const client = targetServerInfo.client;
      if (!client) {
        throw new Error(`Client not found for server: ${targetServerInfo.name}`);
      }

      // Use toolArgs if it has properties, otherwise fallback to request.params.arguments
      const finalArgs =
        toolArgs && Object.keys(toolArgs).length > 0 ? toolArgs : request.params.arguments || {};

      console.log(
        `Invoking tool '${toolName}' on server '${targetServerInfo.name}' with arguments: ${JSON.stringify(finalArgs)}`,
      );

      toolName = toolName.startsWith(`${targetServerInfo.name}/`)
        ? toolName.replace(`${targetServerInfo.name}/`, '')
        : toolName;
      const result = await client.callTool({
        name: toolName,
        arguments: finalArgs,
      });

      console.log(`Tool invocation result: ${JSON.stringify(result)}`);
      return result;
    }

    // Regular tool handling
    const serverInfo = getServerByTool(request.params.name);
    if (!serverInfo) {
      throw new Error(`Server not found: ${request.params.name}`);
    }
    const client = serverInfo.client;
    if (!client) {
      throw new Error(`Client not found for server: ${request.params.name}`);
    }

    request.params.name = request.params.name.startsWith(`${serverInfo.name}/`)
      ? request.params.name.replace(`${serverInfo.name}/`, '')
      : request.params.name;
    const result = await client.callTool(request.params);
    console.log(`Tool call result: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error(`Error handling CallToolRequest: ${error}`);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error}`,
        },
      ],
      isError: true,
    };
  }
};

// Create McpServer instance
export const createMcpServer = (name: string, version: string, group?: string): Server => {
  // Determine server name based on routing type
  let serverName = name;

  if (group) {
    // Check if it's a group or a single server
    const serversInGroup = getServersInGroup(group);
    if (!serversInGroup || serversInGroup.length === 0) {
      // Single server routing
      serverName = `${name}_${group}`;
    } else {
      // Group routing
      serverName = `${name}_${group}_group`;
    }
  }
  // If no group, use default name (global routing)

  const server = new Server({ name: serverName, version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, handleListToolsRequest);
  server.setRequestHandler(CallToolRequestSchema, handleCallToolRequest);
  return server;
};
