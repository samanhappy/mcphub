import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { McpSettings } from '../types/index.js';

dotenv.config();

const defaultConfig = {
  port: process.env.PORT || 3000,
  initTimeout: process.env.INIT_TIMEOUT || 300000,
  timeout: process.env.REQUEST_TIMEOUT || 60000,
  mcpHubName: 'mcphub',
  mcpHubVersion: '0.0.1',
};

export const getSettingsPath = (): string => {
  return path.resolve(process.cwd(), 'mcp_settings.json');
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

export const expandEnvVars = (value: string): string => {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || '');
};

export default defaultConfig;
