import os from 'os';
import path from 'path';
import fs from 'fs';
import treeKill from 'tree-kill';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ServerCapabilities,
  type Prompt as McpPrompt,
  type Resource as McpResource,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { normalizeHeaders } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createFetchWithProxy, getProxyConfigFromEnv } from './proxy.js';
import { assertSafeUrl, createRedirectValidatingFetch } from '../utils/ssrf.js';
import { getUserDao } from '../dao/index.js';
import {
  ServerInfo,
  ServerConfig,
  Tool,
  Resource,
  ProxychainsConfig,
  IGroupServerConfig,
} from '../types/index.js';
import { expandEnvVars, replaceEnvVars, getNameSeparator } from '../config/index.js';
import config from '../config/index.js';
import { getGroup } from './sseService.js';
import { getServerConfigInGroup, normalizeGroupServers } from './groupService.js';
import { removeServerToolEmbeddings, saveToolsAsVectorEmbeddings } from './vectorSearchService.js';
import { OpenAPIClient } from '../clients/openapi.js';
import { RequestContextService } from './requestContextService.js';
import { getDataService } from './services.js';
import {
  getServerDao,
  getGroupDao,
  getSystemConfigDao,
  getBuiltinPromptDao,
  getBuiltinResourceDao,
  ServerConfigWithName,
} from '../dao/index.js';
import { initializeAllOAuthClients } from './oauthService.js';
import { createOAuthProvider } from './mcpOAuthProvider.js';
import {
  initSmartRoutingService,
  getSmartRoutingTools,
  handleSearchToolsRequest,
  handleDescribeToolRequest,
  isSmartRoutingGroup,
} from './smartRoutingService.js';
import { getActivityLoggingService } from './activityLoggingService.js';
import { maybeCompressToolResult } from './toolResultCompressionService.js';
import {
  assertHostedToolAllowed,
  filterHostedTools,
  HostedCreditReservation,
  reserveHostedToolCall,
  settleHostedToolCall,
} from './hostedAuthService.js';
import {
  formatErrorForLogging,
  sanitizeStringForLogging,
  summarizeErrorForLogging,
} from '../utils/serialization.js';
import {
  MCP_APPS_CAPABILITIES,
  filterModelVisibleTools,
  hasMcpAppsCapability,
  isAppOnlyTool,
  stripMcpAppsMetadata,
} from '../utils/mcpApps.js';
import { supportsCacheRefresh, injectRefreshFlag, clearRunnerCache } from '../utils/cacheUtils.js';

const servers: { [sessionId: string]: Server } = {};

import { setupClientKeepAlive } from './keepAliveService.js';

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Check if proxychains4 is available on the system (Linux/macOS only).
 * Returns the path to proxychains4 if found, null otherwise.
 */
const findProxychains4 = (): string | null => {
  // Windows is not supported
  if (process.platform === 'win32') {
    return null;
  }

  // Common proxychains4 binary paths
  const possiblePaths = [
    '/usr/bin/proxychains4',
    '/usr/local/bin/proxychains4',
    '/opt/homebrew/bin/proxychains4', // macOS Homebrew ARM
    '/usr/local/Cellar/proxychains-ng/*/bin/proxychains4', // macOS Homebrew Intel
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Try to find in PATH
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter);
  for (const dir of pathDirs) {
    const fullPath = path.join(dir, 'proxychains4');
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
};

/**
 * Generate a temporary proxychains4 configuration file.
 * Returns the path to the generated config file.
 */
const generateProxychainsConfig = (
  serverName: string,
  proxyConfig: ProxychainsConfig,
): string | null => {
  // If a custom config path is provided, use it directly
  if (proxyConfig.configPath) {
    if (fs.existsSync(proxyConfig.configPath)) {
      return proxyConfig.configPath;
    }
    console.warn(`[${serverName}] Custom proxychains config not found: ${proxyConfig.configPath}`);
    return null;
  }

  // Validate required fields
  if (!proxyConfig.host || !proxyConfig.port) {
    console.warn(`[${serverName}] Proxy host and port are required for proxychains4`);
    return null;
  }

  const proxyType = proxyConfig.type || 'socks5';
  const proxyLine =
    proxyConfig.username && proxyConfig.password
      ? `${proxyType} ${proxyConfig.host} ${proxyConfig.port} ${proxyConfig.username} ${proxyConfig.password}`
      : `${proxyType} ${proxyConfig.host} ${proxyConfig.port}`;

  const configContent = `# Proxychains4 configuration for MCP server: ${serverName}
# Generated by MCPHub

localnet 127.0.0.0/255.0.0.0
localnet 10.0.0.0/255.0.0.0
localnet 172.16.0.0/255.240.0.0
localnet 192.168.0.0/255.255.0.0

strict_chain
proxy_dns
remote_dns_subnet 224
tcp_read_time_out 15000
tcp_connect_time_out 8000

[ProxyList]
${proxyLine}
`;

  // Create temp directory if needed
  const tempDir = path.join(os.tmpdir(), 'mcphub-proxychains');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Write config file
  const configPath = path.join(tempDir, `${serverName.replace(/[^a-zA-Z0-9-_]/g, '_')}.conf`);
  fs.writeFileSync(configPath, configContent, 'utf-8');
  console.log(`[${serverName}] Generated proxychains4 config: ${configPath}`);

  return configPath;
};

/**
 * Wrap a command with proxychains4 if proxy is configured and available.
 * Returns modified command and args if proxychains4 is used, original values otherwise.
 */
const wrapWithProxychains = (
  serverName: string,
  command: string,
  args: string[],
  proxyConfig?: ProxychainsConfig,
): { command: string; args: string[] } => {
  // Skip if proxy is not enabled or not configured
  if (!proxyConfig?.enabled) {
    return { command, args };
  }

  // Check platform - Windows is not supported
  if (process.platform === 'win32') {
    console.warn(
      `[${serverName}] proxychains4 proxy is not supported on Windows, ignoring proxy configuration`,
    );
    return { command, args };
  }

  // Find proxychains4 binary
  const proxychains4Path = findProxychains4();
  if (!proxychains4Path) {
    console.warn(
      `[${serverName}] proxychains4 not found on system, install it with: apt install proxychains4 (Debian/Ubuntu) or brew install proxychains-ng (macOS)`,
    );
    return { command, args };
  }

  // Generate or get config file
  const configPath = generateProxychainsConfig(serverName, proxyConfig);
  if (!configPath) {
    console.warn(`[${serverName}] Failed to setup proxychains4 configuration, skipping proxy`);
    return { command, args };
  }

  // Wrap command with proxychains4
  console.log(
    `[${serverName}] Using proxychains4 proxy: ${proxyConfig.type || 'socks5'}://${proxyConfig.host}:${proxyConfig.port}`,
  );

  return {
    command: proxychains4Path,
    args: ['-f', configPath, command, ...args],
  };
};

export const initUpstreamServers = async (): Promise<void> => {
  // Initialize OAuth clients for servers with dynamic registration
  await initializeAllOAuthClients();

  // Register all tools from upstream servers
  await registerAllTools(true);

  // Initialize smart routing service with references to mcpService functions
  initSmartRoutingService(() => serverInfos, filterToolsByConfig, filterToolsByGroup);
};

type McpServerDescriptor = {
  name: string;
  version: string;
  group?: string;
  instructions?: string;
  appendGroupSuffix?: boolean;
};

const getMcpServerDescriptor = async (group?: string): Promise<McpServerDescriptor> => {
  if (!group || isSmartRoutingGroup(group)) {
    return {
      name: config.mcpHubName,
      version: config.mcpHubVersion,
      group,
    };
  }

  const { filteredServerInfos } = await getFilteredServerInfosForGroup(group);
  if (filteredServerInfos.length === 1) {
    const [serverInfo] = filteredServerInfos;
    return {
      name: serverInfo.name,
      version: serverInfo.version || config.mcpHubVersion,
      instructions: serverInfo.instructions,
      appendGroupSuffix: false,
    };
  }

  return {
    name: config.mcpHubName,
    version: config.mcpHubVersion,
    group,
    appendGroupSuffix: true,
  };
};

export const getMcpServer = async (sessionId?: string, group?: string): Promise<Server> => {
  const descriptor = await getMcpServerDescriptor(
    group || (sessionId ? getGroup(sessionId) : group),
  );

  if (!sessionId) {
    return createMcpServer(descriptor.name, descriptor.version, descriptor);
  }

  if (!servers[sessionId]) {
    servers[sessionId] = createMcpServer(descriptor.name, descriptor.version, descriptor);
  } else {
    console.log(`MCP server already exists for sessionId: ${sessionId}`);
  }
  return servers[sessionId];
};

export const deleteMcpServer = (sessionId: string): void => {
  delete servers[sessionId];
};

export const notifyToolChanged = async (
  name?: string,
  options?: { reportEmbeddingProgress?: boolean },
) => {
  await registerAllTools(false, name, options);
  broadcastToolListChanged();
};

const broadcastListChanged = (
  listType: 'tool' | 'resource' | 'prompt',
  sendNotification: (server: Server) => Promise<void>,
): void => {
  Object.values(servers).forEach((server) => {
    sendNotification(server)
      .then(() => {
        console.log(`${listType} list changed notification sent successfully`);
      })
      .catch((error) => {
        console.warn(`Failed to send ${listType} list changed notification:`, error.message);
      });
  });
};

export const broadcastToolListChanged = (): void => {
  broadcastListChanged('tool', (server) => server.sendToolListChanged());
};

export const broadcastResourceListChanged = (): void => {
  broadcastListChanged('resource', (server) => server.sendResourceListChanged());
};

export const broadcastPromptListChanged = (): void => {
  broadcastListChanged('prompt', (server) => server.sendPromptListChanged());
};

export const updateServerInfoVisibility = (
  serverName: string,
  visibility: ServerConfig['visibility'],
): void => {
  const serverInfo = getServerByName(serverName);
  if (!serverInfo) {
    return;
  }

  serverInfo.visibility = visibility;

  if (serverInfo.config) {
    serverInfo.config = {
      ...serverInfo.config,
      visibility,
    };
  }
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
  if (isAppOnlyTool(tool)) {
    return;
  }
  // Save tool as vector embedding for search
  syncToolsAsVectorEmbeddings(serverName, [tool]).catch((error) => {
    console.warn(
      `[EMBED_SYNC_ERROR] Failed to sync embedding for tool "${toolName}" on server "${serverName}"`,
    );
    console.error('Error syncing single tool embedding', { serverName, toolName, error });
  });
};

// Helper function to clean $schema field from inputSchema
const cleanInputSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const cleanedSchema = { ...schema };
  delete cleanedSchema.$schema;

  return cleanedSchema;
};

export const normalizeToolForCache = (serverName: string, tool: McpTool): Tool => {
  return {
    ...tool,
    name: `${serverName}${getNameSeparator()}${tool.name}`,
    description: tool.description || '',
    inputSchema: cleanInputSchema(tool.inputSchema || {}),
  };
};

const hasDescriptionOverride = (config?: { description?: string }): boolean => {
  return Boolean(config && typeof config.description === 'string');
};

const resolveDescriptionOverride = (
  defaultDescription: string | undefined,
  config?: { description?: string },
): string => {
  return hasDescriptionOverride(config) ? config?.description || '' : defaultDescription || '';
};

const buildToolWithDescriptionMetadata = (
  tool: Tool,
  toolConfig?: { enabled: boolean; description?: string },
): Tool => {
  const upstreamDescription = tool.description || '';

  return {
    ...tool,
    description: resolveDescriptionOverride(upstreamDescription, toolConfig),
    defaultDescription: upstreamDescription,
    hasDescriptionOverride: hasDescriptionOverride(toolConfig),
    enabled: toolConfig?.enabled !== false,
  };
};

const syncToolsAsVectorEmbeddings = async (
  serverName: string,
  tools: Tool[],
  options?: { reportProgress?: boolean },
): Promise<void> => {
  const modelVisibleTools = filterModelVisibleTools(tools);
  if (modelVisibleTools.length === 0) {
    await removeServerToolEmbeddings(serverName);
    return;
  }

  await saveToolsAsVectorEmbeddings(serverName, modelVisibleTools, options);
};

// Normalize prompt payload to satisfy MCP ListPrompts response schema
const normalizePromptForList = (prompt: {
  name: string;
  title?: string;
  description?: string;
  arguments?: any[];
  [key: string]: unknown;
}) => {
  return {
    ...prompt,
    name: prompt.name,
    title: prompt.title || prompt.name,
    description: prompt.description || '',
    arguments: Array.isArray(prompt.arguments) ? prompt.arguments : [],
  };
};

