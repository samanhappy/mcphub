import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { SmartRoutingConfig } from '../utils/smartRouting.js';

// User interface
export interface IUser {
  username: string;
  password: string;
  isAdmin?: boolean;
}

// Group interface for server grouping
export interface IGroup {
  id: string; // Unique UUID for the group
  name: string; // Display name of the group
  description?: string; // Optional description of the group
  servers: string[] | IGroupServerConfig[]; // Array of server names or server configurations that belong to this group
  owner?: string; // Owner of the group, defaults to 'admin' user
}

// Server configuration within a group - supports tool selection
export interface IGroupServerConfig {
  name: string; // Server name
  tools?: string[] | 'all'; // Array of specific tool names to include, or 'all' for all tools (default: 'all')
}

// Market server types
export interface MarketServerRepository {
  type: string;
  url: string;
}

export interface MarketServerAuthor {
  name: string;
}

export interface MarketServerInstallation {
  type: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MarketServerArgument {
  description: string;
  required: boolean;
  example: string;
}

export interface MarketServerExample {
  title: string;
  description: string;
  prompt: string;
}

export interface MarketServerTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface MarketServer {
  name: string;
  display_name: string;
  description: string;
  repository: MarketServerRepository;
  homepage: string;
  author: MarketServerAuthor;
  license: string;
  categories: string[];
  tags: string[];
  examples: MarketServerExample[];
  installations: {
    [key: string]: MarketServerInstallation;
  };
  arguments: Record<string, MarketServerArgument>;
  tools: MarketServerTool[];
  is_official?: boolean;
}

export interface SystemConfig {
  routing?: {
    enableGlobalRoute?: boolean; // Controls whether the /sse endpoint without group is enabled
    enableGroupNameRoute?: boolean; // Controls whether group routing by name is allowed
    enableBearerAuth?: boolean; // Controls whether bearer auth is enabled for group routes
    bearerAuthKey?: string; // The bearer auth key to validate against
    skipAuth?: boolean; // Controls whether authentication is required for frontend and API access
  };
  install?: {
    pythonIndexUrl?: string; // Python package repository URL (UV_DEFAULT_INDEX)
    npmRegistry?: string; // NPM registry URL (npm_config_registry)
    baseUrl?: string; // Base URL for group card copy operations
  };
  smartRouting?: SmartRoutingConfig;
}

export interface UserConfig {
  routing?: {
    enableGlobalRoute?: boolean; // Controls whether the /sse endpoint without group is enabled
    enableGroupNameRoute?: boolean; // Controls whether group routing by name is allowed
    enableBearerAuth?: boolean; // Controls whether bearer auth is enabled for group routes
    bearerAuthKey?: string; // The bearer auth key to validate against
  };
}

// Represents the settings for MCP servers
export interface McpSettings {
  users?: IUser[]; // Array of user credentials and permissions
  mcpServers: {
    [key: string]: ServerConfig; // Key-value pairs of server names and their configurations
  };
  groups?: IGroup[]; // Array of server groups
  systemConfig?: SystemConfig; // System-wide configuration settings
  userConfigs?: Record<string, UserConfig>; // User-specific configurations
}

// Configuration details for an individual server
export interface ServerConfig {
  type?: 'stdio' | 'sse' | 'streamable-http' | 'openapi'; // Type of server
  url?: string; // URL for SSE or streamable HTTP servers
  command?: string; // Command to execute for stdio-based servers
  args?: string[]; // Arguments for the command
  env?: Record<string, string>; // Environment variables
  headers?: Record<string, string>; // HTTP headers for SSE/streamable-http/openapi servers
  enabled?: boolean; // Flag to enable/disable the server
  owner?: string; // Owner of the server, defaults to 'admin' user
  keepAliveInterval?: number; // Keep-alive ping interval in milliseconds (default: 60000ms for SSE servers)
  tools?: Record<string, { enabled: boolean; description?: string }>; // Tool-specific configurations with enable/disable state and custom descriptions
  options?: Partial<Pick<RequestOptions, 'timeout' | 'resetTimeoutOnProgress' | 'maxTotalTimeout'>>; // MCP request options configuration
  // OpenAPI specific configuration
  openapi?: {
    url?: string; // OpenAPI specification URL
    schema?: Record<string, any>; // Complete OpenAPI JSON schema
    version?: string; // OpenAPI version (default: '3.1.0')
    security?: OpenAPISecurityConfig; // Security configuration for API calls
  };
}

// OpenAPI Security Configuration
export interface OpenAPISecurityConfig {
  type: 'none' | 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  // API Key authentication
  apiKey?: {
    name: string; // Header/query/cookie name
    in: 'header' | 'query' | 'cookie';
    value: string; // The API key value
  };
  // HTTP authentication (Basic, Bearer, etc.)
  http?: {
    scheme: 'basic' | 'bearer' | 'digest'; // HTTP auth scheme
    bearerFormat?: string; // Bearer token format (e.g., JWT)
    credentials?: string; // Base64 encoded credentials for basic auth or bearer token
  };
  // OAuth2 (simplified - mainly for bearer tokens)
  oauth2?: {
    tokenUrl?: string; // Token endpoint for client credentials flow
    clientId?: string;
    clientSecret?: string;
    scopes?: string[]; // Required scopes
    token?: string; // Pre-obtained access token
  };
  // OpenID Connect
  openIdConnect?: {
    url: string; // OpenID Connect discovery URL
    clientId?: string;
    clientSecret?: string;
    token?: string; // Pre-obtained ID token
  };
}

// Information about a server's status and tools
export interface ServerInfo {
  name: string; // Unique name of the server
  owner?: string; // Owner of the server, defaults to 'admin' user
  status: 'connected' | 'connecting' | 'disconnected'; // Current connection status
  error: string | null; // Error message if any
  tools: ToolInfo[]; // List of tools available on the server
  client?: Client; // Client instance for communication (MCP clients)
  transport?: SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport; // Transport mechanism used
  openApiClient?: any; // OpenAPI client instance for openapi type servers
  options?: RequestOptions; // Options for requests
  createTime: number; // Timestamp of when the server was created
  enabled?: boolean; // Flag to indicate if the server is enabled
  keepAliveIntervalId?: NodeJS.Timeout; // Timer ID for keep-alive ping interval
}

// Details about a tool available on the server
export interface ToolInfo {
  name: string; // Name of the tool
  description: string; // Brief description of the tool
  inputSchema: Record<string, unknown>; // Input schema for the tool
  enabled?: boolean; // Whether the tool is enabled (optional, defaults to true)
}

// Standardized API response structure
export interface ApiResponse<T = unknown> {
  success: boolean; // Indicates if the operation was successful
  message?: string; // Optional message providing additional details
  data?: T; // Optional data payload
}

// Request payload for adding a new server
export interface AddServerRequest {
  name: string; // Name of the server to add
  config: ServerConfig; // Configuration details for the server
}
