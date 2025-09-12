import dotenv from 'dotenv';
import { getAppDataSource } from '../db/connection.js';
import { Setting } from '../db/entities/Setting.js';
import fs from 'fs';
import { McpSettings } from '../types/index.js';
import { getConfigFilePath } from '../utils/path.js';
import { getPackageVersion } from '../utils/version.js';

dotenv.config();

const defaultConfig = {
  port: process.env.PORT || 7860,
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

    // 异步保存到数据库（不阻塞主流程）
    saveSettingsToDatabase(settings).catch(() => {});

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

// ---------------------------------------------
// 数据库同步逻辑
// ---------------------------------------------

/**
 * 将当前 settings 保存到数据库 (settings 表 id=1)
 */
const saveSettingsToDatabase = async (settings: McpSettings): Promise<void> => {
  try {
    const ds = getAppDataSource();
    if (!ds.isInitialized) {
      // 数据库还没准备好，直接返回
      return;
    }
    const repo = ds.getRepository(Setting);
    await repo.save({ id: 1, data: settings });
  } catch (err) {
    console.error('Failed to save settings to database:', err);
  }
};

/**
 * 从数据库恢复 settings.json（Render 容器重启后调用）
 */
export const restoreSettingsFromDatabase = async (): Promise<void> => {
  try {
    const ds = getAppDataSource();
    if (!ds.isInitialized) return;
    const repo = ds.getRepository(Setting);
    const row = await repo.findOneBy({ id: 1 });
    if (row && row.data) {
      settingsCache = row.data as McpSettings;
      // 同步到文件，方便本地调试及兼容旧逻辑
      const settingsPath = getSettingsPath();
      try {
        fs.writeFileSync(settingsPath, JSON.stringify(row.data, null, 2), 'utf8');
      } catch (err) {
        console.warn('Failed to write settings file from database:', err);
      }
      console.log('Settings restored from database.');
    } else {
      console.log('Settings table empty, will populate on first save.');
    }
  } catch (err) {
    console.error('Failed to restore settings from database:', err);
  }
};

export default defaultConfig;