const normalizePromptForCache = (serverName: string, prompt: McpPrompt) => {
  return normalizePromptForList({
    ...prompt,
    name: `${serverName}${getNameSeparator()}${prompt.name}`,
  });
};

// Normalize resource payload to avoid nullable DB fields violating MCP schema
const normalizeResourceForList = (resource: {
  uri: string;
  name?: string | null;
  description?: string | null;
  mimeType?: string | null;
  [key: string]: unknown;
}): Resource => {
  return {
    ...resource,
    uri: resource.uri,
    name: resource.name || '',
    description: resource.description || '',
    mimeType: resource.mimeType || '',
  };
};

const normalizeResourceForCache = (resource: McpResource): Resource => {
  return normalizeResourceForList(resource);
};

// Store all server information
let serverInfos: ServerInfo[] = [];

// Track servers pending a cache-refresh reinstall.
// Consumed once by createTransportFromConfig on the next reconnect.
const pendingReinstalls = new Set<string>();

// Grace period after sending SIGTERM to a stdio process tree before falling back
// to SIGKILL. Long enough to let well-behaved servers shut down cleanly, short
// enough that a hung child does not block the container indefinitely.
const STDIO_KILL_GRACE_PERIOD_MS = 2000;

// Test-only helper to set serverInfos directly. Not for production use.
export const setServerInfosForTest = (infos: ServerInfo[]): void => {
  serverInfos = infos;
};

export const updateServerToolsCache = (
  serverInfo: ServerInfo,
  tools: McpTool[],
  options?: { reportEmbeddingProgress?: boolean },
): void => {
  serverInfo.tools = tools.map((tool) => normalizeToolForCache(serverInfo.name, tool));
  syncToolsAsVectorEmbeddings(serverInfo.name, serverInfo.tools, {
    reportProgress: options?.reportEmbeddingProgress === true,
  }).catch(() => {
    console.warn('[EMBED_SYNC_ERROR] Failed to sync tool embeddings');
  });
};

const updateServerPromptsCache = (serverInfo: ServerInfo, prompts: McpPrompt[]): void => {
  serverInfo.prompts = prompts.map((prompt) => normalizePromptForCache(serverInfo.name, prompt));
};

const updateServerResourcesCache = (serverInfo: ServerInfo, resources: McpResource[]): void => {
  serverInfo.resources = resources.map(normalizeResourceForCache);
};

const logListChangedRefreshError = (listType: 'tool' | 'prompt' | 'resource'): void => {
  console.warn(`Failed to refresh ${listType} list after upstream notification`);
};

const createUpstreamMcpClient = (
  name: string,
  getServerInfo: () => ServerInfo | undefined,
): Client => {
  return new Client(
    {
      name: `mcp-client-${name}`,
      version: '1.0.0',
    },
    {
      capabilities: MCP_APPS_CAPABILITIES,
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            const serverInfo = getServerInfo();
            if (error) {
              logListChangedRefreshError('tool');
              return;
            }
            if (!serverInfo || !tools) {
              return;
            }
            updateServerToolsCache(serverInfo, tools);
            broadcastToolListChanged();
          },
        },
        prompts: {
          onChanged: (error, prompts) => {
            const serverInfo = getServerInfo();
            if (error) {
              logListChangedRefreshError('prompt');
              return;
            }
            if (!serverInfo || !prompts) {
              return;
            }
            updateServerPromptsCache(serverInfo, prompts);
            broadcastPromptListChanged();
          },
        },
        resources: {
          onChanged: (error, resources) => {
            const serverInfo = getServerInfo();
            if (error) {
              logListChangedRefreshError('resource');
              return;
            }
            if (!serverInfo || !resources) {
              return;
            }
            updateServerResourcesCache(serverInfo, resources);
            broadcastResourceListChanged();
          },
        },
      },
    },
  );
};

export interface ServerConnectionStats {
  total: number;
  connected: number;
  disconnected: number;
}

// Normalize and infer server type for safe client display
const normalizeServerType = (
  type?: string,
): 'stdio' | 'sse' | 'streamable-http' | 'openapi' | undefined => {
  if (!type) return undefined;
  const allowed = ['stdio', 'sse', 'streamable-http', 'openapi'];
  return allowed.includes(type) ? (type as any) : undefined;
};

const inferServerType = (
  conf?: ServerConfig,
): 'stdio' | 'sse' | 'streamable-http' | 'openapi' | undefined => {
  if (!conf) return undefined;

  const normalized = normalizeServerType(conf.type);
  if (normalized) return normalized;

  // OpenAPI configs should be treated as openapi even when type is omitted
  if (conf.openapi?.url || conf.openapi?.schema) {
    return 'openapi';
  }

  // Streamable HTTP must be explicit; otherwise, fall back to SSE when URL is present
  if (conf.url) {
    return conf.type === 'streamable-http' ? 'streamable-http' : 'sse';
  }

  // Command-based servers default to stdio
  if (conf.command || (conf.args && conf.args.length > 0)) {
    return 'stdio';
  }

  return undefined;
};

export const summarizeServerConnections = (
  infos: Pick<ServerInfo, 'status' | 'enabled'>[],
): ServerConnectionStats => {
  const enabledServers = infos.filter((serverInfo) => serverInfo.enabled !== false);
  const connectedServers = enabledServers.filter((serverInfo) => serverInfo.status === 'connected');

  return {
    total: enabledServers.length,
    connected: connectedServers.length,
    disconnected: enabledServers.length - connectedServers.length,
  };
};

export const getServerConnectionStats = (): ServerConnectionStats => {
  return summarizeServerConnections(serverInfos);
};

// Returns true if all enabled servers are connected
export const connected = (): boolean => {
  const { total, connected: connectedServers } = getServerConnectionStats();
  return total === connectedServers;
};

// Global cleanup function to close all connections
export const cleanupAllServers = (): void => {
  for (const serverInfo of serverInfos) {
    try {
      if (serverInfo.client) {
        serverInfo.client.close();
      }
      if (serverInfo.transport) {
        serverInfo.transport.close();
      }
    } catch (error) {
      console.warn('Error closing server', { serverName: serverInfo.name, error });
    }
  }
  serverInfos = [];

  // Clear session servers as well
  Object.keys(servers).forEach((sessionId) => {
    delete servers[sessionId];
  });
};

const headerValueToString = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === 'string' ? value : undefined;
};

const getHeaderValue = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | string[] | undefined => {
  if (headers[name]) {
    return headers[name];
  }

  const lowerName = name.toLowerCase();
  if (headers[lowerName]) {
    return headers[lowerName];
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
};

const LOG_SUMMARY_LIMIT = 8;

const getValueTypeForLogging = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value === null) {
    return 'null';
  }
  if (value && typeof value === 'object') {
    return `object(${Object.keys(value as Record<string, unknown>).length} keys)`;
  }
  return typeof value;
};

const summarizeObjectShapeForLogging = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const entries = Object.entries(value);
  return {
    keyCount: entries.length,
    keys: entries.slice(0, LOG_SUMMARY_LIMIT).map(([key]) => key),
    valueTypes: Object.fromEntries(
      entries
        .slice(0, LOG_SUMMARY_LIMIT)
        .map(([key, entryValue]) => [key, getValueTypeForLogging(entryValue)]),
    ),
    truncated: entries.length > LOG_SUMMARY_LIMIT || undefined,
  };
};

export const summarizeArgumentsForLogging = (value: unknown): Record<string, unknown> => {
  if (value === undefined) {
    return { present: false };
  }

  if (Array.isArray(value)) {
    return {
      present: true,
      type: 'array',
      length: value.length,
      itemTypes: Array.from(new Set(value.slice(0, LOG_SUMMARY_LIMIT).map(getValueTypeForLogging))),
      truncated: value.length > LOG_SUMMARY_LIMIT || undefined,
    };
  }

  if (value && typeof value === 'object') {
    return {
      present: true,
      type: 'object',
      ...summarizeObjectShapeForLogging(value as Record<string, unknown>),
    };
  }

  return {
    present: true,
    type: getValueTypeForLogging(value),
  };
};

const summarizeTextPayloadForLogging = (text: string): Record<string, unknown> => ({
  textLength: text.length,
  looksLikeJson: /^[[{]/.test(text.trim()) || undefined,
  wasSanitized: sanitizeStringForLogging(text) !== text || undefined,
});

const getHttpErrorStatusCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const err = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const code = err.status ?? err.response?.status ?? err.code;
  if (typeof code === 'number' && Number.isFinite(code)) {
    return code;
  }

  if (typeof code === 'string') {
    const parsedCode = Number.parseInt(code, 10);
    return Number.isFinite(parsedCode) ? parsedCode : undefined;
  }

  return undefined;
};

const isRecoverableHttp4xxError = (error: unknown): boolean => {
  const statusCode = getHttpErrorStatusCode(error);
  if (statusCode !== undefined) {
    return statusCode === 401 || statusCode === 404;
  }

  const message =
    typeof (error as { message?: unknown })?.message === 'string'
      ? (error as { message: string }).message
      : '';

  return /Error POSTing to endpoint \(HTTP 40[14]/.test(message);
};

const summarizeContentItemForLogging = (item: unknown): Record<string, unknown> => {
  if (!item || typeof item !== 'object') {
    return { type: getValueTypeForLogging(item) };
  }

  const record = item as Record<string, unknown>;
  return {
    type: typeof record.type === 'string' ? record.type : 'object',
    keys: Object.keys(record).slice(0, LOG_SUMMARY_LIMIT),
    text: typeof record.text === 'string' ? summarizeTextPayloadForLogging(record.text) : undefined,
    truncated: Object.keys(record).length > LOG_SUMMARY_LIMIT || undefined,
  };
};

export const summarizeToolResultForLogging = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return { type: getValueTypeForLogging(value) };
  }

  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    type: 'object',
    ...summarizeObjectShapeForLogging(record),
  };

  if (typeof record.isError === 'boolean') {
    summary.isError = record.isError;
  }

  if (Array.isArray(record.content)) {
    summary.contentCount = record.content.length;
    summary.content = record.content
      .slice(0, LOG_SUMMARY_LIMIT)
      .map((item) => summarizeContentItemForLogging(item));
    summary.contentTruncated = record.content.length > LOG_SUMMARY_LIMIT || undefined;
  }

  return summary;
};

const summarizeToolRequestForLogging = (params: any): Record<string, unknown> => ({
  name: typeof params?.name === 'string' ? params.name : 'unknown',
  arguments: summarizeArgumentsForLogging(params?.arguments),
});

const getActivityInputFromToolRequest = (request: any): unknown => {
  if (request?.params?.name === 'call_tool') {
    return request?.params?.arguments?.arguments;
  }

  return request?.params?.arguments;
};

const getActivityToolNameFromRequest = (request: any): string => {
  if (request?.params?.name === 'call_tool') {
    const nestedToolName = request?.params?.arguments?.toolName;
    return typeof nestedToolName === 'string' ? nestedToolName : 'call_tool';
  }

  return typeof request?.params?.name === 'string' ? request.params.name : 'unknown';
};

const stripToolServerPrefix = (toolName: string, serverName?: string): string => {
  if (!serverName) {
    return toolName;
  }

  const separator = getNameSeparator();
  const prefix = `${serverName}${separator}`;
  return toolName.startsWith(prefix) ? toolName.substring(prefix.length) : toolName;
};

const summarizePromptForLogging = (prompt: unknown): Record<string, unknown> => {
  if (!prompt || typeof prompt !== 'object') {
    return { type: getValueTypeForLogging(prompt) };
  }

  const record = prompt as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    type: 'object',
    ...summarizeObjectShapeForLogging(record),
  };

  if (Array.isArray(record.messages)) {
    const messages = record.messages as Array<Record<string, unknown>>;
    summary.messageCount = messages.length;
    summary.messages = messages.slice(0, LOG_SUMMARY_LIMIT).map((message) => ({
      role: typeof message.role === 'string' ? message.role : undefined,
      contentType:
        message.content && typeof message.content === 'object'
          ? (message.content as Record<string, unknown>).type
          : getValueTypeForLogging(message.content),
      text:
        message.content &&
        typeof message.content === 'object' &&
        typeof (message.content as Record<string, unknown>).text === 'string'
          ? summarizeTextPayloadForLogging(
              String((message.content as Record<string, unknown>).text),
            )
          : undefined,
    }));
    summary.messagesTruncated = messages.length > LOG_SUMMARY_LIMIT || undefined;
  }

  return summary;
};

