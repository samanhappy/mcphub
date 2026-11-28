import type React from 'react';
import type { ApiResponse, BearerKey, BearerKeyWritePayload, FileStagingConfig } from '@/types';
import type { FakeIpException } from '../../../src/types/network.js';
import type { ToolPolicyRule } from '../../../src/types/toolPolicy.js';

export type SettingsSectionKey =
  | 'routing'
  | 'install'
  | 'smartRouting'
  | 'toolResultCompression'
  | 'fileStaging'
  | 'mcpRouter'
  | 'oauthServer'
  | 'allowRegistration'
  | 'betterAuth'
  | 'nameSeparator'
  | 'normalizeToolNames'
  | 'sessionRebuild'
  | 'toolPolicies'
  | 'fakeIpExceptions'
  | 'allowedCidrs'
  | 'storeToolPayload'
  | 'skillImportProxy'
  | 'exportConfig'
  | 'bearerKeys';

export interface RoutingConfig {
  enableGlobalRoute: boolean;
  enableGroupNameRoute: boolean;
  enableBearerAuth: boolean;
  bearerAuthKey: string;
  bearerAuthHeaderName: string;
  allowAuthorizationPassthrough: boolean;
  jsonBodyLimit: string;
  skipAuth: boolean;
}

export interface InstallConfig {
  pythonIndexUrl: string;
  npmRegistry: string;
  baseUrl: string;
}

export interface SmartRoutingCodeModeConfig {
  enabled: boolean;
  readOnlyVariantEnabled: boolean;
  timeoutMs: number;
  cpuTimeoutMs: number;
  memoryLimitMb: number;
  maxToolCalls: number;
  maxSourceBytes: number;
  maxLogBytes: number;
  maxToolResultBytes: number;
  maxOutputBytes: number;
  maxConcurrentRuns: number;
}

export const DEFAULT_SMART_ROUTING_CODE_MODE: SmartRoutingCodeModeConfig = {
  enabled: false,
  readOnlyVariantEnabled: true,
  timeoutMs: 30000,
  cpuTimeoutMs: 5000,
  memoryLimitMb: 32,
  maxToolCalls: 20,
  maxSourceBytes: 32768,
  maxLogBytes: 16384,
  maxToolResultBytes: 524288,
  maxOutputBytes: 65536,
  maxConcurrentRuns: 4,
};

export const mergeSmartRoutingConfigUpdate = (
  prev: SmartRoutingConfig,
  updates: Partial<SmartRoutingConfig>,
): SmartRoutingConfig => ({
  ...prev,
  ...updates,
  ...(updates.codeMode
    ? {
        codeMode: {
          ...(prev.codeMode ?? DEFAULT_SMART_ROUTING_CODE_MODE),
          ...updates.codeMode,
        },
      }
    : {}),
});

export interface SmartRoutingConfig {
  enabled: boolean;
  dbUrl: string;
  basePacingDelayMs?: number | null;
  embeddingProvider?: 'openai' | 'azure_openai';
  embeddingEncodingFormat?: 'auto' | 'base64' | 'float';
  embeddingDimensions?: number | null;
  embeddingDimensionsApiPassthrough: boolean;
  llmProviderBaseUrl: string;
  llmProviderApiKey: string;
  embeddingModel: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiApiKey?: string;
  azureOpenaiApiVersion?: string;
  azureOpenaiEmbeddingDeployment?: string;
  azureOpenaiEmbeddingModel?: string;
  progressiveDisclosure: boolean;
  embeddingMaxTokens?: number | null;
  embeddingQueryPrefix?: string;
  embeddingDocumentPrefix?: string;
  similarityThreshold?: number | null;
  fullSchemaTopN?: number | null;
  // Unset = server default (title, annotations)
  toolDefinitionFields?: string[];
  codeMode?: SmartRoutingCodeModeConfig;
  /**
   * Read-only metadata from the server (issue #642): fields whose runtime value
   * comes from an environment variable, so whatever is typed into the form for
   * them is currently ignored. Never sent back on save.
   */
  envOverriddenFields?: Array<{ field: string; envVar: string }>;
}

