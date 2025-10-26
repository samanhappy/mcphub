// Server status types
export type ServerStatus = 'connecting' | 'connected' | 'disconnected' | 'oauth_required';

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

// Cloud Server types (for MCPRouter API)
export interface CloudServer {
  created_at: string;
  updated_at: string;
  name: string;
  author_name: string;
  title: string;
  description: string;
  content: string;
  server_key: string;
  config_name: string;
  server_url: string;
  tools?: CloudServerTool[];
}

export interface CloudServerTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
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

// Prompt types
export interface Prompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{
    name: string;
    title?: string;
    description?: string;
    required?: boolean;
  }>;
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
  prompts?: Record<string, { enabled: boolean; description?: string }>; // Prompt-specific configurations with enable/disable state and custom descriptions
  options?: {
    timeout?: number; // Request timeout in milliseconds
    resetTimeoutOnProgress?: boolean; // Reset timeout on progress notifications
    maxTotalTimeout?: number; // Maximum total timeout in milliseconds
  }; // MCP request options configuration
  // OAuth authentication for upstream MCP servers
  oauth?: {
    clientId?: string; // OAuth client ID
    clientSecret?: string; // OAuth client secret
    scopes?: string[]; // Required OAuth scopes
    accessToken?: string; // Pre-obtained access token (if available)
    refreshToken?: string; // Refresh token for renewing access
    dynamicRegistration?: {
      enabled?: boolean; // Enable/disable dynamic registration
      issuer?: string; // OAuth issuer URL for discovery
      registrationEndpoint?: string; // Direct registration endpoint URL
      metadata?: {
        client_name?: string;
        client_uri?: string;
        logo_uri?: string;
        scope?: string;
        redirect_uris?: string[];
        grant_types?: string[];
        response_types?: string[];
        token_endpoint_auth_method?: string;
        contacts?: string[];
        software_id?: string;
        software_version?: string;
        [key: string]: any;
      };
      initialAccessToken?: string;
    };
    resource?: string; // OAuth resource parameter (RFC8707)
    authorizationEndpoint?: string; // Authorization endpoint (authorization code flow)
    tokenEndpoint?: string; // Token endpoint for exchanging authorization codes for tokens
    pendingAuthorization?: {
      authorizationUrl?: string;
      state?: string;
      codeVerifier?: string;
      createdAt?: number;
    };
  };
  // OpenAPI specific configuration
  openapi?: {
    url?: string; // OpenAPI specification URL
    schema?: Record<string, any>; // Complete OpenAPI JSON schema
    version?: string; // OpenAPI version (default: '3.1.0')
    security?: OpenAPISecurityConfig; // Security configuration for API calls
    passthroughHeaders?: string[]; // Header names to pass through from tool call requests to upstream OpenAPI endpoints
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
  prompts?: Prompt[];
  config?: ServerConfig;
  enabled?: boolean;
  oauth?: {
    authorizationUrl?: string;
    state?: string;
  };
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
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    scopes?: string;
    accessToken?: string;
    refreshToken?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    resource?: string;
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
    // Passthrough headers
    passthroughHeaders?: string; // Comma-separated list of header names
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
  isUsingDefaultPassword?: boolean;
}

// Official Registry types (from registry.modelcontextprotocol.io)
export interface RegistryVariable {
  choices?: string[];
  default?: string;
  description?: string;
  format?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  value?: string;
}

export interface RegistryVariables {
  [key: string]: RegistryVariable;
}

export interface RegistryEnvironmentVariable {
  choices?: string[];
  default?: string;
  description?: string;
  format?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  name: string;
  value?: string;
  variables?: RegistryVariables;
}

export interface RegistryPackageArgument {
  choices?: string[];
  default?: string;
  description?: string;
  format?: string;
  isRepeated?: boolean;
  isRequired?: boolean;
  isSecret?: boolean;
  name: string;
  type?: string;
  value?: string;
  valueHint?: string;
  variables?: RegistryVariables;
}

export interface RegistryTransportHeader {
  choices?: string[];
  default?: string;
  description?: string;
  format?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  name: string;
  value?: string;
  variables?: RegistryVariables;
}

export interface RegistryTransport {
  headers?: RegistryTransportHeader[];
  type: string;
  url?: string;
}

export interface RegistryPackage {
  environmentVariables?: RegistryEnvironmentVariable[];
  fileSha256?: string;
  identifier: string;
  packageArguments?: RegistryPackageArgument[];
  registryBaseUrl?: string;
  registryType: string;
  runtimeArguments?: RegistryPackageArgument[];
  runtimeHint?: string;
  transport?: RegistryTransport;
  version?: string;
}

export interface RegistryRemote {
  headers?: RegistryTransportHeader[];
  type: string;
  url: string;
}

export interface RegistryRepository {
  id?: string;
  source?: string;
  subfolder?: string;
  url?: string;
}

export interface RegistryIcon {
  mimeType: string;
  sizes?: string[];
  src: string;
  theme?: string;
}

export interface RegistryServerData {
  $schema?: string;
  _meta?: {
    'io.modelcontextprotocol.registry/publisher-provided'?: Record<string, any>;
  };
  description: string;
  icons?: RegistryIcon[];
  name: string;
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
  repository?: RegistryRepository;
  title: string;
  version: string;
  websiteUrl?: string;
}

export interface RegistryOfficialMeta {
  isLatest?: boolean;
  publishedAt?: string;
  status?: string;
  updatedAt?: string;
}

export interface RegistryServerEntry {
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: RegistryOfficialMeta;
  };
  server: RegistryServerData;
}

export interface RegistryMetadata {
  count: number;
  nextCursor?: string;
}

export interface RegistryServersResponse {
  metadata: RegistryMetadata;
  servers: RegistryServerEntry[];
}

export interface RegistryServerVersionsResponse {
  metadata: RegistryMetadata;
  servers: RegistryServerEntry[];
}

export interface RegistryServerVersionResponse {
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: RegistryOfficialMeta;
  };
  server: RegistryServerData;
}