export const collectPassthroughHeaders = (
  requestHeaders: Record<string, string | string[] | undefined> | null,
  passthroughHeaderNames?: string[],
): Record<string, string> => {
  if (
    !requestHeaders ||
    !Array.isArray(passthroughHeaderNames) ||
    passthroughHeaderNames.length === 0
  ) {
    return {};
  }

  const passthroughHeaders: Record<string, string> = {};

  for (const headerName of passthroughHeaderNames) {
    const normalizedHeaderName = headerName.trim();
    if (!normalizedHeaderName) {
      continue;
    }

    const headerValue = headerValueToString(getHeaderValue(requestHeaders, normalizedHeaderName));

    if (headerValue !== undefined) {
      passthroughHeaders[normalizedHeaderName] = headerValue;
    }
  }

  return passthroughHeaders;
};

export const createRequestContextAwareFetch = (
  baseFetch: FetchLike,
  passthroughHeaderNames?: string[],
): FetchLike => {
  if (!Array.isArray(passthroughHeaderNames) || passthroughHeaderNames.length === 0) {
    return baseFetch;
  }

  return async (url: string | URL, init?: RequestInit) => {
    const requestHeaders = RequestContextService.getInstance().getHeaders();
    const passthroughHeaders = collectPassthroughHeaders(requestHeaders, passthroughHeaderNames);

    if (Object.keys(passthroughHeaders).length === 0) {
      return baseFetch(url, init);
    }

    return baseFetch(url, {
      ...init,
      headers: {
        ...normalizeHeaders(init?.headers),
        ...passthroughHeaders,
      },
    });
  };
};

// Helper function to create transport based on server configuration
export const createTransportFromConfig = async (name: string, conf: ServerConfig): Promise<any> => {
  let transport;
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...replaceEnvVars(conf.env || {}),
  };

  // SSRF guard: block URL/streamable-http transports from reaching
  // loopback / RFC1918 / link-local targets (e.g. cloud metadata service).
  // Admin-owned servers may legitimately target internal services, so they
  // skip the internal-IP blocklist. allowInternal also governs per-hop
  // redirect validation in createRedirectValidatingFetch below.
  const ownerUser = conf.owner
    ? await getUserDao().findByUsername(conf.owner)
    : null;
  const allowInternal = !!ownerUser?.isAdmin;

  if (conf.url) {
    await assertSafeUrl(conf.url, { allowInternal });
  }

  if (conf.type === 'streamable-http') {
    const options: StreamableHTTPClientTransportOptions = {};
    const headers = conf.headers ? replaceEnvVars(conf.headers, env) : {};
    const baseFetch = createFetchWithProxy(getProxyConfigFromEnv(env));
    const requestAwareFetch = createRedirectValidatingFetch(
      createRequestContextAwareFetch(baseFetch, conf.passthroughHeaders),
      allowInternal,
    );

    if (Object.keys(headers).length > 0) {
      options.requestInit = {
        headers,
      };
    }

    // Create OAuth provider if configured - SDK will handle authentication automatically
    const authProvider = await createOAuthProvider(name, conf);
    if (authProvider) {
      options.authProvider = authProvider;
      console.log(`OAuth provider configured for server: ${name}`);
    }

    options.fetch = requestAwareFetch;

    transport = new StreamableHTTPClientTransport(new URL(conf.url || ''), options);
  } else if (conf.url) {
    // SSE transport
    const options: any = {};
    const headers = conf.headers ? replaceEnvVars(conf.headers, env) : {};
    const baseFetch = createFetchWithProxy(getProxyConfigFromEnv(env));
    const requestAwareFetch = createRedirectValidatingFetch(
      createRequestContextAwareFetch(baseFetch, conf.passthroughHeaders),
      allowInternal,
    );

    if (Object.keys(headers).length > 0) {
      options.eventSourceInit = {
        headers,
        fetch: requestAwareFetch,
      };
      options.requestInit = {
        headers,
      };
    } else {
      options.eventSourceInit = {
        fetch: requestAwareFetch,
      };
    }

    // Create OAuth provider if configured - SDK will handle authentication automatically
    const authProvider = await createOAuthProvider(name, conf);
    if (authProvider) {
      options.authProvider = authProvider;
      console.log(`OAuth provider configured for server: ${name}`);
    }

    options.fetch = requestAwareFetch;

    transport = new SSEClientTransport(new URL(conf.url), options);
  } else if (conf.command && conf.args) {
    // Stdio transport
    env['PATH'] = expandEnvVars(process.env.PATH as string) || '';

    const systemConfigDao = getSystemConfigDao();
    const systemConfig = await systemConfigDao.get();
    // Add UV_DEFAULT_INDEX and npm_config_registry if needed
    if (
      systemConfig?.install?.pythonIndexUrl &&
      (conf.command === 'uvx' || conf.command === 'uv' || conf.command === 'python')
    ) {
      env['UV_DEFAULT_INDEX'] = systemConfig.install.pythonIndexUrl;
    }

    if (
      systemConfig?.install?.npmRegistry &&
      (conf.command === 'npm' ||
        conf.command === 'npx' ||
        conf.command === 'pnpm' ||
        conf.command === 'yarn' ||
        conf.command === 'node')
    ) {
      env['npm_config_registry'] = systemConfig.install.npmRegistry;
    }

    // Apply proxychains4 wrapper if proxy is configured (Linux/macOS only)
    let resolvedArgs = replaceEnvVars(conf.args) as string[];

    // If this server is pending a reinstall, inject cache-busting flags (uvx only).
    // For npx, the cache directory was already cleared before reconnect.
    if (pendingReinstalls.has(name)) {
      resolvedArgs = injectRefreshFlag(conf.command, resolvedArgs);
      pendingReinstalls.delete(name);
      console.log(`[${name}] Injected cache refresh flags for reinstall`);
    }

    const { command: finalCommand, args: finalArgs } = wrapWithProxychains(
      name,
      conf.command,
      resolvedArgs,
      conf.proxy,
    );

    // Create STDIO transport with potentially wrapped command
    transport = new StdioClientTransport({
      cwd: process.cwd(),
      command: finalCommand,
      args: finalArgs,
      env: env,
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (data) => {
      console.log(`[${name}] [child] ${data}`);
    });
  } else {
    throw new Error(`Unable to create transport for server: ${name}`);
  }

  return transport;
};

// Helper function to handle client.callTool with reconnection logic
const callToolWithReconnect = async (
  serverInfo: ServerInfo,
  toolParams: any,
  options?: any,
  maxRetries: number = 1,
): Promise<any> => {
  if (!serverInfo.client) {
    throw new Error(`Client not found for server: ${serverInfo.name}`);
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await serverInfo.client.callTool(toolParams, undefined, options || {});
      // Check auth error
      checkAuthError(result);
      return result;
    } catch (error: any) {
      const isHttp40xError = isRecoverableHttp4xxError(error);
      // Only retry for StreamableHTTPClientTransport
      const isStreamableHttp = serverInfo.transport instanceof StreamableHTTPClientTransport;
      const isSSE = serverInfo.transport instanceof SSEClientTransport;
      if (
        attempt < maxRetries &&
        serverInfo.transport &&
        ((isStreamableHttp && isHttp40xError) || isSSE)
      ) {
        console.warn(
          `${isHttp40xError ? 'HTTP 40x error' : 'error'} detected for ${isStreamableHttp ? 'StreamableHTTP' : 'SSE'} server ${serverInfo.name}, attempting reconnection (attempt ${attempt + 1}/${maxRetries + 1})`,
        );

        try {
          // Close existing connection
          if (serverInfo.keepAliveIntervalId) {
            clearInterval(serverInfo.keepAliveIntervalId);
            serverInfo.keepAliveIntervalId = undefined;
          }

          serverInfo.client.close();
          serverInfo.transport.close();

          const server = await getServerDao().findById(serverInfo.name);
          if (!server) {
            throw new Error(`Server configuration not found for: ${serverInfo.name}`);
          }

          // Recreate transport using helper function
          const newTransport = await createTransportFromConfig(serverInfo.name, server);

          // Create new client
          const client = createUpstreamMcpClient(serverInfo.name, () => serverInfo);

          // Reconnect with new transport
          await client.connect(newTransport, serverInfo.options || {});

          // Update server info with new client and transport
          serverInfo.client = client;
          serverInfo.transport = newTransport;
          serverInfo.status = 'connected';

          // Reload tools list after reconnection
          try {
            const tools = await client.listTools({}, serverInfo.options || {});
            updateServerToolsCache(serverInfo, tools.tools);
          } catch (listToolsError) {
            console.warn('Failed to reload tools after reconnection', {
              serverName: serverInfo.name,
              error: summarizeErrorForLogging(listToolsError),
            });
            // Continue anyway, as the connection might still work for the current tool
          }

          console.log(`Successfully reconnected to server: ${serverInfo.name}`);

          // Continue to next attempt
          continue;
        } catch (reconnectError) {
          console.error('Failed to reconnect to server', {
            serverName: serverInfo.name,
            error: summarizeErrorForLogging(reconnectError),
          });
          serverInfo.status = 'disconnected';
          serverInfo.error = `Failed to reconnect: ${formatErrorForLogging(reconnectError)}`;

          // If this was the last attempt, throw the original error
          if (attempt === maxRetries) {
            throw error;
          }
        }
      } else {
        // Not an HTTP 40x error or no more retries, throw the original error
        throw error;
      }
    }
  }

  // This should not be reached, but just in case
  throw new Error('Unexpected error in callToolWithReconnect');
};

const setupServerKeepAlive = (serverInfo: ServerInfo, serverConfig: ServerConfig): void => {
  setupClientKeepAlive(serverInfo, serverConfig, {
    reconnectServer: async (serverName) => {
      try {
        await reconnectServer(serverName);
      } catch (error) {
        setupServerKeepAlive(serverInfo, serverConfig);
        throw error;
      }
    },
  }).catch((error) =>
    console.warn('Keepalive setup failed', {
      serverName: serverInfo.name,
      error: summarizeErrorForLogging(error),
    }),
  );
};

