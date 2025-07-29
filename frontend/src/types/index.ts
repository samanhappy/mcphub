// Server status types
export type ServerStatus = 'connecting' | 'connected' | 'disconnected';

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

// Tool input schema types
export interface ToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

// Tool types
export interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  enabled?: boolean;
}

// Server config types
export interface ServerConfig {
  type?: 'stdio' | 'sse' | 'streamable-http' | 'openapi';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  tools?: Record<string, { enabled: boolean; description?: string }>; // Tool-specific configurations with enable/disable state and custom descriptions
  options?: {
    timeout?: number; // Request timeout in milliseconds
    resetTimeoutOnProgress?: boolean; // Reset timeout on progress notifications
    maxTotalTimeout?: number; // Maximum total timeout in milliseconds
  }; // MCP request options configuration
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

// Server types
export interface Server {
  name: string;
  status: ServerStatus;
  error?: string;
  tools?: Tool[];
  config?: ServerConfig;
  enabled?: boolean;
}

// Group types
// Group server configuration - supports tool selection
export interface IGroupServerConfig {
  name: string; // Server name
  tools?: string[] | 'all'; // Array of specific tool names to include, or 'all' for all tools (default: 'all')
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  servers: string[] | IGroupServerConfig[]; // Supports both old and new format
}

// Environment variable types
export interface EnvVar {
  key: string;
  value: string;
}

// Form data types
export interface ServerFormData {
  name: string;
  url: string;
  command: string;
  arguments: string;
  args?: string[]; // Added explicit args field
  type?: 'stdio' | 'sse' | 'streamable-http' | 'openapi'; // Added type field with openapi support
  env: EnvVar[];
  headers: EnvVar[];
  options?: {
    timeout?: number;
    resetTimeoutOnProgress?: boolean;
    maxTotalTimeout?: number;
  };
  // OpenAPI specific fields
  openapi?: {
    url?: string;
    schema?: string; // JSON schema as string for form input
    inputMode?: 'url' | 'schema'; // Mode to determine input type
    version?: string;
    securityType?: 'none' | 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
    // API Key fields
    apiKeyName?: string;
    apiKeyIn?: 'header' | 'query' | 'cookie';
    apiKeyValue?: string;
    // HTTP auth fields
    httpScheme?: 'basic' | 'bearer' | 'digest';
    httpCredentials?: string;
    // OAuth2 fields
    oauth2TokenUrl?: string;
    oauth2ClientId?: string;
    oauth2ClientSecret?: string;
    oauth2Token?: string;
    // OpenID Connect fields
    openIdConnectUrl?: string;
    openIdConnectClientId?: string;
    openIdConnectClientSecret?: string;
    openIdConnectToken?: string;
  };
}

// Group form data types
export interface GroupFormData {
  name: string;
  description: string;
  servers: string[] | IGroupServerConfig[]; // Updated to support new format
}

// API response types
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

// Auth types
export interface IUser {
  username: string;
  isAdmin?: boolean;
  permissions?: string[];
}

// User management types
export interface User {
  username: string;
  isAdmin: boolean;
}

export interface UserFormData {
  username: string;
  password: string;
  isAdmin: boolean;
}

export interface UserUpdateData {
  isAdmin?: boolean;
  newPassword?: string;
}

export interface UserStats {
  totalUsers: number;
  adminUsers: number;
  regularUsers: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: IUser | null;
  loading: boolean;
  error: string | null;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterCredentials extends LoginCredentials {
  isAdmin?: boolean;
}

export interface ChangePasswordCredentials {
  currentPassword: string;
  newPassword: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: IUser;
  message?: string;
}
