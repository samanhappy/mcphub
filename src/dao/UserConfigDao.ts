import { UserConfig } from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

/**
 * User Configuration DAO interface
 */
export interface UserConfigDao {
  /**
   * Get user configuration
   */
  get(username: string): Promise<UserConfig | undefined>;

  /**
   * Get all user configurations
   */
  getAll(): Promise<Record<string, UserConfig>>;

  /**
   * Update user configuration
   */
  update(username: string, config: Partial<UserConfig>): Promise<UserConfig>;

  /**
   * Delete user configuration
   */
  delete(username: string): Promise<boolean>;

  /**
   * Check if user configuration exists
   */
  exists(username: string): Promise<boolean>;

  /**
   * Reset user configuration to defaults
   */
  reset(username: string): Promise<UserConfig>;

  /**
   * Get specific configuration section for user
   */
  getSection<K extends keyof UserConfig>(
    username: string,
    section: K,
  ): Promise<UserConfig[K] | undefined>;

  /**
   * Update specific configuration section for user
   */
  updateSection<K extends keyof UserConfig>(
    username: string,
    section: K,
    value: UserConfig[K],
  ): Promise<boolean>;
}

/**
 * JSON file-based User Configuration DAO implementation
 */
export class UserConfigDaoImpl extends JsonFileBaseDao implements UserConfigDao {
  async get(username: string): Promise<UserConfig | undefined> {
    const settings = await this.loadSettings();
    return settings.userConfigs?.[username];
  }

  async getAll(): Promise<Record<string, UserConfig>> {
    const settings = await this.loadSettings();
    return settings.userConfigs || {};
  }

  async update(username: string, config: Partial<UserConfig>): Promise<UserConfig> {
    const settings = await this.loadSettings();

    if (!settings.userConfigs) {
      settings.userConfigs = {};
    }

    const currentConfig = settings.userConfigs[username] || {};

    // Deep merge configuration
    const updatedConfig = this.deepMerge(currentConfig, config);
    settings.userConfigs[username] = updatedConfig;

    await this.saveSettings(settings);
    return updatedConfig;
  }

  async delete(username: string): Promise<boolean> {
    const settings = await this.loadSettings();

    if (!settings.userConfigs || !settings.userConfigs[username]) {
      return false;
    }

    delete settings.userConfigs[username];
    await this.saveSettings(settings);
    return true;
  }

  async exists(username: string): Promise<boolean> {
    const config = await this.get(username);
    return config !== undefined;
  }

  async reset(username: string): Promise<UserConfig> {
    const defaultConfig: UserConfig = {};
    return this.update(username, defaultConfig);
  }

  async getSection<K extends keyof UserConfig>(
    username: string,
    section: K,
  ): Promise<UserConfig[K] | undefined> {
    const config = await this.get(username);
    return config?.[section];
  }

  async updateSection<K extends keyof UserConfig>(
    username: string,
    section: K,
    value: UserConfig[K],
  ): Promise<boolean> {
    try {
      await this.update(username, { [section]: value } as Partial<UserConfig>);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}