// Initialize MCP server clients
export const initializeClientsFromSettings = async (
  isInit: boolean,
  serverName?: string,
  options?: { reportEmbeddingProgress?: boolean },
): Promise<ServerInfo[]> => {
  const allServers: ServerConfigWithName[] = await getServerDao().findAll();
  const existingServerInfos = serverInfos;
  const nextServerInfos: ServerInfo[] = [];

  try {
    for (const conf of allServers) {
      const { name } = conf;

      // Expand environment variables in all configuration values
      const expandedConf = replaceEnvVars(conf as any) as ServerConfigWithName;

      // Skip disabled servers
      if (expandedConf.enabled === false) {
        console.log(`Skipping disabled server: ${name}`);
        nextServerInfos.push({
          name,
          owner: expandedConf.owner,
          visibility: expandedConf.visibility,
          status: 'disconnected',
          error: null,
          tools: [],
          prompts: [],
          resources: [],
          createTime: Date.now(),
          enabled: false,
        });
        continue;
      }

      // Reuse this server's existing runtime state instead of reconnecting when:
      // - a targeted reload/reconnect (serverName) was requested for a
      //   *different* server — preserve its current state regardless of
      //   status. Reloading one server must not reconnect unrelated servers
      //   (e.g. failed/disconnected ones), which would also leak their
      //   previous stdio child processes. See #921.
      // - a general/full initialization (no serverName) — preserve this
      //   server's state if it is already connected, or if an OAuth
      //   authorization is in flight. Reconnecting during PKCE authorization
      //   would replace the pending code verifier and break the callback.
      const existingServer = existingServerInfos.find((s) => s.name === name);
      const isDifferentServer = Boolean(serverName) && serverName !== name;
      const hasInflightOAuthAuthorization =
        existingServer?.status === 'oauth_required' &&
        Boolean(
          expandedConf.oauth?.pendingAuthorization?.state ||
            existingServer.oauth?.state,
        );
      if (
        existingServer &&
        (isDifferentServer ||
          (!serverName && (existingServer.status === 'connected' || hasInflightOAuthAuthorization)))
      ) {
        nextServerInfos.push({
          ...existingServer,
          enabled: expandedConf.enabled === undefined ? true : expandedConf.enabled,
        });
        console.log(
          hasInflightOAuthAuthorization
            ? `Server '${name}' has an in-flight OAuth authorization; preserving existing state.`
            : `Server '${name}' is already connected.`,
        );
        continue;
      }

      let transport;
      let openApiClient;
      if (expandedConf.type === 'openapi') {
        // Handle OpenAPI type servers
        if (!expandedConf.openapi?.url && !expandedConf.openapi?.schema) {
          console.warn(
            `Skipping OpenAPI server '${name}': missing OpenAPI specification URL or schema`,
          );
          nextServerInfos.push({
            name,
            owner: expandedConf.owner,
            visibility: expandedConf.visibility,
            status: 'disconnected',
            error: 'Missing OpenAPI specification URL or schema',
            tools: [],
            prompts: [],
            resources: [],
            createTime: Date.now(),
          });
          continue;
        }

        // Create server info first and keep reference to it
        const serverInfo: ServerInfo = {
          name,
          owner: expandedConf.owner,
          visibility: expandedConf.visibility,
          status: 'connecting',
          error: null,
          tools: [],
          prompts: [],
          resources: [],
          createTime: Date.now(),
          enabled: expandedConf.enabled === undefined ? true : expandedConf.enabled,
          config: expandedConf, // Store reference to expanded config for OpenAPI passthrough headers
        };
        nextServerInfos.push(serverInfo);

        try {
          // Create OpenAPI client instance
          openApiClient = new OpenAPIClient(expandedConf, {
            persistOAuth2Token: async (oauth2) => {
              const openapiConfig = {
                ...(expandedConf.openapi || {}),
                security: {
                  ...(expandedConf.openapi?.security || { type: 'oauth2' as const }),
                  type: 'oauth2' as const,
                  oauth2: { ...oauth2 },
                },
              };

              expandedConf.openapi = openapiConfig;
              serverInfo.config = {
                ...expandedConf,
                openapi: openapiConfig,
              };

              await getServerDao().update(name, {
                openapi: openapiConfig,
              });
            },
          });

          console.log(`Initializing OpenAPI server: ${name}...`);

          // Perform async initialization
          await openApiClient.initialize();

          // Convert OpenAPI tools to MCP tool format
          const openApiTools = openApiClient.getTools();
          const mcpTools: Tool[] = openApiTools.map((tool) => ({
            name: `${name}${getNameSeparator()}${tool.name}`,
            description: tool.description,
            inputSchema: cleanInputSchema(tool.inputSchema),
          }));

          // Update server info with successful initialization
          serverInfo.status = 'connected';
          serverInfo.tools = mcpTools;
          serverInfo.openApiClient = openApiClient;

          console.log(
            `Successfully initialized OpenAPI server: ${name} with ${mcpTools.length} tools`,
          );

          // Broadcast now that tools are loaded. OpenAPI servers expose tools
          // only (no prompts/resources). See the standard-path note above.
          broadcastToolListChanged();

          // Save tools as vector embeddings for search
          syncToolsAsVectorEmbeddings(name, mcpTools, {
            reportProgress: options?.reportEmbeddingProgress === true && serverName === name,
          }).catch((error) => {
            console.warn(
              `[EMBED_SYNC_ERROR] Failed to sync OpenAPI embeddings for server "${name}"`,
            );
            console.error('Error syncing OpenAPI tool embeddings', {
              serverName: name,
              error: summarizeErrorForLogging(error),
            });
          });
          continue;
        } catch (error) {
          console.error('Failed to initialize OpenAPI server', {
            serverName: name,
            error: summarizeErrorForLogging(error),
          });

          // Update the already pushed server info with error status
          serverInfo.status = 'disconnected';
          serverInfo.error = `Failed to initialize OpenAPI server: ${formatErrorForLogging(error)}`;
          continue;
        }
      } else {
        transport = await createTransportFromConfig(name, expandedConf);
      }

      const serverInfoRef: { current?: ServerInfo } = {};
      const client = createUpstreamMcpClient(name, () => serverInfoRef.current);

      // Get request options from server configuration, with fallbacks
      const serverRequestOptions = expandedConf.options || {};
      const defaultRequestTimeout = Number(process.env.DEFAULT_REQUEST_TIMEOUT) || 60000;
      const requestOptions = {
        timeout: serverRequestOptions.timeout || defaultRequestTimeout,
        resetTimeoutOnProgress: serverRequestOptions.resetTimeoutOnProgress ?? true,
        maxTotalTimeout: serverRequestOptions.maxTotalTimeout,
      };
      const initRequestOptions = isInit
        ? {
            ...requestOptions,
            timeout: Number(config.initTimeout) || 60000,
          }
        : undefined;

      // Create server info first and keep reference to it
      const serverInfo: ServerInfo = {
        name,
        owner: expandedConf.owner,
        visibility: expandedConf.visibility,
        status: 'connecting',
        error: null,
        tools: [],
        prompts: [],
        resources: [],
        client,
        transport,
        options: requestOptions,
        createTime: Date.now(),
        config: expandedConf, // Store reference to expanded config
      };
      serverInfoRef.current = serverInfo;

      const pendingAuth = expandedConf.oauth?.pendingAuthorization;
      if (pendingAuth) {
        serverInfo.status = 'oauth_required';
        serverInfo.error = null;
        serverInfo.oauth = {
          authorizationUrl: pendingAuth.authorizationUrl,
          state: pendingAuth.state,
          codeVerifier: pendingAuth.codeVerifier,
        };
      }
      nextServerInfos.push(serverInfo);

      client
        .connect(transport, initRequestOptions || requestOptions)
        .then(() => {
          console.log(`Successfully connected client for server: ${name}`);
          const serverVersion = client.getServerVersion?.();
          serverInfo.version = serverVersion?.version;
          serverInfo.instructions = client.getInstructions?.();
          const capabilities: ServerCapabilities | undefined = client.getServerCapabilities();
          console.log('Server capabilities', JSON.stringify(capabilities));

          let dataError: Error | null = null;
          if (capabilities?.tools) {
            client
              .listTools({}, initRequestOptions || requestOptions)
              .then((tools) => {
                console.log(`Successfully listed ${tools.tools.length} tools for server: ${name}`);
                updateServerToolsCache(serverInfo, tools.tools, {
                  reportEmbeddingProgress:
                    options?.reportEmbeddingProgress === true && serverName === name,
                });
                // Broadcast only after tools are actually loaded into the cache.
                // The connection completes asynchronously, so callers (e.g. enabling
                // a server) cannot broadcast a correct tool list themselves — doing so
                // would race ahead of this point and push a stale (empty) list.
                broadcastToolListChanged();
              })
              .catch((error) => {
                console.error('Failed to list tools for server', {
                  serverName: name,
                  error: summarizeErrorForLogging(error),
                });
                dataError = error;
              });
          }

          if (capabilities?.prompts) {
            client
              .listPrompts({}, initRequestOptions || requestOptions)
              .then((prompts) => {
                console.log(
                  `Successfully listed ${prompts.prompts.length} prompts for server: ${name}`,
                );
                updateServerPromptsCache(serverInfo, prompts.prompts);
                broadcastPromptListChanged();
              })
              .catch((error) => {
                console.error('Failed to list prompts for server', {
                  serverName: name,
                  error: summarizeErrorForLogging(error),
                });
                dataError = error;
              });
          }

          if (capabilities?.resources) {
            client
              .listResources({}, initRequestOptions || requestOptions)
              .then((resources) => {
                console.log(
                  `Successfully listed ${resources.resources.length} resources for server: ${name}`,
                );
                updateServerResourcesCache(serverInfo, resources.resources);
                broadcastResourceListChanged();
              })
              .catch((error) => {
                console.error('Failed to list resources for server', {
                  serverName: name,
                  error: summarizeErrorForLogging(error),
                });
                dataError = error;
              });
          }

          if (!dataError) {
            serverInfo.status = 'connected';
            serverInfo.error = null;
            // Set up keep-alive ping for SSE connections via shared service
            setupServerKeepAlive(serverInfo, expandedConf);
          } else {
            serverInfo.status = 'disconnected';
            serverInfo.error = `Failed to list data: ${formatErrorForLogging(dataError)}`;
            setupServerKeepAlive(serverInfo, expandedConf);
          }
        })
        .catch(async (error) => {
          // Check if this is an OAuth authorization error
          const isOAuthError =
            error?.message?.includes('OAuth authorization required') ||
            error?.message?.includes('Authorization required');

          if (isOAuthError) {
            // OAuth provider should have already set the status to 'oauth_required'
            // and stored the authorization URL in serverInfo.oauth
            console.log(
              `OAuth authorization required for server ${name}. Status should be set to 'oauth_required'.`,
            );
            // Make sure status is set correctly
            if (serverInfo.status !== 'oauth_required') {
              serverInfo.status = 'oauth_required';
            }
            serverInfo.error = null;
          } else {
            console.error('Failed to connect client for server', {
              serverName: name,
              error: summarizeErrorForLogging(error),
            });
            // Other connection errors
            serverInfo.status = 'disconnected';
            serverInfo.error = `Failed to connect: ${formatErrorForLogging(error)}`;
            setupServerKeepAlive(serverInfo, expandedConf);
          }
        });
      console.log(`Initialized client for server: ${name}`);
    }
  } catch (error) {
    // Restore previous state if initialization fails to avoid exposing an empty server list
    serverInfos = existingServerInfos;
    throw error;
  }

  serverInfos = nextServerInfos;
  return serverInfos;
};

// Register all MCP tools
export const registerAllTools = async (
  isInit: boolean,
  serverName?: string,
  options?: { reportEmbeddingProgress?: boolean },
): Promise<void> => {
  await initializeClientsFromSettings(isInit, serverName, options);
};

// Get all server information
export const getServersInfo = async (
  page?: number,
  limit?: number,
  user?: any,
): Promise<Omit<ServerInfo, 'client' | 'transport'>[]> => {
  const dataService = getDataService();
  const isNonAdminUser = Boolean(user && !user.isAdmin);

  const isPaginated = limit !== undefined && page !== undefined;
  const allServers: ServerConfigWithName[] = isPaginated
    ? (isNonAdminUser
        ? await getServerDao().findVisibleToUserPaginated(user.username, page, limit)
        : await getServerDao().findAllPaginated(page, limit)
      ).data
    : await getServerDao().findAll();

  // Ensure that servers recently added via DAO but not yet initialized in serverInfos
  // are still visible in the servers list. This avoids a race condition where
  // a POST /api/servers immediately followed by GET /api/servers would not
  // return the newly created server until background initialization completes.
  const combinedServerInfos: ServerInfo[] = [...serverInfos];
  const existingNames = new Set(combinedServerInfos.map((s) => s.name));

  // Create a set of server names we're interested in (for pagination)
  const requestedServerNames = new Set(allServers.map((s) => s.name));

  // Filter serverInfos to only include requested servers if pagination is used
  const filteredServerInfos = isPaginated
    ? combinedServerInfos.filter((s) => requestedServerNames.has(s.name))
    : combinedServerInfos;

  // Add servers from DAO that don't have runtime info yet
  for (const server of allServers) {
    if (!existingNames.has(server.name)) {
      const isEnabled = server.enabled === undefined ? true : server.enabled;
      filteredServerInfos.push({
        name: server.name,
        owner: server.owner,
        visibility: server.visibility,
        // Newly created servers that are enabled should appear as "connecting"
        // until the MCP client initialization completes. Disabled servers remain
        // in the "disconnected" state.
        status: isEnabled ? 'connecting' : 'disconnected',
        error: null,
        tools: [],
        prompts: [],
        resources: [],
        createTime: Date.now(),
        enabled: isEnabled,
      });
    }
  }

  // Apply user filtering only when NOT using pagination.
  // Paginated non-admin requests are filtered at DAO level; paginated admin requests
  // should remain unfiltered as well.
  const shouldApplyUserFilter = !isPaginated;
  const filterServerInfos: ServerInfo[] =
    shouldApplyUserFilter && dataService.filterData
      ? dataService.filterData(filteredServerInfos, user)
      : filteredServerInfos;

  const infos = filterServerInfos
    .filter((info) => requestedServerNames.has(info.name)) // Only include requested servers
    .map(
      ({
        name,
        version,
        instructions,
        owner,
        visibility,
        status,
        tools,
        prompts,
        resources,
        createTime,
        error,
        oauth,
      }) => {
        const serverConfig = allServers.find((server) => server.name === name);
        const enabled = serverConfig ? serverConfig.enabled !== false : true;
        const resolvedType = inferServerType(serverConfig);

        // Add enabled status and custom description to each tool
        const toolsWithEnabled = tools.map((tool) => {
          const toolConfig = serverConfig?.tools?.[tool.name];
          return buildToolWithDescriptionMetadata(tool, toolConfig);
        });

        const promptsWithEnabled = prompts.map((prompt) => {
          const promptConfig = serverConfig?.prompts?.[prompt.name];
          return {
            ...prompt,
            description: resolveDescriptionOverride(prompt.description, promptConfig),
            enabled: promptConfig?.enabled !== false, // Default to true if not explicitly disabled
          };
        });

        return {
          name,
          version,
          instructions,
          owner,
          visibility,
          status,
          error,
          tools: toolsWithEnabled,
          prompts: promptsWithEnabled,
          resources,
          createTime,
          enabled,
          oauth: oauth
            ? {
                authorizationUrl: oauth.authorizationUrl,
                state: oauth.state,
                // Don't expose codeVerifier to frontend for security
              }
            : undefined,
          config:
            resolvedType || serverConfig?.description || serverConfig?.command
              ? {
                  ...(resolvedType ? { type: resolvedType } : {}),
                  ...(serverConfig?.description ? { description: serverConfig.description } : {}),
                  // Expose command so the frontend can determine if reinstall is
                  // supported (npx/uvx only). This is not a secret — it's the
                  // runner binary name (e.g. "npx", "uvx").
                  ...(serverConfig?.command ? { command: serverConfig.command } : {}),
                }
              : undefined,
        };
      },
    );
  // Sorting is now handled at DAO layer for consistent pagination results
  return infos;
};