export type ToolResultCompressionStrategy = 'auto' | 'json' | 'log' | 'search' | 'diff' | 'text';

export interface ToolResultCompressionConfig {
  enabled: boolean;
  minTokens: number;
  maxOutputTokens: number;
  strategy: ToolResultCompressionStrategy;
}

export interface MCPRouterConfig {
  apiKey: string;
  referer: string;
  title: string;
  baseUrl: string;
}

export interface OAuthServerConfig {
  alwaysShowApprovalScreen: boolean;
  approvalLifetime: number;
  enabled: boolean;
  accessTokenLifetime: number;
  refreshTokenLifetime: number;
  authorizationCodeLifetime: number;
  requireClientSecret: boolean;
  allowedScopes: string[];
  requireState: boolean;
  dynamicRegistration: {
    enabled: boolean;
    allowedGrantTypes: string[];
    requiresAuthentication: boolean;
    clientTtl: number;
  };
}

export interface BetterAuthProviderToggle {
  enabled: boolean;
}

export interface BetterAuthOidcConfig {
  enabled: boolean;
  providerId: string;
  discoveryUrl: string;
  scopes: string[];
  pkce: boolean;
  prompt: string;
}

export interface BetterAuthConfig {
  enabled: boolean;
  baseUrl: string;
  basePath: string;
  trustedOrigins: string[];
  disablePasswordLogin: boolean;
  providers: {
    google: BetterAuthProviderToggle;
    github: BetterAuthProviderToggle;
    oidc: BetterAuthOidcConfig;
  };
}

export interface SystemSettings {
  systemConfig?: {
    toolPolicies?: ToolPolicyRule[];
    routing?: RoutingConfig;
    install?: InstallConfig & { skillImportProxy?: string };
    smartRouting?: SmartRoutingConfig;
    toolResultCompression?: ToolResultCompressionConfig;
    fileStaging?: FileStagingConfig;
    mcpRouter?: MCPRouterConfig;
    normalizeToolNames?: boolean;
    nameSeparator?: string;
    oauthServer?: OAuthServerConfig;
    auth?: {
      allowRegistration?: boolean;
      betterAuth?: Partial<BetterAuthConfig>;
    };
    enableSessionRebuild?: boolean;
    network?: { allowedCidrs?: string[]; fakeIpExceptions?: FakeIpException[] };
    activityLog?: {
      storeToolPayload?: boolean;
    };
  };
  bearerKeys?: BearerKey[];
}

