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

// Cloud Market Server types (for MCPRouter API)
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
  tools?: CloudTool[];
}

export interface CloudTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

// MCPRouter API Response types
export interface MCPRouterResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

export interface MCPRouterListServersResponse {
  servers: CloudServer[];
}

export interface MCPRouterListToolsResponse {
  tools: CloudTool[];
}

export interface MCPRouterCallToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError: boolean;
}

// OAuth Provider Configuration for MCP Authorization Server
export interface OAuthProviderConfig {
  enabled?: boolean; // Enable/disable OAuth provider
  issuerUrl: string; // Authorization server's issuer identifier (e.g., 'http://auth.external.com')
  baseUrl?: string; // Base URL for the authorization server metadata endpoints (defaults to issuerUrl)
  serviceDocumentationUrl?: string; // URL for human-readable OAuth documentation
  scopesSupported?: string[]; // List of OAuth scopes supported
  endpoints: {
    authorizationUrl: string; // External OAuth authorization endpoint
    tokenUrl: string; // External OAuth token endpoint
    revocationUrl?: string; // External OAuth revocation endpoint (optional)
  };
  // Token verification function details
  verifyAccessToken?: {
    endpoint?: string; // Optional: External endpoint to verify access tokens
    headers?: Record<string, string>; // Optional: Headers for token verification requests
  };
  // Client management
  clients?: Array<{
    client_id: string; // Client identifier
    redirect_uris: string[]; // Allowed redirect URIs for this client
    scopes?: string[]; // Scopes this client can request
  }>;
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
  mcpRouter?: {
    apiKey?: string; // MCPRouter API key for authentication
    referer?: string; // Referer header for MCPRouter API requests
    title?: string; // Title header for MCPRouter API requests
    baseUrl?: string; // Base URL for MCPRouter API (default: https://api.mcprouter.to/v1)
  };
  nameSeparator?: string; // Separator used between server name and tool/prompt name (default: '-')
  oauth?: OAuthProviderConfig; // OAuth provider configuration for upstream MCP servers
  oauthServer?: OAuthServerConfig; // OAuth authorization server configuration for MCPHub itself
  enableSessionRebuild?: boolean; // Controls whether server session rebuild is enabled
}

export interface UserConfig {}

// OAuth Client for MCPHub's own authorization server
export interface IOAuthClient {
  clientId: string; // OAuth client ID
  clientSecret?: string; // OAuth client secret (optional for public clients with PKCE)
  name: string; // Human-readable client name
  redirectUris: string[]; // Allowed redirect URIs
  grants: string[]; // Allowed grant types (e.g., ['authorization_code', 'refresh_token'])
  scopes?: string[]; // Allowed scopes for this client
  owner?: string; // Owner of the OAuth client, defaults to 'admin' user
  metadata?: {
    // RFC 7591 Client Metadata
    application_type?: 'web' | 'native'; // Application type
    response_types?: string[]; // OAuth response types
    token_endpoint_auth_method?: string; // Token endpoint authentication method
    contacts?: string[]; // Array of contact emails
    logo_uri?: string; // URL of the client logo
    client_uri?: string; // URL of the client's homepage
    policy_uri?: string; // URL of the client's policy document
    tos_uri?: string; // URL of the client's terms of service
    jwks_uri?: string; // URL of the client's JSON Web Key Set
    jwks?: object; // Client's JSON Web Key Set
  };
}

// OAuth Authorization Code (for MCPHub's authorization server)
export interface IOAuthAuthorizationCode {
  code: string; // Authorization code
  expiresAt: Date; // Expiration time
  redirectUri: string; // Redirect URI used in the authorization request
  scope?: string; // Granted scopes
  clientId: string; // Client ID
  username: string; // User who authorized
  codeChallenge?: string; // PKCE code challenge
  codeChallengeMethod?: string; // PKCE code challenge method
}

// OAuth Token (for MCPHub's authorization server)
export interface IOAuthToken {
  accessToken: string; // Access token
  accessTokenExpiresAt: Date; // Access token expiration
  refreshToken?: string; // Refresh token (optional)
  refreshTokenExpiresAt?: Date; // Refresh token expiration
  scope?: string; // Granted scopes
  clientId: string; // Client ID
  username: string; // Username
}