// Get server by name
export const getServerByName = (name: string): ServerInfo | undefined => {
  return serverInfos.find((serverInfo) => serverInfo.name === name);
};

// Get server by OAuth state parameter
export const getServerByOAuthState = (state: string): ServerInfo | undefined => {
  return serverInfos.find((serverInfo) => serverInfo.oauth?.state === state);
};

/**
 * Reconnect a server after OAuth authorization or configuration change
 * This will close the existing connection and reinitialize the server
 */
export const reconnectServer = async (serverName: string): Promise<void> => {
  console.log(`Reconnecting server: ${serverName}`);

  const serverInfo = getServerByName(serverName);
  if (!serverInfo) {
    throw new Error(`Server not found: ${serverName}`);
  }

  const serverConfig = await getServerDao().findById(serverName);
  if (serverConfig?.enabled === false) {
    console.log(`Skipping reconnect for disabled server: ${serverName}`);
    return;
  }

  // Close existing connection if any
  if (serverInfo.client) {
    try {
      serverInfo.client.close();
    } catch (error) {
      console.warn('Error closing client for server', { serverName, error });
    }
  }

  if (serverInfo.transport) {
    try {
      serverInfo.transport.close();
    } catch (error) {
      console.warn('Error closing transport for server', { serverName, error });
    }
  }

  if (serverInfo.keepAliveIntervalId) {
    clearInterval(serverInfo.keepAliveIntervalId);
    serverInfo.keepAliveIntervalId = undefined;
  }

  // Reinitialize the server
  await initializeClientsFromSettings(false, serverName);

  console.log(`Successfully reconnected server: ${serverName}`);
};

// Reinstall server: clear package cache and reconnect.
// For npx: deletes ~/.npm/_npx before reconnect (--ignore-existing removed in npm 7+).
// For uvx: schedules --refresh flag injection on next spawn via pendingReinstalls Set.
export const reinstallServer = async (serverName: string): Promise<void> => {
  console.log(`Reinstalling server: ${serverName}`);

  const serverInfo = getServerByName(serverName);
  if (!serverInfo) {
    throw new Error(`Server not found: ${serverName}`);
  }

  const serverConfig = await getServerDao().findById(serverName);
  if (!serverConfig) {
    throw new Error(`Server configuration not found: ${serverName}`);
  }

  if (serverConfig.enabled === false) {
    throw new Error(`Cannot reinstall a disabled server: ${serverName}`);
  }

  const command = serverConfig.command;
  if (!command || !supportsCacheRefresh(command)) {
    throw new Error(
      `Server "${serverName}" does not support cache refresh (command: ${command || 'none'}). Only npx and uvx servers are supported.`,
    );
  }

  // Mark server as pending reinstall (consumed by createTransportFromConfig for uvx)
  pendingReinstalls.add(serverName);

  try {
    // For npx, clear cache directory synchronously before reconnect.
    // For uvx, this is a no-op — refresh is handled via --refresh flag injection.
    await clearRunnerCache(command);

    // Close and reconnect (will pick up pendingReinstalls flag for uvx)
    await reconnectServer(serverName);

    console.log(`Successfully initiated reinstall for server: ${serverName}`);
  } catch (error) {
    // Clean up pendingReinstalls on failure to avoid stale entries
    pendingReinstalls.delete(serverName);
    throw error;
  }
};

// Filter tools by server configuration
const filterToolsByConfig = async (serverName: string, tools: Tool[]): Promise<Tool[]> => {
  const serverConfig = await getServerDao().findById(serverName);
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
  const server: ServerConfigWithName = { name, ...config };
  const result = await getServerDao().create(server);
  if (result) {
    return { success: true, message: 'Server added successfully' };
  } else {
    return { success: false, message: 'Failed to add server' };
  }
};

// Remove server
export const removeServer = async (
  name: string,
): Promise<{ success: boolean; message?: string }> => {
  const result = await getServerDao().delete(name);
  if (!result) {
    return { success: false, message: 'Failed to remove server' };
  }

  // Close the client and terminate the underlying child process tree BEFORE
  // dropping the serverInfos reference. Without this, a stdio child launched
  // via npx / npm exec outlives the request and becomes an unkillable orphan
  // that leaks memory until the container is restarted.
  closeServer(name);

  try {
    await removeServerToolEmbeddings(name);
  } catch (error) {
    console.warn('Failed to remove embeddings for server', { serverName: name, error });
  }

  serverInfos = serverInfos.filter((serverInfo) => serverInfo.name !== name);
  return { success: true, message: 'Server removed successfully' };
};

// Add or update server (supports overriding existing servers for MCPB)
export const addOrUpdateServer = async (
  name: string,
  config: ServerConfig,
  allowOverride: boolean = false,
): Promise<{ success: boolean; message?: string }> => {
  try {
    const exists = await getServerDao().exists(name);
    if (exists && !allowOverride) {
      return { success: false, message: 'Server name already exists' };
    }

    // If overriding an existing server, close connections and clear keep-alive timers
    if (exists) {
      // Close existing server connections (clears keep-alive intervals as well)
      closeServer(name);
      // Remove from server infos
      serverInfos = serverInfos.filter((serverInfo) => serverInfo.name !== name);
    }

    if (exists) {
      await getServerDao().update(name, config);
    } else {
      await getServerDao().create({ name, ...config });
    }

    const action = exists ? 'updated' : 'added';
    return { success: true, message: `Server ${action} successfully` };
  } catch (error) {
    console.error('Failed to add/update server', { serverName: name, error });
    return { success: false, message: 'Failed to add/update server' };
  }
};

// Check for authentication error in tool call result
function checkAuthError(result: any) {
  if (Array.isArray(result.content) && result.content.length > 0) {
    const text = result.content[0]?.text;
    if (typeof text === 'string') {
      let errorContent;
      try {
        errorContent = JSON.parse(text);
      } catch (e) {
        // Ignore JSON parse errors and continue
        return;
      }
      // JSON.parse can yield null or a primitive (e.g. text "null", "42",
      // "true") — only an object payload can carry an auth error code, so guard
      // the property access to avoid crashing on non-object results.
      if (errorContent && typeof errorContent === 'object' && errorContent.code === 401) {
        throw new Error('Error POSTing to endpoint (HTTP 401 Unauthorized)');
      }
    }
  }
}

// Close server client and transport
function closeServer(name: string) {
  const serverInfo = serverInfos.find((serverInfo) => serverInfo.name === name);
  if (serverInfo && serverInfo.client && serverInfo.transport) {
    // Clear keep-alive interval if exists
    if (serverInfo.keepAliveIntervalId) {
      clearInterval(serverInfo.keepAliveIntervalId);
      serverInfo.keepAliveIntervalId = undefined;
      console.log(`Cleared keep-alive interval for server: ${serverInfo.name}`);
    }

    // Capture the child PID via duck-typing. `instanceof StdioClientTransport`
    // is unreliable under pnpm's "dual package hazard" — a different copy of
    // @modelcontextprotocol/sdk in node_modules makes the check return false
    // even for genuine stdio transports. The `pid` getter is the SDK's public
    // contract, so checking for it is both safer and version-agnostic.
    const candidateTransport = serverInfo.transport as {
      pid?: unknown;
    };
    const stdioPid = typeof candidateTransport.pid === 'number' ? candidateTransport.pid : null;

    serverInfo.client.close();
    serverInfo.transport.close();

    if (stdioPid) {
      killStdioProcessTree(name, stdioPid);
    }

    console.log(`Closed client and transport for server: ${serverInfo.name}`);
  }
}

// Kill the entire process tree of a stdio transport's child process.
//
// transport.close() only sends SIGTERM to the direct child. When the server is
// launched through a wrapper like `npx` / `npm exec`, the wrapper does not
// forward signals to its descendants, so the real server process is left
// running as an orphan. Walk the whole tree and force-kill it.
function killStdioProcessTree(name: string, pid: number): void {
  const safeTreeKill = (signal: 'SIGTERM' | 'SIGKILL'): void => {
    try {
      treeKill(pid, signal, (err) => {
        if (err) {
          // ESRCH (no such process) is expected when the process already exited
          // — treat as success. Anything else is worth a warning.
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ESRCH') {
            // Pass the user-controlled `name` as a separate argument so a
            // server named e.g. "%s" cannot inject format specifiers into the
            // log line (CodeQL: use-of-externally-controlled-format-string).
            console.warn('Failed to send signal to process tree', {
              serverName: name,
              pid,
              signal,
              err,
            });
          }
        }
      });
    } catch (err) {
      console.warn('Failed to send signal to process tree', {
        serverName: name,
        pid,
        signal,
        err,
      });
    }
  };

  safeTreeKill('SIGTERM');

  setTimeout(() => {
    if (!isProcessAlive(pid)) {
      return;
    }
    safeTreeKill('SIGKILL');
  }, STDIO_KILL_GRACE_PERIOD_MS);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we don't have permission to signal
    // it — count it as alive so the SIGKILL fallback still fires. Any other
    // error (typically ESRCH) means the process is gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Toggle server enabled status
export const toggleServerStatus = async (
  name: string,
  enabled: boolean,
): Promise<{ success: boolean; message?: string }> => {
  try {
    await getServerDao().setEnabled(name, enabled);
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

      // Remove tool embeddings when server is disabled (for smart routing consistency)
      try {
        await removeServerToolEmbeddings(name);
        console.log(`Removed tool embeddings for disabled server: ${name}`);
      } catch (embeddingError) {
        console.warn('Failed to remove embeddings for server', {
          serverName: name,
          error: summarizeErrorForLogging(embeddingError),
        });
      }
    } else {
      // If enabling, reconnect the server to restore connection and sync tool embeddings
      try {
        await initializeClientsFromSettings(false, name);
        console.log(`Re-enabled server ${name} and triggered tool embedding sync`);
      } catch (reconnectError) {
        console.warn('Failed to reconnect server during enable', {
          serverName: name,
          error: summarizeErrorForLogging(reconnectError),
        });
      }
    }

    return { success: true, message: `Server ${enabled ? 'enabled' : 'disabled'} successfully` };
  } catch (error) {
    console.error('Failed to toggle server status', { serverName: name, error });
    return { success: false, message: 'Failed to toggle server status' };
  }
};

type McpAppsRouteContext = {
  enabled: boolean;
  serverInfo?: ServerInfo;
};

const getMcpAppsRouteContext = async (
  sessionId: string,
  group: string | undefined,
): Promise<McpAppsRouteContext> => {
  if (
    !sessionId ||
    isSmartRoutingGroup(group) ||
    !hasMcpAppsCapability(servers[sessionId]?.getClientCapabilities())
  ) {
    return { enabled: false };
  }

  const { filteredServerInfos } = await getFilteredServerInfosForGroup(group);
  if (
    filteredServerInfos.length !== 1 ||
    filteredServerInfos[0].status !== 'connected' ||
    !filteredServerInfos[0].client
  ) {
    return { enabled: false };
  }

  return {
    enabled: true,
    serverInfo: filteredServerInfos[0],
  };
};

const normalizeToolNameForServer = (serverName: string, toolName: string): string => {
  const prefix = `${serverName}${getNameSeparator()}`;
  return toolName.startsWith(prefix) ? toolName.substring(prefix.length) : toolName;
};

