import { expandEnvVars } from '../config/index.js';
import { getSystemConfigDao } from '../dao/DaoFactory.js';

/**
 * Smart routing configuration interface
 */
export interface SmartRoutingConfig {
  enabled: boolean;
  dbUrl: string;
  openaiApiBaseUrl: string;
  openaiApiKey: string;
  openaiApiEmbeddingModel: string;
  /**
   * When enabled, search_tools returns only tool name and description (without full inputSchema).
   * A new describe_tool endpoint is provided to get the full tool schema on demand.
   * This reduces token usage for AI clients that don't need all tool parameters upfront.
   * Default: false (returns full tool schemas in search_tools for backward compatibility)
   */
  progressiveDisclosure?: boolean;
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
      [process.env.OPENAI_API_EMBEDDING_MODEL],
      smartRoutingSettings.openaiApiEmbeddingModel,
      'text-embedding-3-small',
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
