import dotenv from 'dotenv';
import fs from 'fs';
import { McpSettings } from '../types/index.js';
import { getConfigFilePath } from '../utils/path.js';
import { getPackageVersion } from '../utils/version.js';

dotenv.config();

const defaultConfig = {
  port: process.env.PORT || 3000,
  initTimeout: process.env.INIT_TIMEOUT || 300000,
  timeout: process.env.REQUEST_TIMEOUT || 60000,
  basePath: process.env.BASE_PATH || '',
  mcpHubName: 'mcphub',
  mcpHubVersion: getPackageVersion(),
};

// Settings cache
let settingsCache: McpSettings | null = null;

export const getSettingsPath = (): string => {
  return getConfigFilePath('mcp_settings.json', 'Settings');
};

export const loadSettings = (): McpSettings => {
  // If cache exists, return cached data directly
  if (settingsCache) {
    return settingsCache;
  }

  const settingsPath = getSettingsPath();
  try {
    const settingsData = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(settingsData);

    // Update cache
    settingsCache = settings;

    console.log(`Loaded settings from ${settingsPath}`);
    return settings;
  } catch (error) {
    console.error(`Failed to load settings from ${settingsPath}:`, error);
    const defaultSettings = { mcpServers: {}, users: [] };

    // Cache default settings
    settingsCache = defaultSettings;

    return defaultSettings;
  }
};

export const saveSettings = (settings: McpSettings): boolean => {
  const settingsPath = getSettingsPath();
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    // Update cache after successful save
    settingsCache = settings;

    return true;
  } catch (error) {
    console.error(`Failed to save settings to ${settingsPath}:`, error);
    return false;
  }
};

/**
 * Clear settings cache, force next loadSettings call to re-read from file
 */
export const clearSettingsCache = (): void => {
  settingsCache = null;
};

/**
 * Get current cache status (for debugging)
 */
export const getSettingsCacheInfo = (): { hasCache: boolean } => {
  return {
    hasCache: settingsCache !== null,
  };
};

export const replaceEnvVars = (env: Record<string, any>): Record<string, any> => {
  const res: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      res[key] = expandEnvVars(value);
    } else {
      res[key] = String(value);
    }
  }
  return res;
};

export const expandEnvVars = (value: string): string => {
  if (typeof value !== 'string') {
    return String(value);
  }
  // Replace ${VAR} format
  let result = value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || '');
  // Also replace $VAR format (common on Unix-like systems)
  result = result.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, key) => process.env[key] || '');
  return result;
};

export default defaultConfig;