const getGroupLookupName = (group: string | undefined): string | undefined => {
  if (group === '$smart') {
    return undefined;
  }
  if (group?.startsWith('$smart/')) {
    return group.substring(7) || undefined;
  }
  return group;
};

const getExposedServerName = (serverName: string, serverConfig?: IGroupServerConfig): string => {
  return serverConfig?.alias?.trim() || serverName;
};

const replacePrefixedServerName = (
  name: string,
  fromServerName: string,
  toServerName: string,
): string => {
  if (fromServerName === toServerName) {
    return name;
  }

  const separator = getNameSeparator();
  const prefix = `${fromServerName}${separator}`;
  return name.startsWith(prefix)
    ? `${toServerName}${separator}${name.substring(prefix.length)}`
    : name;
};

const projectNameForGroup = (
  name: string,
  serverName: string,
  serverConfig?: IGroupServerConfig,
): string => {
  return replacePrefixedServerName(
    name,
    serverName,
    getExposedServerName(serverName, serverConfig),
  );
};

const resolveNameFromGroup = (
  name: string,
  serverName: string,
  serverConfig?: IGroupServerConfig,
): string => {
  return replacePrefixedServerName(
    name,
    getExposedServerName(serverName, serverConfig),
    serverName,
  );
};

const findToolOnServer = (
  serverInfo: ServerInfo,
  toolName: string,
  allowRawName: boolean,
): Tool | undefined => {
  return serverInfo.tools.find(
    (tool) =>
      tool.name === toolName ||
      (allowRawName && normalizeToolNameForServer(serverInfo.name, tool.name) === toolName),
  );
};

const assertToolAvailableForRoute = (tool: Tool, appsRouteContext: McpAppsRouteContext): void => {
  if (isAppOnlyTool(tool) && !appsRouteContext.enabled) {
    throw new Error(`Tool '${tool.name}' is only available to MCP Apps`);
  }
};

const resolveToolInGroup = async (
  group: string | undefined,
  toolName: string,
  allowRawName: boolean,
): Promise<{ serverInfo: ServerInfo; toolName: string; tool: Tool } | undefined> => {
  const lookupGroup = getGroupLookupName(group);
  if (!lookupGroup) {
    return undefined;
  }

  const { filteredServerInfos, serverConfigsByName } =
    await getFilteredServerInfosForGroup(lookupGroup);

  for (const serverInfo of filteredServerInfos) {
    if (serverInfo.status !== 'connected' || serverInfo.enabled === false) {
      continue;
    }

    const serverConfig = serverConfigsByName.get(serverInfo.name);
    const internalToolName = resolveNameFromGroup(toolName, serverInfo.name, serverConfig);
    const tool = findToolOnServer(serverInfo, internalToolName, allowRawName);
    if (!tool) {
      continue;
    }

    const filteredTools = await filterToolsByGroup(
      lookupGroup,
      serverInfo.name,
      [tool],
      serverConfig,
    );
    if (filteredTools.length === 0) {
      continue;
    }

    return { serverInfo, toolName: internalToolName, tool };
  }

  return undefined;
};

async function resolvePromptInGroup(
  group: string | undefined,
  promptName: string,
): Promise<{ serverInfo: ServerInfo; promptName: string } | undefined> {
  const lookupGroup = getGroupLookupName(group);
  if (!lookupGroup) {
    return undefined;
  }

  const { filteredServerInfos, serverConfigsByName } =
    await getFilteredServerInfosForGroup(lookupGroup);

  for (const serverInfo of filteredServerInfos) {
    if (serverInfo.status !== 'connected' || serverInfo.enabled === false) {
      continue;
    }

    const serverConfig = serverConfigsByName.get(serverInfo.name);
    const internalPromptName = resolveNameFromGroup(promptName, serverInfo.name, serverConfig);
    const prompt = serverInfo.prompts.find((item) => item.name === internalPromptName);
    if (!prompt) {
      continue;
    }

    const filteredPrompts = await filterPromptsByGroup(
      lookupGroup,
      serverInfo.name,
      [prompt],
      serverConfig,
    );
    if (filteredPrompts.length === 0) {
      continue;
    }

    return { serverInfo, promptName: internalPromptName };
  }

  return undefined;
}

const projectToolForDownstream = (
  serverName: string,
  tool: Tool,
  appsRouteContext: McpAppsRouteContext,
  serverConfig?: IGroupServerConfig,
): Tool | undefined => {
  if (!appsRouteContext.enabled && isAppOnlyTool(tool)) {
    return undefined;
  }

  const projectedTool = appsRouteContext.enabled ? tool : stripMcpAppsMetadata(tool);
  return {
    ...projectedTool,
    name: appsRouteContext.enabled
      ? normalizeToolNameForServer(serverName, projectedTool.name)
      : projectNameForGroup(projectedTool.name, serverName, serverConfig),
  };
};

export const handleListToolsRequest = async (_: any, extra: any) => {
  const sessionId = extra.sessionId || '';
  const group = getGroup(sessionId);
  console.log(`Handling ListToolsRequest for group: ${group}`);

  // Special handling for $smart group to return smart routing tools
  // Support both $smart and $smart/{group} patterns
  if (isSmartRoutingGroup(group)) {
    return getSmartRoutingTools(group);
  }

  const { filteredServerInfos, serverConfigsByName } = await getFilteredServerInfosForGroup(group);
  const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

  const allTools = [];
  for (const serverInfo of filteredServerInfos) {
    if (serverInfo.tools && serverInfo.tools.length > 0) {
      const groupServerConfig = serverConfigsByName.get(serverInfo.name);

      // Filter tools based on server configuration
      let tools = await filterToolsByConfig(serverInfo.name, serverInfo.tools);

      // If this is a group request, apply group-level tool filtering
      tools = await filterToolsByGroup(group, serverInfo.name, tools, groupServerConfig);

      // Apply custom descriptions from server configuration
      const serverConfig = await getServerDao().findById(serverInfo.name);
      const toolsWithCustomDescriptions = tools.map((tool) => {
        const toolConfig = serverConfig?.tools?.[tool.name];
        return {
          ...tool,
          description: resolveDescriptionOverride(tool.description, toolConfig),
        };
      });

      allTools.push(
        ...toolsWithCustomDescriptions.flatMap((tool) => {
          const projectedTool = projectToolForDownstream(
            serverInfo.name,
            tool,
            appsRouteContext,
            groupServerConfig,
          );
          return projectedTool ? [projectedTool] : [];
        }),
      );
    }
  }

  return {
    tools: allTools,
  };
};

