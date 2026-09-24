import { expandEnvVars } from '../config/index.js';
import { getSystemConfigDao } from '../dao/DaoFactory.js';
import { migrateLegacySmartRoutingConfig } from '../dao/SystemConfigDao.js';
import { logger } from './logger.js';

/**
 * Smart routing configuration interface
 */
export interface SmartRoutingConfig {
  enabled: boolean;
  dbUrl: string;
  /**
   * Base delay in milliseconds applied between provider-backed embedding requests.
   * A value of 0 disables the baseline wait but still allows adaptive pacing to
   * increase automatically after retryable throttling responses.
   */
  basePacingDelayMs?: number;
  embeddingProvider?: 'openai' | 'azure_openai';
  embeddingEncodingFormat?: 'auto' | 'base64' | 'float';
  /**
   * Optional output dimensionality passed to providers that support it.
   * When omitted, the provider's model default is used.
   */
  embeddingDimensions?: number;
  /**
   * When true, the configured embeddingDimensions is always forwarded to the
   * provider as the OpenAI `dimensions` request parameter, even for models not
   * known to support Matryoshka (MRL) representations.
   *
   * Defaults to false: MCPHub only forwards `dimensions` for models/backends it
   * recognizes as MRL-capable (text-embedding-3-*, gemini-embedding-*), because
   * many popular open embedding models/backends (Qwen3-Embedding, BGE, most
   * vLLM/sglang deployments) reject the parameter outright — even when the
   * value equals the model's native dimension (issue #1131). Enable this only
   * for MRL-capable models that MCPHub does not recognize.
   */
  embeddingDimensionsApiPassthrough?: boolean;
  llmProviderBaseUrl: string;
  llmProviderApiKey: string;
  embeddingModel: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiApiKey?: string;
  azureOpenaiApiVersion?: string;
  azureOpenaiEmbeddingDeployment?: string;
  /**
   * The actual underlying OpenAI model name deployed in Azure (e.g. "text-embedding-3-small").
   * Azure deployment names are arbitrary and not recognized by the tokenizer; this field
   * provides the real model name so that token truncation uses the correct limit and
   * tokenizer family (cl100k_base BPE for all text-embedding-* models).
   */
  azureOpenaiEmbeddingModel?: string;
  /**
   * When enabled, search_tools returns only tool name and description (without full inputSchema).
   * A new describe_tool endpoint is provided to get the full tool schema on demand.
   * This reduces token usage for AI clients that don't need all tool parameters upfront.
   * Default: false (returns full tool schemas in search_tools for backward compatibility)
   */
  progressiveDisclosure?: boolean;
  /**
   * Controls how available servers are listed in the search_tools meta-tool description.
   * - 'names': only include server names
   * - 'full': include server names and descriptions/instructions when available
   * Default: 'names' for backward compatibility.
   */
  serverDescriptionMode?: 'names' | 'full';
  /**
   * Maximum number of tokens allowed when truncating tool descriptions before generating
   * embeddings. Overrides the per-model default from getModelDefaultTokenLimit().
   *
   * Priority: EMBEDDING_MAX_TOKENS env var → smartRouting.embeddingMaxTokens setting → model default.
   * Useful for local inference servers with a batch_size lower than the model's official limit.
   */
  embeddingMaxTokens?: number;
  /**
   * Fields whose effective value currently comes from an environment variable
   * instead of the persisted (dashboard) setting.
   *
   * Display-only metadata: the settings API forwards it so the dashboard can warn
   * that a value typed into the UI is being shadowed by an env var (issue #642).
   * It is derived at read time and must never be persisted to systemConfig.
   *
   * `enabled` and `dbUrl` are intentionally omitted — the dashboard already
   * reflects env-derived enablement (#1179) and renders a `${DB_URL}` placeholder,
   * so a "shadowed by env" warning for them would be noise.
   */
  envOverriddenFields?: SmartRoutingEnvOverride[];
}

