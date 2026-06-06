import { expandEnvVars } from '../config/index.js';
import { getSystemConfigDao } from '../dao/DaoFactory.js';

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
  openaiApiBaseUrl: string;
  openaiApiKey: string;
  openaiApiEmbeddingModel: string;
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
}

/**
 * Gets the complete smart routing configuration from environment variables and settings.
 *
 * Priority order for each setting:
 * 1. Specific environment variables (ENABLE_SMART_ROUTING, SMART_ROUTING_ENABLED, etc.)
 * 2. Generic environment variables (OPENAI_API_KEY, DB_URL, etc.)
 * 3. Settings configuration (systemConfig.smartRouting)
 * 4. Default values
 *
 * @returns {SmartRoutingConfig} Complete smart routing configuration
 */
export async function getSmartRoutingConfig(): Promise<SmartRoutingConfig> {
  // Get system config from DAO
  const systemConfigDao = getSystemConfigDao();
  const systemConfig = await systemConfigDao.get();
  const smartRoutingSettings: Partial<SmartRoutingConfig> = systemConfig.smartRouting || {};

  return {
    // Enabled status - check multiple environment variables
    enabled: getConfigValue(
      [process.env.SMART_ROUTING_ENABLED],
      smartRoutingSettings.enabled,
      false,
      parseBooleanEnvVar,
    ),

    // Database configuration
    dbUrl: getConfigValue([process.env.DB_URL], smartRoutingSettings.dbUrl, '', expandEnvVars),

    basePacingDelayMs: getConfigValue<number>(
      [process.env.SMART_ROUTING_BASE_PACING_DELAY_MS],
      smartRoutingSettings.basePacingDelayMs,
      0,
      (value: unknown) => {
        const parsed = parseInt(String(value), 10);
        return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
      },
    ),

    embeddingProvider: getConfigValue(
      [process.env.SMART_ROUTING_EMBEDDING_PROVIDER],
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

    embeddingEncodingFormat: getConfigValue(
      [process.env.SMART_ROUTING_EMBEDDING_ENCODING_FORMAT],
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

    // OpenAI API configuration
    openaiApiBaseUrl: getConfigValue(
      [process.env.OPENAI_API_BASE_URL],
      smartRoutingSettings.openaiApiBaseUrl,
      'https://api.openai.com/v1',
      expandEnvVars,
    ),

    openaiApiKey: getConfigValue(
      [process.env.OPENAI_API_KEY],
      smartRoutingSettings.openaiApiKey,
      '',
      expandEnvVars,
    ),

    openaiApiEmbeddingModel: getConfigValue(
      [process.env.EMBEDDING_MODEL],
      smartRoutingSettings.openaiApiEmbeddingModel,
      'text-embedding-3-small',
      expandEnvVars,
    ),

    azureOpenaiEndpoint: getConfigValue(
      [process.env.AZURE_OPENAI_ENDPOINT],
      smartRoutingSettings.azureOpenaiEndpoint,
      '',
      expandEnvVars,
    ),

    azureOpenaiApiKey: getConfigValue(
      [process.env.AZURE_OPENAI_API_KEY],
      smartRoutingSettings.azureOpenaiApiKey,
      '',
      expandEnvVars,
    ),

    azureOpenaiApiVersion: getConfigValue(
      [process.env.AZURE_OPENAI_API_VERSION],
      smartRoutingSettings.azureOpenaiApiVersion,
      '2024-02-15-preview',
      expandEnvVars,
    ),

    azureOpenaiEmbeddingDeployment: getConfigValue(
      [process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT],
      smartRoutingSettings.azureOpenaiEmbeddingDeployment,
      '',
      expandEnvVars,
    ),

    azureOpenaiEmbeddingModel: getConfigValue(
      [process.env.AZURE_OPENAI_EMBEDDING_MODEL],
      smartRoutingSettings.azureOpenaiEmbeddingModel,
      '',
      expandEnvVars,
    ),

    // Progressive disclosure - when enabled, search_tools returns minimal info
    // and describe_tool is used to get full schema
    progressiveDisclosure: getConfigValue(
      [process.env.SMART_ROUTING_PROGRESSIVE_DISCLOSURE],
      smartRoutingSettings.progressiveDisclosure,
      false,
      parseBooleanEnvVar,
    ),

    serverDescriptionMode: getConfigValue(
      [process.env.SMART_ROUTING_SERVER_DESCRIPTION_MODE],
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
    embeddingMaxTokens: getConfigValue<number | undefined>(
      [process.env.EMBEDDING_MAX_TOKENS],
      smartRoutingSettings.embeddingMaxTokens,
      undefined,
      (value: unknown) => {
        const parsed = parseInt(String(value), 10);
        return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
      },
    ),
  };
}

/**
 * Gets a configuration value with priority order: environment variables > settings > default.
 *
 * @param {(string | undefined)[]} envVars - Array of environment variable names to check in order
 * @param {any} settingsValue - Value from settings configuration
 * @param {any} defaultValue - Default value to use if no other value is found
 * @param {Function} transformer - Function to transform the final value to the correct type
 * @returns {any} The configuration value with the appropriate transformation applied
 */
function getConfigValue<T>(
  envVars: (string | undefined)[],
  settingsValue: any,
  defaultValue: T,
  transformer: (value: any) => T,
): T {
  // Check environment variables in order
  for (const envVar of envVars) {
    if (envVar !== undefined && envVar !== null && envVar !== '') {
      try {
        return transformer(envVar);
      } catch (error) {
        console.warn(`Failed to transform environment variable "${envVar}":`, error);
        continue;
      }
    }
  }

  // Check settings value
  if (settingsValue !== undefined && settingsValue !== null) {
    try {
      return transformer(settingsValue);
    } catch (error) {
      console.warn('Failed to transform settings value:', error);
    }
  }

  // Return default value
  return defaultValue;
}

/**
 * Parses a string environment variable value to a boolean.
 * Supports common boolean representations: true/false, 1/0, yes/no, on/off
 *
 * @param {string} value - The environment variable value to parse
 * @returns {boolean} The parsed boolean value
 */
function parseBooleanEnvVar(value: string): boolean {
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
  console.warn(`Unrecognized boolean value for smart routing: "${value}", defaulting to false`);
  return false;
}
