import { SystemConfig } from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

/**
 * System Configuration DAO interface
 */
export interface SystemConfigDao {
  /**
   * Get system configuration
   */
  get(): Promise<SystemConfig>;

  /**
   * Update system configuration
   */
  update(config: Partial<SystemConfig>): Promise<SystemConfig>;

  /**
   * Reset system configuration to defaults
   */
  reset(): Promise<SystemConfig>;

  /**
   * Get specific configuration section
   */
  getSection<K extends keyof SystemConfig>(section: K): Promise<SystemConfig[K] | undefined>;

  /**
   * Update specific configuration section
   */
  updateSection<K extends keyof SystemConfig>(section: K, value: SystemConfig[K]): Promise<boolean>;
}

/**
 * JSON file-based System Configuration DAO implementation
 */
export class SystemConfigDaoImpl extends JsonFileBaseDao implements SystemConfigDao {
  async get(): Promise<SystemConfig> {
    const settings = await this.loadSettings();
    return settings.systemConfig || {};
  }

  async update(config: Partial<SystemConfig>): Promise<SystemConfig> {
    const settings = await this.loadSettings();
    const currentConfig = settings.systemConfig || {};

    // Deep merge configuration
    const updatedConfig = this.deepMerge(currentConfig, config);
    settings.systemConfig = updatedConfig;

    await this.saveSettings(settings);
    return updatedConfig;
  }

  async reset(): Promise<SystemConfig> {
    const settings = await this.loadSettings();
    const defaultConfig: SystemConfig = {};

    settings.systemConfig = defaultConfig;
    await this.saveSettings(settings);

    return defaultConfig;
  }

  async getSection<K extends keyof SystemConfig>(section: K): Promise<SystemConfig[K] | undefined> {
    const config = await this.get();
    return config[section];
  }

  async updateSection<K extends keyof SystemConfig>(
    section: K,
    value: SystemConfig[K],
  ): Promise<boolean> {
    try {
      await this.update({ [section]: value } as Partial<SystemConfig>);
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
