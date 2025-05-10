import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// User interface
export interface IUser {
  username: string;
  password: string;
  isAdmin?: boolean;
}

// Group interface for server grouping
export interface IGroup {
  id: string;        // Unique UUID for the group
  name: string;      // Display name of the group
  description?: string; // Optional description of the group
  servers: string[]; // Array of server names that belong to this group
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

// Represents the settings for MCP servers
export interface McpSettings {
  users?: IUser[]; // Array of user credentials and permissions
  mcpServers: {
    [key: string]: ServerConfig; // Key-value pairs of server names and their configurations
  };
  groups?: IGroup[]; // Array of server groups
  systemConfig?: {
    routing?: {
      enableGlobalRoute?: boolean; // Controls whether the /sse endpoint without group is enabled
      enableGroupNameRoute?: boolean; // Controls whether group routing by name is allowed
    };
    install?: {
      pythonIndexUrl?: string; // Python package repository URL (UV_DEFAULT_INDEX)
    };
    // Add other system configuration sections here in the future
  };
}

// Configuration details for an individual server
export interface ServerConfig {
  url?: string; // URL for SSE-based servers
  command?: string; // Command to execute for stdio-based servers
  args?: string[]; // Arguments for the command
  env?: Record<string, string>; // Environment variables
  enabled?: boolean; // Flag to enable/disable the server
}

// Information about a server's status and tools
export interface ServerInfo {
  name: string; // Unique name of the server
  status: 'connected' | 'connecting' | 'disconnected'; // Current connection status
  error: string | null; // Error message if any
  tools: ToolInfo[]; // List of tools available on the server
  client?: Client; // Client instance for communication
  transport?: SSEClientTransport | StdioClientTransport; // Transport mechanism used
  createTime: number; // Timestamp of when the server was created
  enabled?: boolean; // Flag to indicate if the server is enabled
}

// Details about a tool available on the server
export interface ToolInfo {
  name: string; // Name of the tool
  description: string; // Brief description of the tool
  inputSchema: Record<string, unknown>; // Input schema for the tool
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