export type ExportedMcpSettingsData = {
  mcpServers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

export interface TempRoutingConfig {
  bearerAuthKey: string;
  bearerAuthHeaderName: string;
  jsonBodyLimit: string;
}

/**
 * Read-only runtime settings consumed across the application (Dashboard, Servers,
 * Groups, Tools, Skills, etc.). Updating a single settings section does not toggle
 * `initialLoading`, avoiding application-wide re-renders during saves.
 */
export interface RuntimeSettingsContextValue {
  toolPolicies: ToolPolicyRule[] | undefined;
  routingConfig: RoutingConfig;
  installConfig: InstallConfig;
  smartRoutingConfig: SmartRoutingConfig;
  toolResultCompressionConfig: ToolResultCompressionConfig;
  fileStagingConfig: FileStagingConfig;
  mcpRouterConfig: MCPRouterConfig;
  oauthServerConfig: OAuthServerConfig;
  allowRegistration: boolean;
  betterAuthConfig: BetterAuthConfig;
  normalizeToolNames: boolean;
  nameSeparator: string;
  skillImportProxy: string;
  enableSessionRebuild: boolean;
  fakeIpExceptions: FakeIpException[];
  allowedCidrs: string[];
  storeToolPayload: boolean;
  initialLoading: boolean;
  error: string | null;
}

/**
 * Write actions, per-section saving flags, and Bearer Key management used by the
 * Settings page and explicit config editors.
 */
export interface SettingsActionsContextValue {
  bearerKeys: BearerKey[];
  tempRoutingConfig: TempRoutingConfig;
  setTempRoutingConfig: React.Dispatch<React.SetStateAction<TempRoutingConfig>>;
  savingSections: Partial<Record<SettingsSectionKey, boolean>>;
  isSectionSaving: (section: SettingsSectionKey) => boolean;
  loading: boolean;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  triggerRefresh: () => void;
  fetchSettings: () => Promise<void>;
  updateToolPolicies: (rules: ToolPolicyRule[]) => Promise<boolean>;
  updateRoutingConfig: (key: keyof RoutingConfig, value: unknown) => Promise<boolean | undefined>;
  updateRoutingConfigBatch: (updates: Partial<RoutingConfig>) => Promise<boolean | undefined>;
  updateInstallConfig: (key: keyof InstallConfig, value: unknown) => Promise<boolean | undefined>;
  updateInstallConfigBatch: (
    updates: Partial<InstallConfig & { skillImportProxy?: string }>,
  ) => Promise<boolean | undefined>;
  updateSkillImportProxy: (value: string) => Promise<boolean>;
  updateSmartRoutingConfig: (
    key: keyof SmartRoutingConfig,
    value: unknown,
  ) => Promise<boolean | undefined>;
  updateSmartRoutingConfigBatch: (
    updates: Partial<SmartRoutingConfig>,
  ) => Promise<boolean | undefined>;
  updateToolResultCompressionConfig: (
    key: keyof ToolResultCompressionConfig,
    value: unknown,
  ) => Promise<boolean | undefined>;
  updateToolResultCompressionConfigBatch: (
    updates: Partial<ToolResultCompressionConfig>,
  ) => Promise<boolean | undefined>;
  updateFileStagingConfigBatch: (
    updates: Partial<FileStagingConfig>,
  ) => Promise<boolean | undefined>;
  updateMCPRouterConfig: (
    key: keyof MCPRouterConfig,
    value: unknown,
  ) => Promise<boolean | undefined>;
  updateMCPRouterConfigBatch: (updates: Partial<MCPRouterConfig>) => Promise<boolean | undefined>;
  updateOAuthServerConfig: (
    key: keyof OAuthServerConfig,
    value: unknown,
  ) => Promise<boolean | undefined>;
  updateOAuthServerConfigBatch: (
    updates: Partial<OAuthServerConfig>,
  ) => Promise<boolean | undefined>;
  updateAllowRegistration: (value: boolean) => Promise<void>;
  updateBetterAuthConfigBatch: (updates: Partial<BetterAuthConfig>) => Promise<boolean | undefined>;
  updateNameSeparator: (value: string) => Promise<boolean | undefined>;
  updateNormalizeToolNames: (value: boolean) => Promise<boolean | undefined>;
  updateSessionRebuild: (value: boolean) => Promise<boolean | undefined>;
  updateFakeIpExceptions: (value: FakeIpException[]) => Promise<boolean>;
  updateAllowedCidrs: (value: string[]) => Promise<boolean>;
  updateStoreToolPayload: (value: boolean) => Promise<boolean | undefined>;
  exportMCPSettings: (
    serverName?: string,
  ) => Promise<ApiResponse<ExportedMcpSettingsData> | undefined>;
  refreshBearerKeys: () => Promise<void>;
  createBearerKey: (
    payload: Pick<BearerKey, 'name'> & BearerKeyWritePayload,
  ) => Promise<BearerKey | null>;
  updateBearerKey: (
    id: string,
    updates: BearerKeyWritePayload,
  ) => Promise<BearerKey | null>;
  deleteBearerKey: (id: string) => Promise<boolean>;
}

export type SettingsContextValue = RuntimeSettingsContextValue & SettingsActionsContextValue;
