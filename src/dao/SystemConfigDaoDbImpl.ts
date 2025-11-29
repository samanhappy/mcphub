import { SystemConfigDao } from './index.js';
import { SystemConfig } from '../types/index.js';
import { SystemConfigRepository } from '../db/repositories/SystemConfigRepository.js';

/**
 * Database-backed implementation of SystemConfigDao
 */
export class SystemConfigDaoDbImpl implements SystemConfigDao {
  private repository: SystemConfigRepository;

  constructor() {
    this.repository = new SystemConfigRepository();
  }

  async get(): Promise<SystemConfig> {
    const config = await this.repository.get();
    return {
      routing: config.routing as any,
      install: config.install as any,
      smartRouting: config.smartRouting as any,
      mcpRouter: config.mcpRouter as any,
      nameSeparator: config.nameSeparator,
      oauth: config.oauth as any,
      oauthServer: config.oauthServer as any,
      enableSessionRebuild: config.enableSessionRebuild,
    };
  }

  async update(config: Partial<SystemConfig>): Promise<SystemConfig> {
    const updated = await this.repository.update(config as any);
    return {
      routing: updated.routing as any,
      install: updated.install as any,
      smartRouting: updated.smartRouting as any,
      mcpRouter: updated.mcpRouter as any,
      nameSeparator: updated.nameSeparator,
      oauth: updated.oauth as any,
      oauthServer: updated.oauthServer as any,
      enableSessionRebuild: updated.enableSessionRebuild,
    };
  }

  async reset(): Promise<SystemConfig> {
    const config = await this.repository.reset();
    return {
      routing: config.routing as any,
      install: config.install as any,
      smartRouting: config.smartRouting as any,
      mcpRouter: config.mcpRouter as any,
      nameSeparator: config.nameSeparator,
      oauth: config.oauth as any,
      oauthServer: config.oauthServer as any,
      enableSessionRebuild: config.enableSessionRebuild,
    };
  }

  async getSection<K extends keyof SystemConfig>(section: K): Promise<SystemConfig[K]> {
    return (await this.repository.getSection(section)) as any;
  }

  async updateSection<K extends keyof SystemConfig>(
    section: K,
    value: SystemConfig[K],
  ): Promise<boolean> {
    await this.repository.updateSection(section, value as any);
    return true;
  }
}