/**
 * One field whose effective value is supplied by an environment variable, i.e.
 * the value typed into the dashboard for that field is currently ignored.
 */
export interface SmartRoutingEnvOverride {
  /** Field name inside `SmartRoutingConfig`, e.g. `llmProviderApiKey`. */
  field: string;
  /** The environment variable that won, e.g. `OPENAI_API_KEY`. */
  envVar: string;
}

/**
 * Gets the complete smart routing configuration from environment variables and settings.
 *
 * Priority order for each setting:
 * 1. Specific environment variables (SMART_ROUTING_ENABLED, with
 *    ENABLE_SMART_ROUTING retained as a legacy alias)
 * 2. Generic environment variables (OPENAI_API_KEY, DB_URL, etc.)
 * 3. Settings configuration (systemConfig.smartRouting)
 * 4. Default values
 *
 * @returns {SmartRoutingConfig} Complete smart routing configuration, including
 *   `envOverriddenFields` — the display-only list of fields whose value came from
 *   an environment variable and therefore shadows the dashboard setting.
 */
export async function getSmartRoutingConfig(): Promise<SmartRoutingConfig> {
  // Get system config from DAO
  const systemConfigDao = getSystemConfigDao();
  const systemConfig = await systemConfigDao.get();
  const { smartRouting, migrated } = migrateLegacySmartRoutingConfig(systemConfig.smartRouting);
  if (migrated) {
    await systemConfigDao.update({ smartRouting: smartRouting! });
  }
  const smartRoutingSettings: Partial<SmartRoutingConfig> = smartRouting || {};

  // Collect which fields are currently supplied by an environment variable
  // rather than by the persisted (dashboard) setting, so the settings API can warn
  // that a value typed into the UI is being shadowed (issue #642). The `cfg` helper
  // wraps resolveConfigValue, and each call site names its env vars inline (object
  // shorthand, e.g. `{ OPENAI_API_KEY }`) so there is exactly one place that knows
  // them — no second, drift-prone list to keep in sync.
  const envOverriddenFields: SmartRoutingEnvOverride[] = [];
  const cfg = <T>(
    field: string,
    envVars: Record<string, string | undefined>,
    settingsValue: any,
    defaultValue: T,
    transformer: (value: any) => T,
  ): T => {
    const entries = Object.entries(envVars);
    const { value, source, envVarIndex } = resolveConfigValue(
      entries.map(([, envValue]) => envValue),
      settingsValue,
      defaultValue,
      transformer,
    );
    const envVar = envVarIndex === undefined ? undefined : entries[envVarIndex][0];
    // `enabled` and `dbUrl` are excluded: the dashboard already reflects
    // env-derived enablement (#1179) and renders a `${DB_URL}` placeholder, so a
    // generic "shadowed by env" warning for them would just be noise.
    if (source === 'env' && envVar && field !== 'enabled' && field !== 'dbUrl') {
      envOverriddenFields.push({ field, envVar });
    }
    return value;
  };

  return {
    // Enabled status - prefer the canonical variable but keep the legacy alias
    enabled: cfg(
      'enabled',
      {
        SMART_ROUTING_ENABLED: process.env.SMART_ROUTING_ENABLED,
        ENABLE_SMART_ROUTING: process.env.ENABLE_SMART_ROUTING,
      },
      smartRoutingSettings.enabled,
      false,
      parseBooleanEnvVar,
    ),

    // Database configuration
    dbUrl: cfg(
      'dbUrl',
      { DB_URL: process.env.DB_URL },
      smartRoutingSettings.dbUrl,
      '',
      expandEnvVars,
    ),

    basePacingDelayMs: cfg<number>(
      'basePacingDelayMs',
      { SMART_ROUTING_BASE_PACING_DELAY_MS: process.env.SMART_ROUTING_BASE_PACING_DELAY_MS },
      smartRoutingSettings.basePacingDelayMs,
      0,
      (value: unknown) => {
        const parsed = parseInt(String(value), 10);
        return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
      },
    ),

    embeddingProvider: cfg(
      'embeddingProvider',
      { SMART_ROUTING_EMBEDDING_PROVIDER: process.env.SMART_ROUTING_EMBEDDING_PROVIDER },
      smartRoutingSettings.embeddingProvider,
      'openai',
      (value: any) => {
        const normalized = String(value || '')
          .trim()
          .toLowerCase();
        if (normalized === 'azure' || normalized === 'azure_openai') {
          return 'azure_openai';
        }
        return 'openai';
      },
    ),

    embeddingEncodingFormat: cfg(
      'embeddingEncodingFormat',
      {
        SMART_ROUTING_EMBEDDING_ENCODING_FORMAT:
          process.env.SMART_ROUTING_EMBEDDING_ENCODING_FORMAT,
      },
      smartRoutingSettings.embeddingEncodingFormat,
      'auto',
      (value: any) => {
        const normalized = String(value || '')
          .trim()
          .toLowerCase();
        if (normalized === 'base64' || normalized === 'float') {
          return normalized;
        }
        return 'auto';
      },
    ),

    embeddingDimensions: cfg<number | undefined>(
      'embeddingDimensions',
      { EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS },
      smartRoutingSettings.embeddingDimensions,
      undefined,
      (value: unknown) => {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
      },
    ),

    embeddingDimensionsApiPassthrough: cfg(
      'embeddingDimensionsApiPassthrough',
      { EMBEDDING_DIMENSIONS_API_PASSTHROUGH: process.env.EMBEDDING_DIMENSIONS_API_PASSTHROUGH },
      smartRoutingSettings.embeddingDimensionsApiPassthrough,
      false,
      parseBooleanEnvVar,
    ),

    // OpenAI API configuration
    llmProviderBaseUrl: cfg(
      'llmProviderBaseUrl',
      { OPENAI_API_BASE_URL: process.env.OPENAI_API_BASE_URL },
      smartRoutingSettings.llmProviderBaseUrl,
      'https://api.openai.com/v1',
      expandEnvVars,
    ),

    llmProviderApiKey: cfg(
      'llmProviderApiKey',
      { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
      smartRoutingSettings.llmProviderApiKey,
      '',
      expandEnvVars,
    ),

    embeddingModel: cfg(
      'embeddingModel',
      {
        EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
        OPENAI_API_EMBEDDING_MODEL: process.env.OPENAI_API_EMBEDDING_MODEL,
      },
      smartRoutingSettings.embeddingModel,
      'text-embedding-3-small',
      expandEnvVars,
    ),

    azureOpenaiEndpoint: cfg(
      'azureOpenaiEndpoint',
      { AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT },
      smartRoutingSettings.azureOpenaiEndpoint,
      '',
      expandEnvVars,
    ),

    azureOpenaiApiKey: cfg(
      'azureOpenaiApiKey',
      { AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY },
      smartRoutingSettings.azureOpenaiApiKey,
      '',
      expandEnvVars,
    ),

    azureOpenaiApiVersion: cfg(
      'azureOpenaiApiVersion',
      { AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION },
      smartRoutingSettings.azureOpenaiApiVersion,
      '2024-02-15-preview',
      expandEnvVars,
    ),

    azureOpenaiEmbeddingDeployment: cfg(
      'azureOpenaiEmbeddingDeployment',
      { AZURE_OPENAI_EMBEDDING_DEPLOYMENT: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT },
      smartRoutingSettings.azureOpenaiEmbeddingDeployment,
      '',
      expandEnvVars,
    ),

    azureOpenaiEmbeddingModel: cfg(
      'azureOpenaiEmbeddingModel',
      { AZURE_OPENAI_EMBEDDING_MODEL: process.env.AZURE_OPENAI_EMBEDDING_MODEL },
      smartRoutingSettings.azureOpenaiEmbeddingModel,
      '',
      expandEnvVars,
    ),

    // Progressive disclosure - when enabled, search_tools returns minimal info
    // and describe_tool is used to get full schema
    progressiveDisclosure: cfg(
      'progressiveDisclosure',
      { SMART_ROUTING_PROGRESSIVE_DISCLOSURE: process.env.SMART_ROUTING_PROGRESSIVE_DISCLOSURE },
      smartRoutingSettings.progressiveDisclosure,
      false,
      parseBooleanEnvVar,
    ),

    serverDescriptionMode: cfg(
      'serverDescriptionMode',
      { SMART_ROUTING_SERVER_DESCRIPTION_MODE: process.env.SMART_ROUTING_SERVER_DESCRIPTION_MODE },
      smartRoutingSettings.serverDescriptionMode,
      'names',
      (value: any) => {
        const normalized = String(value || '')
          .trim()
          .toLowerCase();
        return normalized === 'full' ? 'full' : 'names';
      },
    ),

    // Maximum tokens for text truncation before generating embeddings.
    // undefined means "use the per-model default" (see getModelDefaultTokenLimit).
    embeddingMaxTokens: cfg<number | undefined>(
      'embeddingMaxTokens',
      { EMBEDDING_MAX_TOKENS: process.env.EMBEDDING_MAX_TOKENS },
      smartRoutingSettings.embeddingMaxTokens,
      undefined,
      (value: unknown) => {
        const parsed = parseInt(String(value), 10);
        return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
      },
    ),

    envOverriddenFields,
  };
}

/**
 * Where an effective configuration value came from.
 * - `env`: an environment variable supplied it (highest priority)
 * - `settings`: the persisted systemConfig.smartRouting setting supplied it
 * - `default`: neither was usable, so the built-in fallback was used
 */
export type ConfigValueSource = 'env' | 'settings' | 'default';

/**
 * Resolves a configuration value with priority order: environment variables >
 * settings > default, and reports which of the three actually won.
 *
 * The source is what lets the dashboard warn about a value the user typed being
 * shadowed by an env var (issue #642) without duplicating the env-var lookup list.
 *
 * @param {(string | undefined)[]} envVars - Array of environment variable values to check in order
 * @param {any} settingsValue - Value from settings configuration
 * @param {any} defaultValue - Default value to use if no other value is found
 * @param {Function} transformer - Function to transform the final value to the correct type
 * @returns {{ value: T; source: ConfigValueSource; envVarIndex?: number }} The transformed
 *   value, where it came from, and (when source is `env`) the index in `envVars` that won
 */
function resolveConfigValue<T>(
  envVars: (string | undefined)[],
  settingsValue: any,
  defaultValue: T,
  transformer: (value: any) => T,
): { value: T; source: ConfigValueSource; envVarIndex?: number } {
  // Check environment variables in order
  for (let index = 0; index < envVars.length; index++) {
    const envVar = envVars[index];
    if (envVar !== undefined && envVar !== null && envVar !== '') {
      try {
        return { value: transformer(envVar), source: 'env', envVarIndex: index };
      } catch (error) {
        logger.warn(`Failed to transform environment variable "${envVar}":`, error);
        continue;
      }
    }
  }

  // Check settings value
  if (settingsValue !== undefined && settingsValue !== null) {
    try {
      return { value: transformer(settingsValue), source: 'settings' };
    } catch (error) {
      logger.warn('Failed to transform settings value:', error);
    }
  }

  // Return default value
  return { value: defaultValue, source: 'default' };
}

/**
 * Parses a string environment variable value to a boolean.
 * Supports common boolean representations: true/false, 1/0, yes/no, on/off
 *
 * @param {string} value - The environment variable value to parse
 * @returns {boolean} The parsed boolean value
 */
export function parseBooleanEnvVar(value: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.toLowerCase().trim();

  // Handle common truthy values
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  // Handle common falsy values
  if (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'no' ||
    normalized === 'off' ||
    normalized === ''
  ) {
    return false;
  }

  // Default to false for unrecognized values
  logger.warn(`Unrecognized boolean value for smart routing: "${value}", defaulting to false`);
  return false;
}