export const handleCallToolRequest = async (request: any, extra: any) => {
  console.log('Handling CallToolRequest for tool', summarizeToolRequestForLogging(request.params));
  const startTime = Date.now();
  const activityLogger = getActivityLoggingService();

  // Get request context for activity logging
  const requestContextService = RequestContextService.getInstance();
  const bearerKeyContext = requestContextService.getBearerKeyContext();
  const sessionId = extra.sessionId || '';

  // Extract group and key info from request context (set by SSE/HTTP handlers)
  // Fallback to extra for backward compatibility (e.g., direct API calls)
  const group =
    requestContextService.getGroupContext() || extra?.group || getGroup(sessionId) || undefined;
  const username =
    requestContextService.getUsernameContext() ||
    extra?.username ||
    (requestContextService.getKeyKindContext() === 'system' ? 'system' : undefined) ||
    undefined;
  let appsRouteContext: McpAppsRouteContext = { enabled: false };
  const keyId = bearerKeyContext.keyId || extra?.keyId || undefined;
  const keyName = bearerKeyContext.keyName || extra?.keyName || undefined;
  const sourceIp = requestContextService.getRequestContext()?.remoteAddress || undefined;
  let hostedReservation: HostedCreditReservation | null = null;

  const reserveHostedIfNeeded = async (serverName: string, toolName: string) => {
    const hostedAuth = requestContextService.getHostedAuthContext();
    assertHostedToolAllowed(hostedAuth, serverName, toolName);
    hostedReservation = await reserveHostedToolCall(hostedAuth, serverName, toolName);
  };

  const settleHostedIfNeeded = async (input: {
    success: boolean;
    requestContent?: unknown;
    responseContent?: unknown;
  }) => {
    const reservation = hostedReservation;
    hostedReservation = null;
    await settleHostedToolCall(reservation, {
      success: input.success,
      latencyMs: Date.now() - startTime,
      requestContent: input.requestContent,
      responseContent: input.responseContent,
    });
  };

  try {
    appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

    // Special handling for smart routing tools
    if (request.params.name === 'search_tools') {
      const { query, limit = 10 } = request.params.arguments || {};
      return await handleSearchToolsRequest(query, limit, sessionId);
    }

    // Special handling for describe_tool (progressive disclosure mode)
    if (request.params.name === 'describe_tool') {
      const { toolName } = request.params.arguments || {};
      return await handleDescribeToolRequest(toolName, sessionId);
    }

    // Special handling for call_tool
    if (request.params.name === 'call_tool') {
      const { toolName } = request.params.arguments || {};
      if (!toolName) {
        throw new Error('toolName parameter is required');
      }

      const { arguments: toolArgs } = request.params.arguments || {};
      let targetServerInfo: ServerInfo | undefined;
      let targetToolName = toolName;
      let targetTool: Tool | undefined;
      if (appsRouteContext.enabled) {
        targetServerInfo = appsRouteContext.serverInfo;
      } else if (extra && extra.server) {
        targetServerInfo = getServerByName(extra.server);
      } else if (getGroupLookupName(group)) {
        const groupTool = await resolveToolInGroup(group, toolName, appsRouteContext.enabled);
        if (groupTool) {
          targetServerInfo = groupTool.serverInfo;
          targetToolName = groupTool.toolName;
          targetTool = groupTool.tool;
        }
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
      const tool =
        targetTool ?? findToolOnServer(targetServerInfo, targetToolName, appsRouteContext.enabled);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found on server '${targetServerInfo.name}'`);
      }
      assertToolAvailableForRoute(tool, appsRouteContext);

      // Handle OpenAPI servers differently
      if (targetServerInfo.openApiClient) {
        // For OpenAPI servers, use the OpenAPI client
        const openApiClient = targetServerInfo.openApiClient;

        // Use toolArgs if it has properties, otherwise fallback to request.params.arguments
        const finalArgs = toolArgs && typeof toolArgs === 'object' ? toolArgs : {};

        console.log('Invoking OpenAPI tool', {
          toolName: targetToolName,
          serverName: targetServerInfo.name,
          arguments: summarizeArgumentsForLogging(finalArgs),
        });

        // Remove server prefix from tool name if present
        const cleanToolName = normalizeToolNameForServer(targetServerInfo.name, targetToolName);

        // Extract passthrough headers from extra or request context
        let passthroughHeaders: Record<string, string> | undefined;
        let requestHeaders: Record<string, string | string[] | undefined> | null = null;

        // Try to get headers from extra parameter first (if available)
        if (extra?.headers) {
          requestHeaders = extra.headers;
        } else {
          // Fallback to request context service
          const requestContextService = RequestContextService.getInstance();
          requestHeaders = requestContextService.getHeaders();
        }

        if (requestHeaders && targetServerInfo.config?.openapi?.passthroughHeaders) {
          passthroughHeaders = {};
          for (const headerName of targetServerInfo.config.openapi.passthroughHeaders) {
            // Handle different header name cases (Express normalizes headers to lowercase)
            const headerValue =
              requestHeaders[headerName] || requestHeaders[headerName.toLowerCase()];
            if (headerValue) {
              passthroughHeaders[headerName] = Array.isArray(headerValue)
                ? headerValue[0]
                : String(headerValue);
            }
          }
        }

        await reserveHostedIfNeeded(targetServerInfo.name, cleanToolName);
        const result = await openApiClient.callTool(cleanToolName, finalArgs, passthroughHeaders);
        await settleHostedIfNeeded({
          success: true,
          requestContent: finalArgs,
          responseContent: result,
        });

        console.log('OpenAPI tool invocation result', {
          serverName: targetServerInfo.name,
          toolName: cleanToolName,
          result: summarizeToolResultForLogging(result),
        });

        // Log successful activity
        const duration = Date.now() - startTime;
        await activityLogger.logToolCall({
          server: targetServerInfo.name,
          tool: cleanToolName,
          duration,
          status: 'success',
          input: finalArgs,
          output: result,
          group,
          username,
          keyId,
          keyName,
          sourceIp,
        });

        return await maybeCompressToolResult(
          {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          },
          {
            serverName: targetServerInfo.name,
            toolName: cleanToolName,
            group,
          },
        );
      }

      // Call the tool on the target server (MCP servers)
      const client = targetServerInfo.client;
      if (!client) {
        throw new Error(`Client not found for server: ${targetServerInfo.name}`);
      }

      // Use toolArgs if it has properties, otherwise fallback to request.params.arguments
      const finalArgs = toolArgs && typeof toolArgs === 'object' ? toolArgs : {};

      console.log('Invoking tool', {
        toolName: targetToolName,
        serverName: targetServerInfo.name,
        arguments: summarizeArgumentsForLogging(finalArgs),
      });

      const cleanToolName = normalizeToolNameForServer(targetServerInfo.name, targetToolName);
      await reserveHostedIfNeeded(targetServerInfo.name, cleanToolName);
      const result = await callToolWithReconnect(
        targetServerInfo,
        {
          name: cleanToolName,
          arguments: finalArgs,
        },
        targetServerInfo.options || {},
      );
      await settleHostedIfNeeded({
        success: !result.isError,
        requestContent: finalArgs,
        responseContent: result,
      });

      console.log('Tool invocation result', {
        serverName: targetServerInfo.name,
        toolName: cleanToolName,
        result: summarizeToolResultForLogging(result),
      });

      // Log successful activity
      const duration = Date.now() - startTime;
      await activityLogger.logToolCall({
        server: targetServerInfo.name,
        tool: cleanToolName,
        duration,
        status: result.isError ? 'error' : 'success',
        input: finalArgs,
        output: result,
        group,
        username,
        keyId,
        keyName,
        sourceIp,
        errorMessage: result.isError ? 'Tool returned error response' : undefined,
      });

      return await maybeCompressToolResult(result, {
        serverName: targetServerInfo.name,
        toolName: cleanToolName,
        group,
      });
    }

    // Regular tool handling
    const lookupGroup = getGroupLookupName(group);
    const groupTool =
      !appsRouteContext.enabled && lookupGroup
        ? await resolveToolInGroup(lookupGroup, request.params.name, appsRouteContext.enabled)
        : undefined;
    const serverInfo = appsRouteContext.enabled
      ? appsRouteContext.serverInfo
      : (groupTool?.serverInfo ??
        (lookupGroup ? undefined : getServerByTool(request.params.name)));
    const routeToolName = groupTool?.toolName ?? request.params.name;
    const tool =
      groupTool?.tool ??
      (serverInfo
        ? findToolOnServer(serverInfo, routeToolName, appsRouteContext.enabled)
        : undefined);
    if (!serverInfo || !tool) {
      throw new Error(`Server not found: ${request.params.name}`);
    }
    assertToolAvailableForRoute(tool, appsRouteContext);

    // Handle OpenAPI servers differently
    if (serverInfo.openApiClient) {
      // For OpenAPI servers, use the OpenAPI client
      const openApiClient = serverInfo.openApiClient;

      // Remove server prefix from tool name if present
      const cleanToolName = normalizeToolNameForServer(serverInfo.name, routeToolName);

      console.log('Invoking OpenAPI tool', {
        toolName: cleanToolName,
        serverName: serverInfo.name,
        arguments: summarizeArgumentsForLogging(request.params.arguments),
      });

      // Extract passthrough headers from extra or request context
      let passthroughHeaders: Record<string, string> | undefined;
      let requestHeaders: Record<string, string | string[] | undefined> | null = null;

      // Try to get headers from extra parameter first (if available)
      if (extra?.headers) {
        requestHeaders = extra.headers;
      } else {
        // Fallback to request context service
        const requestContextService = RequestContextService.getInstance();
        requestHeaders = requestContextService.getHeaders();
      }

      if (requestHeaders && serverInfo.config?.openapi?.passthroughHeaders) {
        passthroughHeaders = {};
        for (const headerName of serverInfo.config.openapi.passthroughHeaders) {
          // Handle different header name cases (Express normalizes headers to lowercase)
          const headerValue =
            requestHeaders[headerName] || requestHeaders[headerName.toLowerCase()];
          if (headerValue) {
            passthroughHeaders[headerName] = Array.isArray(headerValue)
              ? headerValue[0]
              : String(headerValue);
          }
        }
      }

      const finalArgs = request.params.arguments || {};
      await reserveHostedIfNeeded(serverInfo.name, cleanToolName);
      const result = await openApiClient.callTool(cleanToolName, finalArgs, passthroughHeaders);
      await settleHostedIfNeeded({
        success: true,
        requestContent: finalArgs,
        responseContent: result,
      });

      console.log('OpenAPI tool invocation result', {
        serverName: serverInfo.name,
        toolName: cleanToolName,
        result: summarizeToolResultForLogging(result),
      });

      // Log successful activity
      const duration = Date.now() - startTime;
      await activityLogger.logToolCall({
        server: serverInfo.name,
        tool: cleanToolName,
        duration,
        status: 'success',
        input: request.params.arguments,
        output: result,
        group,
        username,
        keyId,
        keyName,
        sourceIp,
      });

      return await maybeCompressToolResult(
        {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        },
        {
          serverName: serverInfo.name,
          toolName: cleanToolName,
          group,
        },
      );
    }

    // Handle MCP servers
    const client = serverInfo.client;
    if (!client) {
      throw new Error(`Client not found for server: ${serverInfo.name}`);
    }

    const cleanToolName = normalizeToolNameForServer(serverInfo.name, routeToolName);
    await reserveHostedIfNeeded(serverInfo.name, cleanToolName);
    const result = await callToolWithReconnect(
      serverInfo,
      { ...request.params, name: cleanToolName },
      serverInfo.options || {},
    );
    await settleHostedIfNeeded({
      success: !result.isError,
      requestContent: request.params.arguments,
      responseContent: result,
    });
    console.log('Tool call result', {
      serverName: serverInfo.name,
      toolName: cleanToolName,
      result: summarizeToolResultForLogging(result),
    });

    // Log successful activity
    const duration = Date.now() - startTime;
    await activityLogger.logToolCall({
      server: serverInfo.name,
      tool: cleanToolName,
      duration,
      status: result.isError ? 'error' : 'success',
      input: request.params.arguments,
      output: result,
      group,
      username,
      keyId,
      keyName,
      sourceIp,
      errorMessage: result.isError ? 'Tool returned error response' : undefined,
    });

    return await maybeCompressToolResult(result, {
      serverName: serverInfo.name,
      toolName: cleanToolName,
      group,
    });
  } catch (error) {
    console.error('Error handling CallToolRequest', summarizeErrorForLogging(error));

    // Log error activity
    const duration = Date.now() - startTime;
    await settleHostedIfNeeded({
      success: false,
      requestContent: getActivityInputFromToolRequest(request),
      responseContent: { error: formatErrorForLogging(error) },
    });
    const activityToolName = getActivityToolNameFromRequest(request);
    const serverInfo =
      (typeof extra?.server === 'string' ? getServerByName(extra.server) : undefined) ||
      getServerByTool(activityToolName);
    const cleanToolName = stripToolServerPrefix(activityToolName, serverInfo?.name);

    await activityLogger.logToolCall({
      server: serverInfo?.name || 'unknown',
      tool: cleanToolName,
      duration,
      status: 'error',
      input: getActivityInputFromToolRequest(request),
      group,
      username,
      keyId,
      keyName,
      sourceIp,
      errorMessage: formatErrorForLogging(error),
    });

    const safeErrorText = formatErrorForLogging(error);

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${safeErrorText}`,
        },
      ],
      isError: true,
    };
  }
};

