import { SystemConfig } from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

const legacySmartRoutingFields = [
  ['openaiApiKey', 'llmProviderApiKey'],
  ['openaiApiBaseUrl', 'llmProviderBaseUrl'],
  ['openaiApiEmbeddingModel', 'embeddingModel'],
] as const;

export const migrateLegacySmartRoutingConfig = (
  smartRouting: SystemConfig['smartRouting'],
): { smartRouting: SystemConfig['smartRouting']; migrated: boolean } => {
  if (!smartRouting) {
    return { smartRouting, migrated: false };
  }

  const migratedConfig: Record<string, unknown> = { ...smartRouting };
  let migrated = false;

  for (const [legacyField, neutralField] of legacySmartRoutingFields) {
    if (migratedConfig[neutralField] === undefined && migratedConfig[legacyField] !== undefined) {
      migratedConfig[neutralField] = migratedConfig[legacyField];
    }
    if (legacyField in migratedConfig) {
      delete migratedConfig[legacyField];
      migrated = true;
    }
  }

  return { smartRouting: migratedConfig as unknown as SystemConfig['smartRouting'], migrated };
};

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
    const config = settings.systemConfig || {};
    const { smartRouting, migrated } = migrateLegacySmartRoutingConfig(config.smartRouting);
    if (!migrated) {
      return config;
    }

    const migratedConfig = { ...config, smartRouting };
    settings.systemConfig = migratedConfig;
    await this.saveSettings(settings);
    return migratedConfig;
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
