import { Repository } from 'typeorm';
import { SystemConfig } from '../entities/SystemConfig.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for SystemConfig entity
 * Uses singleton pattern with id = 'default'
 */
export class SystemConfigRepository {
  private repository: Repository<SystemConfig>;
  private readonly DEFAULT_ID = 'default';

  constructor() {
    this.repository = getAppDataSource().getRepository(SystemConfig);
  }

  /**
   * Get system configuration (singleton)
   */
  async get(): Promise<SystemConfig> {
    let config = await this.repository.findOne({ where: { id: this.DEFAULT_ID } });

    // Create default if doesn't exist
    if (!config) {
      config = this.repository.create({
        id: this.DEFAULT_ID,
        routing: {},
        install: {},
        smartRouting: {},
        mcpRouter: {},
        nameSeparator: '-',
        oauth: {},
        oauthServer: {},
        auth: {},
        enableSessionRebuild: false,
      });
      config = await this.repository.save(config);
    }

    return config;
  }

  /**
   * Update system configuration
   */
  async update(configData: Partial<SystemConfig>): Promise<SystemConfig> {
    const config = await this.get();
    const updated = this.repository.merge(config, configData);
    return await this.repository.save(updated);
  }

  /**
   * Reset system configuration to defaults
   */
  async reset(): Promise<SystemConfig> {
    await this.repository.delete({ id: this.DEFAULT_ID });
    return await this.get();
  }

  /**
   * Get a specific configuration section
   */
  async getSection<K extends keyof SystemConfig>(section: K): Promise<SystemConfig[K]> {
    const config = await this.get();
    return config[section];
  }

  /**
   * Update a specific configuration section
   */
  async updateSection<K extends keyof SystemConfig>(
    section: K,
    value: SystemConfig[K],
  ): Promise<SystemConfig> {
    return await this.update({ [section]: value } as Partial<SystemConfig>);
  }
}

export default SystemConfigRepository;