// OAuth Server Configuration
export interface OAuthServerConfig {
  enabled?: boolean; // Enable/disable OAuth authorization server
  accessTokenLifetime?: number; // Access token lifetime in seconds (default: 3600)
  refreshTokenLifetime?: number; // Refresh token lifetime in seconds (default: 1209600 = 14 days)
  authorizationCodeLifetime?: number; // Authorization code lifetime in seconds (default: 300 = 5 minutes)
  requireClientSecret?: boolean; // Whether client secret is required (default: false for PKCE support)
  allowedScopes?: string[]; // List of allowed OAuth scopes (default: ['read', 'write'])
  requireState?: boolean; // Whether the state parameter is required during authorization (default: false)
  dynamicRegistration?: {
    enabled?: boolean; // Enable/disable RFC 7591 dynamic client registration
    allowedGrantTypes?: string[]; // Allowed grant types for dynamic registration (default: ['authorization_code', 'refresh_token'])
    requiresAuthentication?: boolean; // Whether initial registration requires authentication (default: false for public registration)
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
  oauthClients?: IOAuthClient[]; // OAuth clients for MCPHub's authorization server
  oauthTokens?: IOAuthToken[]; // Persisted OAuth tokens (access + refresh) for authorization server
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
  prompts?: Record<string, { enabled: boolean; description?: string }>; // Prompt-specific configurations with enable/disable state and custom descriptions
  options?: Partial<Pick<RequestOptions, 'timeout' | 'resetTimeoutOnProgress' | 'maxTotalTimeout'>>; // MCP request options configuration
  // OAuth authentication for upstream MCP servers
  oauth?: {
    // Static client configuration (traditional OAuth flow)
    clientId?: string; // OAuth client ID
    clientSecret?: string; // OAuth client secret
    scopes?: string[]; // Required OAuth scopes
    accessToken?: string; // Pre-obtained access token (if available)
    refreshToken?: string; // Refresh token for renewing access

    // Dynamic client registration (RFC7591)
    // If not explicitly configured, will auto-detect via WWW-Authenticate header on 401 responses
    dynamicRegistration?: {
      enabled?: boolean; // Enable/disable dynamic registration (default: auto-detect on 401)
      issuer?: string; // OAuth issuer URL for discovery (e.g., 'https://auth.example.com')
      registrationEndpoint?: string; // Direct registration endpoint URL (if discovery is not used)
      metadata?: {
        // Client metadata for registration (RFC7591 section 2)
        client_name?: string; // Human-readable client name
        client_uri?: string; // URL of client's home page
        logo_uri?: string; // URL of client's logo
        scope?: string; // Space-separated list of scope values
        redirect_uris?: string[]; // Array of redirect URIs
        grant_types?: string[]; // Array of OAuth 2.0 grant types (e.g., ['authorization_code', 'refresh_token'])
        response_types?: string[]; // Array of OAuth 2.0 response types (e.g., ['code'])
        token_endpoint_auth_method?: string; // Token endpoint authentication method (e.g., 'client_secret_basic', 'none')
        contacts?: string[]; // Array of contact email addresses
        software_id?: string; // Unique identifier for the client software
        software_version?: string; // Version of the client software
        [key: string]: any; // Additional metadata fields
      };
      // Optional: Initial access token for protected registration endpoints
      initialAccessToken?: string;
    };

    // MCP resource parameter (RFC8707) - the canonical URI of the MCP server
    resource?: string; // e.g., 'https://mcp.example.com/mcp'

    // Authorization endpoint for user authorization (for authorization code flow)
    authorizationEndpoint?: string;
    // Token endpoint for exchanging authorization codes for tokens
    tokenEndpoint?: string;
    // Pending OAuth session metadata for PKCE/state recovery between restarts
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

// Information about a server's status and tools
export interface ServerInfo {
  name: string; // Unique name of the server
  owner?: string; // Owner of the server, defaults to 'admin' user
  status: 'connected' | 'connecting' | 'disconnected' | 'oauth_required'; // Current connection status
  error: string | null; // Error message if any
  tools: Tool[]; // List of tools available on the server
  prompts: Prompt[]; // List of prompts available on the server
  client?: Client; // Client instance for communication (MCP clients)
  transport?: SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport; // Transport mechanism used
  openApiClient?: any; // OpenAPI client instance for openapi type servers
  options?: RequestOptions; // Options for requests
  createTime: number; // Timestamp of when the server was created
  enabled?: boolean; // Flag to indicate if the server is enabled
  keepAliveIntervalId?: NodeJS.Timeout; // Timer ID for keep-alive ping interval
  config?: ServerConfig; // Reference to the original server configuration for OpenAPI passthrough headers
  oauth?: {
    // OAuth authorization state
    authorizationUrl?: string; // OAuth authorization URL for user to visit
    state?: string; // OAuth state parameter for CSRF protection
    codeVerifier?: string; // PKCE code verifier
  };
}

// Details about a tool available on the server
export interface Tool {
  name: string; // Name of the tool
  description: string; // Brief description of the tool
  inputSchema: Record<string, unknown>; // Input schema for the tool
  enabled?: boolean; // Whether the tool is enabled (optional, defaults to true)
}

export interface Prompt {
  name: string; // Name of the prompt
  title?: string; // Title of the prompt
  description?: string; // Brief description of the prompt
  arguments?: PromptArgument[]; // Input schema for the prompt
}

export interface PromptArgument {
  name: string; // Name of the argument
  title?: string; // Title of the argument
  description?: string; // Brief description of the argument
  required?: boolean; // Whether the argument is required
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
