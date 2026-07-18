import { Repository } from 'typeorm';
import { SystemConfig } from '../entities/SystemConfig.js';
import { getAppDataSource, reconnectDatabase } from '../connection.js';
import { cloneDefaultOAuthServerConfig } from '../../constants/oauthServerDefaults.js';
import { isRetryableDbError } from '../../utils/dbRetry.js';

/**
 * Repository for SystemConfig entity
 * Uses singleton pattern with id = 'default'
 */
export class SystemConfigRepository {
  private readonly DEFAULT_ID = 'default';

  private getRepository(): Repository<SystemConfig> {
    return getAppDataSource().getRepository(SystemConfig);
  }

  private async withConnectionRecovery<T>(
    operation: (repository: Repository<SystemConfig>) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(this.getRepository());
    } catch (error) {
      if (!isRetryableDbError(error)) {
        throw error;
      }

      console.warn('[DB Recovery] System config operation failed, reconnecting...');
      await reconnectDatabase();
      return await operation(this.getRepository());
    }
  }

  private async getConfig(repository: Repository<SystemConfig>): Promise<SystemConfig> {
    let config = await repository.findOne({ where: { id: this.DEFAULT_ID } });

    if (!config) {
      config = repository.create({
        id: this.DEFAULT_ID,
        routing: {},
        install: {},
        smartRouting: {},
        toolResultCompression: {},
        mcpRouter: {},
        nameSeparator: '-',
        oauth: {},
        oauthServer: cloneDefaultOAuthServerConfig(),
        auth: {},
        enableSessionRebuild: false,
        discovery: {},
      });
      config = await repository.save(config);
    }

    return config;
  }

  /**
   * Get system configuration (singleton)
   */
  async get(): Promise<SystemConfig> {
    return this.withConnectionRecovery((repository) => this.getConfig(repository));
  }

  /**
   * Update system configuration
   */
  async update(configData: Partial<SystemConfig>): Promise<SystemConfig> {
    return this.withConnectionRecovery(async (repository) => {
      const config = await this.getConfig(repository);
      const updated = repository.merge(config, configData);
      return await repository.save(updated);
    });
  }

  /**
   * Reset system configuration to defaults
   */
  async reset(): Promise<SystemConfig> {
    return this.withConnectionRecovery(async (repository) => {
      await repository.delete({ id: this.DEFAULT_ID });
      return await this.getConfig(repository);
    });
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
