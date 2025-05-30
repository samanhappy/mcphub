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

export const getSettingsPath = (): string => {
  return getConfigFilePath('mcp_settings.json', 'Settings');
};

export const loadSettings = (): McpSettings => {
  const settingsPath = getSettingsPath();
  try {
    const settingsData = fs.readFileSync(settingsPath, 'utf8');
    return JSON.parse(settingsData);
  } catch (error) {
    console.error(`Failed to load settings from ${settingsPath}:`, error);
    return { mcpServers: {}, users: [] };
  }
};

export const saveSettings = (settings: McpSettings): boolean => {
  const settingsPath = getSettingsPath();
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Failed to save settings to ${settingsPath}:`, error);
    return false;
  }
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