export const handleGetPromptRequest = async (request: any, extra: any) => {
  try {
    const { name, arguments: promptArgs } = request.params;
    const sessionId = extra?.sessionId || '';
    const group = extra?.group || getGroup(sessionId) || undefined;

    // Check built-in prompts first
    const builtinPrompt = await getBuiltinPromptDao().findByName(name);
    if (builtinPrompt && builtinPrompt.enabled !== false) {
      // Perform {{param}} template substitution
      let content = builtinPrompt.template;
      if (promptArgs) {
        for (const [key, value] of Object.entries(promptArgs)) {
          content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
        }
      }
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: content },
          },
        ],
      };
    }

    let server: ServerInfo | undefined;
    let promptNameForServer = name;
    const lookupGroup = getGroupLookupName(group);
    if (extra && extra.server) {
      server = getServerByName(extra.server);
    } else if (lookupGroup) {
      const groupPrompt = await resolvePromptInGroup(lookupGroup, name);
      if (groupPrompt) {
        server = groupPrompt.serverInfo;
        promptNameForServer = groupPrompt.promptName;
      }
    } else {
      // Find the first server that has this prompt
      server = serverInfos.find(
        (serverInfo) =>
          serverInfo.status === 'connected' &&
          serverInfo.enabled !== false &&
          serverInfo.prompts.find((prompt) => prompt.name === name),
      );
    }
    if (!server) {
      throw new Error(`Server not found: ${name}`);
    }

    // Remove server prefix from prompt name if present
    const separator = getNameSeparator();
    const prefix = `${server.name}${separator}`;
    const cleanPromptName = promptNameForServer.startsWith(prefix)
      ? promptNameForServer.substring(prefix.length)
      : promptNameForServer;

    const promptParams = {
      name: cleanPromptName || '',
      arguments: promptArgs,
    };
    // Log the final promptParams
    console.log('Calling getPrompt with params', {
      name: cleanPromptName || '',
      arguments: summarizeArgumentsForLogging(promptArgs),
    });
    const prompt = await server.client?.getPrompt(promptParams);
    console.log('Received prompt', summarizePromptForLogging(prompt));
    if (!prompt) {
      throw new Error(`Prompt not found: ${cleanPromptName}`);
    }

    return prompt;
  } catch (error) {
    console.error('Error handling GetPromptRequest', summarizeErrorForLogging(error));
    const safeErrorText = formatErrorForLogging(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${safeErrorText}`,
        },
      ],
      isError: true,
    };
  }
};

export const handleListPromptsRequest = async (_: any, extra: any) => {
  const sessionId = extra.sessionId || '';
  const group = getGroup(sessionId);
  const lookupGroup = getGroupLookupName(group);
  console.log(`Handling ListPromptsRequest for group: ${group}`);

  // Start with built-in prompts (only enabled ones)
  const builtinPrompts = await getBuiltinPromptDao().findEnabled();
  const allPrompts: any[] = builtinPrompts.map((bp) =>
    normalizePromptForList({
      name: bp.name,
      title: bp.title,
      description: bp.description,
      arguments: bp.arguments,
    }),
  );

  const { filteredServerInfos, serverConfigsByName } =
    await getFilteredServerInfosForGroup(lookupGroup);

  for (const serverInfo of filteredServerInfos) {
    if (serverInfo.prompts && serverInfo.prompts.length > 0) {
      const groupServerConfig = serverConfigsByName.get(serverInfo.name);

      // Filter prompts based on server configuration
      const serverConfig = await getServerDao().findById(serverInfo.name);

      let enabledPrompts = serverInfo.prompts;
      if (serverConfig && serverConfig.prompts) {
        enabledPrompts = serverInfo.prompts.filter((prompt: any) => {
          const promptConfig = serverConfig.prompts?.[prompt.name];
          // If prompt is not in config, it's enabled by default
          return promptConfig?.enabled !== false;
        });
      }

      enabledPrompts = await filterPromptsByGroup(
        lookupGroup,
        serverInfo.name,
        enabledPrompts,
        groupServerConfig,
      );

      // Apply custom descriptions from server configuration
      const promptsWithCustomDescriptions = enabledPrompts.map((prompt: any) => {
        const promptConfig = serverConfig?.prompts?.[prompt.name];
        return normalizePromptForList({
          ...prompt,
          name: projectNameForGroup(prompt.name, serverInfo.name, groupServerConfig),
          description: promptConfig?.description || prompt.description, // Use custom description if available
        });
      });

      allPrompts.push(...promptsWithCustomDescriptions);
    }
  }

  return {
    prompts: allPrompts,
  };
};

export const handleListResourcesRequest = async (_: any, extra: any) => {
  const sessionId = extra.sessionId || '';
  const group = getGroup(sessionId);
  const lookupGroup = getGroupLookupName(group);
  console.log(`Handling ListResourcesRequest for group: ${group}`);
  const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

  // Start with built-in resources (only enabled ones)
  const builtinResources = await getBuiltinResourceDao().findEnabled();
  const allResources: any[] = builtinResources.map((br) =>
    normalizeResourceForList({
      uri: br.uri,
      name: br.name,
      description: br.description,
      mimeType: br.mimeType,
    }),
  );

  const { filteredServerInfos, serverConfigsByName } =
    await getFilteredServerInfosForGroup(lookupGroup);

  for (const serverInfo of filteredServerInfos) {
    if (serverInfo.resources && serverInfo.resources.length > 0) {
      // Filter resources based on server configuration
      const serverConfig = await getServerDao().findById(serverInfo.name);

      let enabledResources = serverInfo.resources;
      if (serverConfig && serverConfig.resources) {
        enabledResources = serverInfo.resources.filter((resource: any) => {
          const resourceConfig = serverConfig.resources?.[resource.uri];
          return resourceConfig?.enabled !== false;
        });
      }

      enabledResources = await filterResourcesByGroup(
        lookupGroup,
        serverInfo.name,
        enabledResources,
        serverConfigsByName.get(serverInfo.name),
      );

      // Apply custom descriptions from server configuration
      const resourcesWithCustomDescriptions = enabledResources.map((resource: any) => {
        const resourceConfig = serverConfig?.resources?.[resource.uri];
        const normalizedResource = normalizeResourceForList({
          ...resource,
          description: resourceConfig?.description || resource.description,
        });
        return appsRouteContext.enabled
          ? normalizedResource
          : stripMcpAppsMetadata(normalizedResource);
      });

      allResources.push(...resourcesWithCustomDescriptions);
    }
  }

  return {
    resources: allResources,
  };
};

export const handleListResourceTemplatesRequest = async (_: any, extra: any) => {
  const sessionId = extra.sessionId || '';
  const group = getGroup(sessionId);
  const lookupGroup = getGroupLookupName(group);
  console.log(`Handling ListResourceTemplatesRequest for group: ${group}`);
  const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

  const { filteredServerInfos, serverConfigsByName } = await getFilteredServerInfosForGroup(
    lookupGroup,
    {
      requireClient: true,
    },
  );

  const results = await Promise.allSettled(
    filteredServerInfos.map(async (serverInfo) => {
      if (!serverInfo.client?.listResourceTemplates) {
        return [];
      }

      const templates = await serverInfo.client.listResourceTemplates({}, serverInfo.options || {});
      const filteredTemplates = await filterResourceTemplatesByGroup(
        lookupGroup,
        serverInfo.name,
        templates.resourceTemplates || [],
        serverConfigsByName.get(serverInfo.name),
      );
      return appsRouteContext.enabled
        ? filteredTemplates
        : filteredTemplates.map((template) => stripMcpAppsMetadata(template));
    }),
  );

  return {
    resourceTemplates: results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    ),
  };
};

export const handleReadResourceRequest = async (request: any, extra: any) => {
  try {
    const { uri } = request.params;
    const sessionId = extra.sessionId || '';
    const group = getGroup(sessionId);
    const lookupGroup = getGroupLookupName(group);
    const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

    // Check built-in resources first
    const builtinResource = await getBuiltinResourceDao().findByUri(uri);
    if (builtinResource && builtinResource.enabled !== false) {
      return {
        contents: [
          {
            uri: builtinResource.uri,
            mimeType: builtinResource.mimeType || 'text/plain',
            text: builtinResource.content,
          },
        ],
      };
    }

    const { filteredServerInfos, serverConfigsByName } =
      await getFilteredServerInfosForGroup(lookupGroup);

    let server: ServerInfo | undefined;
    for (const serverInfo of filteredServerInfos) {
      if (serverInfo.status !== 'connected') {
        continue;
      }
      const serverConfig = await getServerDao().findById(serverInfo.name);
      let enabledResources = serverInfo.resources;
      if (serverConfig?.resources) {
        enabledResources = enabledResources.filter(
          (resource) => serverConfig.resources?.[resource.uri]?.enabled !== false,
        );
      }
      enabledResources = await filterResourcesByGroup(
        lookupGroup,
        serverInfo.name,
        enabledResources,
        serverConfigsByName.get(serverInfo.name),
      );
      if (enabledResources.some((resource) => resource.uri === uri)) {
        server = serverInfo;
        break;
      }
    }

    if (!server && appsRouteContext.enabled && uri.startsWith('ui://')) {
      server = appsRouteContext.serverInfo;
    }

    if (!server?.client) {
      throw new Error(`Resource not found: ${uri}`);
    }

    const result = await server.client.readResource({ uri });
    if (!result || !Array.isArray(result.contents)) {
      throw new Error(`Failed to read resource: ${uri}`);
    }

    return appsRouteContext.enabled
      ? result
      : {
          ...result,
          contents: result.contents.map((content) => stripMcpAppsMetadata(content)),
        };
  } catch (error) {
    console.error('Error handling ReadResourceRequest', summarizeErrorForLogging(error));
    const safeErrorText = formatErrorForLogging(error);
    return {
      contents: [
        {
          uri: request.params?.uri || '',
          mimeType: 'text/plain',
          text: `Error: ${safeErrorText}`,
        },
      ],
    };
  }
};

// Create McpServer instance
type CreateMcpServerOptions = {
  group?: string;
  instructions?: string;
  appendGroupSuffix?: boolean;
};

export const createMcpServer = (
  name: string,
  version: string,
  options?: string | CreateMcpServerOptions,
): Server => {
  const normalizedOptions = typeof options === 'string' ? { group: options } : (options ?? {});
  // Determine server name based on routing type
  let serverName = name;

  if (normalizedOptions.group && normalizedOptions.appendGroupSuffix !== false) {
    // For createMcpServer we use sync approach since it's called synchronously
    // The actual group validation happens at request time
    serverName = `${name}_${normalizedOptions.group}_group`;
  }
  // If no group, use default name (global routing)

  const server = new Server(
    { name: serverName, version },
    {
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true },
        ...MCP_APPS_CAPABILITIES,
      },
      ...(normalizedOptions.instructions !== undefined
        ? { instructions: normalizedOptions.instructions }
        : {}),
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, handleListToolsRequest);
  server.setRequestHandler(CallToolRequestSchema, handleCallToolRequest);
  server.setRequestHandler(GetPromptRequestSchema, handleGetPromptRequest);
  server.setRequestHandler(ListPromptsRequestSchema, handleListPromptsRequest);
  server.setRequestHandler(ListResourcesRequestSchema, handleListResourcesRequest);
  server.setRequestHandler(ListResourceTemplatesRequestSchema, handleListResourceTemplatesRequest);
  server.setRequestHandler(ReadResourceRequestSchema, handleReadResourceRequest);
  return server;
};

type FilteredGroupServersResult = {
  filteredServerInfos: ServerInfo[];
  serverConfigsByName: Map<string, IGroupServerConfig>;
};

export const getFilteredServerInfosForGroup = async (
  group: string | undefined,
  options?: { requireClient?: boolean },
): Promise<FilteredGroupServersResult> => {
  // Resolve group server configs. We look up the group directly from the DAO
  // rather than going through getServerConfigsInGroup (which calls getAllGroups
  // and applies filterData on groups). Groups don't carry a visibility field,
  // so admin-owned groups would be filtered out for non-admin users even though
  // bearer-key auth already authorized access and individual servers inside the
  // group may be public. Server-level filterData below still enforces per-server
  // visibility. Fix for #914.
  let serverConfigs: IGroupServerConfig[] = [];
  if (group) {
    const groupDao = getGroupDao();
    let foundGroup = await groupDao.findByName(group);
    if (!foundGroup) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(group)) {
        foundGroup = await groupDao.findById(group);
      }
    }
    if (foundGroup) {
      serverConfigs = normalizeGroupServers(foundGroup.servers || []);
    }
  }

  const serverNamesInGroup = new Set(serverConfigs.map((serverConfig) => serverConfig.name));
  const serverConfigsByName = new Map(
    serverConfigs.map((serverConfig) => [serverConfig.name, serverConfig] as const),
  );

  const filteredServerInfos: ServerInfo[] = [];
  for (const serverInfo of getDataService().filterData(serverInfos)) {
    if (serverInfo.enabled === false) continue;
    if (options?.requireClient && !serverInfo.client) continue;

    if (!group) {
      filteredServerInfos.push(serverInfo);
      continue;
    }

    if (serverNamesInGroup.size === 0) {
      if (serverInfo.name === group) {
        filteredServerInfos.push(serverInfo);
      }
      continue;
    }

    if (serverNamesInGroup.has(serverInfo.name)) {
      filteredServerInfos.push(serverInfo);
    }
  }

  return { filteredServerInfos, serverConfigsByName };
};

const getGroupServerConfig = async (
  group: string | undefined,
  serverName: string,
  serverConfig?: IGroupServerConfig,
) => {
  if (!group) {
    return undefined;
  }

  return serverConfig ?? getServerConfigInGroup(group, serverName);
};

// Filter tools based on group configuration
async function filterToolsByGroup(
  group: string | undefined,
  serverName: string,
  tools: Tool[],
  serverConfig?: IGroupServerConfig,
) {
  if (group) {
    const resolvedServerConfig = await getGroupServerConfig(group, serverName, serverConfig);
    if (
      resolvedServerConfig &&
      resolvedServerConfig.tools !== 'all' &&
      Array.isArray(resolvedServerConfig.tools)
    ) {
      // Filter tools based on group configuration
      const allowedToolNames = resolvedServerConfig.tools.map(
        (toolName: string) => `${serverName}${getNameSeparator()}${toolName}`,
      );
      tools = tools.filter((tool) => allowedToolNames.includes(tool.name));
    }
  }

  const hostedAuth = RequestContextService.getInstance().getHostedAuthContext();
  return filterHostedTools(hostedAuth, serverName, tools, getNameSeparator());
}

const normalizePromptNameForGroup = (serverName: string, promptName: string) => {
  const prefix = `${serverName}${getNameSeparator()}`;
  return promptName.startsWith(prefix) ? promptName.substring(prefix.length) : promptName;
};

export async function filterPromptsByGroup(
  group: string | undefined,
  serverName: string,
  prompts: Array<{ name: string }>,
  serverConfig?: IGroupServerConfig,
) {
  if (group) {
    const resolvedServerConfig = await getGroupServerConfig(group, serverName, serverConfig);
    if (
      resolvedServerConfig &&
      resolvedServerConfig.prompts !== 'all' &&
      Array.isArray(resolvedServerConfig.prompts)
    ) {
      const allowedPromptNames = new Set(resolvedServerConfig.prompts);
      return prompts.filter((prompt) =>
        allowedPromptNames.has(normalizePromptNameForGroup(serverName, prompt.name)),
      );
    }
  }

  return prompts;
}

export async function filterResourcesByGroup(
  group: string | undefined,
  serverName: string,
  resources: Array<{ uri: string }>,
  serverConfig?: IGroupServerConfig,
) {
  if (group) {
    const resolvedServerConfig = await getGroupServerConfig(group, serverName, serverConfig);
    if (
      resolvedServerConfig &&
      resolvedServerConfig.resources !== 'all' &&
      Array.isArray(resolvedServerConfig.resources)
    ) {
      const allowedResources = new Set(resolvedServerConfig.resources);
      return resources.filter((resource) => allowedResources.has(resource.uri));
    }
  }

  return resources;
}

const resourceTemplateMatchesSelection = (uriTemplate: string, allowedResources: Set<string>) => {
  if (allowedResources.has(uriTemplate)) {
    return true;
  }

  const dynamicSegmentIndex = uriTemplate.search(/[{*]/);
  if (dynamicSegmentIndex === -1) {
    return false;
  }

  const staticPrefix = uriTemplate.slice(0, dynamicSegmentIndex);
  if (!staticPrefix) {
    return false;
  }

  for (const resourceUri of allowedResources) {
    if (resourceUri.startsWith(staticPrefix)) {
      return true;
    }
  }

  return false;
};

export async function filterResourceTemplatesByGroup(
  group: string | undefined,
  serverName: string,
  resourceTemplates: Array<{ uriTemplate?: string; _meta?: Record<string, unknown> }>,
  serverConfig?: IGroupServerConfig,
) {
  if (group) {
    const resolvedServerConfig = await getGroupServerConfig(group, serverName, serverConfig);
    if (
      resolvedServerConfig &&
      resolvedServerConfig.resources !== 'all' &&
      Array.isArray(resolvedServerConfig.resources)
    ) {
      if (resolvedServerConfig.resources.length === 0) {
        return [];
      }

      const allowedResources = new Set(resolvedServerConfig.resources);
      return resourceTemplates.filter((resourceTemplate) => {
        if (typeof resourceTemplate.uriTemplate !== 'string') {
          return false;
        }

        return resourceTemplateMatchesSelection(resourceTemplate.uriTemplate, allowedResources);
      });
    }
  }

  return resourceTemplates;
}
