import { UserConfigDao } from './index.js';
import { UserConfig } from '../types/index.js';
import { UserConfigRepository } from '../db/repositories/UserConfigRepository.js';

/**
 * Database-backed implementation of UserConfigDao
 */
export class UserConfigDaoDbImpl implements UserConfigDao {
  private repository: UserConfigRepository;

  constructor() {
    this.repository = new UserConfigRepository();
  }

  async getAll(): Promise<Record<string, UserConfig>> {
    const configs = await this.repository.getAll();
    const result: Record<string, UserConfig> = {};
    
    for (const [username, config] of Object.entries(configs)) {
      result[username] = {
        routing: config.routing,
        ...config.additionalConfig,
      };
    }
    
    return result;
  }

  async get(username: string): Promise<UserConfig> {
    const config = await this.repository.get(username);
    if (!config) {
      return { routing: {} };
    }
    return {
      routing: config.routing,
      ...config.additionalConfig,
    };
  }

  async update(username: string, config: Partial<UserConfig>): Promise<UserConfig> {
    const { routing, ...additionalConfig } = config;
    const updated = await this.repository.update(username, {
      routing,
      additionalConfig,
    });
    return {
      routing: updated.routing,
      ...updated.additionalConfig,
    };
  }

  async delete(username: string): Promise<boolean> {
    return await this.repository.delete(username);
  }

  async getSection<K extends keyof UserConfig>(username: string, section: K): Promise<UserConfig[K]> {
    const config = await this.get(username);
    return config[section];
  }

  async updateSection<K extends keyof UserConfig>(
    username: string,
    section: K,
    value: UserConfig[K],
  ): Promise<boolean> {
    await this.update(username, { [section]: value } as Partial<UserConfig>);
    return true;
  }

  async exists(username: string): Promise<boolean> {
    const config = await this.repository.get(username);
    return config !== null;
  }

  async reset(username: string): Promise<UserConfig> {
    await this.repository.delete(username);
    return { routing: {} };
  }
}
