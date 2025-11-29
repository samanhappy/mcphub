import { Repository } from 'typeorm';
import { UserConfig } from '../entities/UserConfig.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for UserConfig entity
 */
export class UserConfigRepository {
  private repository: Repository<UserConfig>;

  constructor() {
    this.repository = getAppDataSource().getRepository(UserConfig);
  }

  /**
   * Get all user configs
   */
  async getAll(): Promise<Record<string, UserConfig>> {
    const configs = await this.repository.find();
    const result: Record<string, UserConfig> = {};
    for (const config of configs) {
      result[config.username] = config;
    }
    return result;
  }

  /**
   * Get user config by username
   */
  async get(username: string): Promise<UserConfig | null> {
    return await this.repository.findOne({ where: { username } });
  }

  /**
   * Update user config
   */
  async update(username: string, configData: Partial<UserConfig>): Promise<UserConfig> {
    let config = await this.get(username);

    if (!config) {
      // Create new config if doesn't exist
      config = this.repository.create({
        username,
        routing: {},
        additionalConfig: {},
        ...configData,
      });
    } else {
      // Merge with existing config
      config = this.repository.merge(config, configData);
    }

    return await this.repository.save(config);
  }

  /**
   * Delete user config
   */
  async delete(username: string): Promise<boolean> {
    const result = await this.repository.delete({ username });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Get a specific configuration section for a user
   */
  async getSection<K extends keyof UserConfig>(username: string, section: K): Promise<UserConfig[K] | null> {
    const config = await this.get(username);
    return config ? config[section] : null;
  }

  /**
   * Update a specific configuration section for a user
   */
  async updateSection<K extends keyof UserConfig>(
    username: string,
    section: K,
    value: UserConfig[K],
  ): Promise<UserConfig> {
    return await this.update(username, { [section]: value } as Partial<UserConfig>);
  }
}

export default UserConfigRepository;
