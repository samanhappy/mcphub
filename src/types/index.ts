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

// Represents the settings for MCP servers
export interface McpSettings {
  users?: IUser[]; // Array of user credentials and permissions
  mcpServers: {
    [key: string]: ServerConfig; // Key-value pairs of server names and their configurations
  };
  groups?: IGroup[]; // Array of server groups
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
