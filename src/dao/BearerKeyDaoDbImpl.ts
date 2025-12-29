import { BearerKeyDao } from './BearerKeyDao.js';
import { BearerKey as BearerKeyModel } from '../types/index.js';
import { BearerKeyRepository } from '../db/repositories/BearerKeyRepository.js';

/**
 * Database-backed implementation of BearerKeyDao
 */
export class BearerKeyDaoDbImpl implements BearerKeyDao {
  private repository: BearerKeyRepository;

  constructor() {
    this.repository = new BearerKeyRepository();
  }

  private toModel(entity: import('../db/entities/BearerKey.js').BearerKey): BearerKeyModel {
    return {
      id: entity.id,
      name: entity.name,
      token: entity.token,
      enabled: entity.enabled,
      accessType: entity.accessType,
      allowedGroups: entity.allowedGroups ?? [],
      allowedServers: entity.allowedServers ?? [],
    };
  }

  async findAll(): Promise<BearerKeyModel[]> {
    const entities = await this.repository.findAll();
    return entities.map((e) => this.toModel(e));
  }

  async findEnabled(): Promise<BearerKeyModel[]> {
    const entities = await this.repository.findAll();
    return entities.filter((e) => e.enabled).map((e) => this.toModel(e));
  }

  async findById(id: string): Promise<BearerKeyModel | undefined> {
    const entity = await this.repository.findById(id);
    return entity ? this.toModel(entity) : undefined;
  }

  async findByToken(token: string): Promise<BearerKeyModel | undefined> {
    const entity = await this.repository.findByToken(token);
    return entity ? this.toModel(entity) : undefined;
  }

  async create(data: Omit<BearerKeyModel, 'id'>): Promise<BearerKeyModel> {
    const entity = await this.repository.create({
      name: data.name,
      token: data.token,
      enabled: data.enabled,
      accessType: data.accessType,
      allowedGroups: data.allowedGroups ?? [],
      allowedServers: data.allowedServers ?? [],
    } as any);
    return this.toModel(entity as any);
  }

  async update(
    id: string,
    data: Partial<Omit<BearerKeyModel, 'id'>>,
  ): Promise<BearerKeyModel | null> {
    const entity = await this.repository.update(id, {
      name: data.name,
      token: data.token,
      enabled: data.enabled,
      accessType: data.accessType,
      allowedGroups: data.allowedGroups,
      allowedServers: data.allowedServers,
    } as any);
    return entity ? this.toModel(entity as any) : null;
  }

  async delete(id: string): Promise<boolean> {
    return await this.repository.delete(id);
  }

  async updateServerName(oldName: string, newName: string): Promise<number> {
    const allKeys = await this.repository.findAll();
    let updatedCount = 0;

    for (const key of allKeys) {
      let updated = false;

      if (key.allowedServers && key.allowedServers.length > 0) {
        const newServers = key.allowedServers.map((server) => {
          if (server === oldName) {
            updated = true;
            return newName;
          }
          return server;
        });

        if (updated) {
          await this.repository.update(key.id, { allowedServers: newServers });
          updatedCount++;
        }
      }
    }

    return updatedCount;
  }
}
