import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ServerInfo, ServerConfig } from '../types/index.js';
import { loadSettings, saveSettings, expandEnvVars } from '../config/index.js';
import config from '../config/index.js';
import { getGroup } from './sseService.js';
import { getServersInGroup } from './groupService.js';

let currentServer: Server;

export const initMcpServer = async (name: string, version: string): Promise<void> => {
  currentServer = createMcpServer(name, version);
  await registerAllTools(currentServer, true, true);
};

export const setMcpServer = (server: Server): void => {
  currentServer = server;
};

export const getMcpServer = (): Server => {
  return currentServer;
};

export const notifyToolChanged = async () => {
  await registerAllTools(currentServer, true, false);
  currentServer
    .sendToolListChanged()
    .catch((error) => {
      console.warn('Failed to send tool list changed notification:', error.message);
    })
    .then(() => {
      console.log('Tool list changed notification sent successfully');
    });
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
    if (conf.url) {
      transport = new SSEClientTransport(new URL(conf.url));
    } else if (conf.command && conf.args) {
      const env: Record<string, string> = conf.env || {};
      env['PATH'] = expandEnvVars(process.env.PATH as string) || '';
      transport = new StdioClientTransport({
        command: conf.command,
        args: conf.args,
        env: env,
      });
      transport.stderr?.on('data', (data) => {
        console.error(`Error from server ${name}: ${data}`);
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
              name: tool.name,
              description: tool.description || '',
              inputSchema: tool.inputSchema || {},
            }));
            serverInfo.status = 'connected';
            serverInfo.error = null;
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
export const registerAllTools = async (
  server: Server,
  forceInit: boolean,
  isInit: boolean,
): Promise<void> => {
  initializeClientsFromSettings(isInit);
};

// Get all server information
export const getServersInfo = (): Omit<ServerInfo, 'client' | 'transport'>[] => {
  const settings = loadSettings();
  const infos = serverInfos.map(({ name, status, tools, createTime, error }) => {
    const serverConfig = settings.mcpServers[name];
    const enabled = serverConfig ? serverConfig.enabled !== false : true;
    return {
      name,
      status,
      error,
      tools,
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

    registerAllTools(currentServer, false, false);
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

// Create McpServer instance
export const createMcpServer = (name: string, version: string): Server => {
  const server = new Server({ name, version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async (_, extra) => {
    const sessionId = extra.sessionId || '';
    const group = getGroup(sessionId);
    console.log(`Handling ListToolsRequest for group: ${group}`);
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
        allTools.push(...serverInfo.tools);
      }
    }

    return {
      tools: allTools,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, _) => {
    console.log(`Handling CallToolRequest for tool: ${request.params.name}`);
    try {
      const serverInfo = getServerByTool(request.params.name);
      if (!serverInfo) {
        throw new Error(`Server not found: ${request.params.name}`);
      }
      const client = serverInfo.client;
      if (!client) {
        throw new Error(`Client not found for server: ${request.params.name}`);
      }
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
  });
  return server;
};
