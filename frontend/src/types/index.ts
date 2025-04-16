// Server status types
export type ServerStatus = 'connecting' | 'connected' | 'disconnected';

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
}

// Server config types
export interface ServerConfig {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

// Server types
export interface Server {
  name: string;
  status: ServerStatus;
  tools?: Tool[];
  config?: ServerConfig;
  enabled?: boolean;
}

// Group types
export interface Group {
  id: string;
  name: string;
  description?: string;
  servers: string[];
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
  env: EnvVar[];
}

// Group form data types
export interface GroupFormData {
  name: string;
  description: string;
  servers: string[]; // Added servers array to include in form data
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