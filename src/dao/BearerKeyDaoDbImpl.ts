import { BearerKeyDao } from './BearerKeyDao.js';
import { BearerKey as BearerKeyModel } from '../types/index.js';
import { BearerKeyRepository } from '../db/repositories/BearerKeyRepository.js';
import { SystemConfigRepository } from '../db/repositories/SystemConfigRepository.js';

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
      token: entity.token ?? undefined,
      tokenHash: entity.tokenHash ?? undefined,
      tokenPrefix: entity.tokenPrefix ?? undefined,
      enabled: entity.enabled,
      kind: entity.kind ?? 'system',
      owner: entity.owner,
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

  async findByOwner(owner: string): Promise<BearerKeyModel[]> {
    const entities = await this.repository.findByOwner(owner);
    return entities.map((e) => this.toModel(e));
  }

  async create(data: Omit<BearerKeyModel, 'id'>): Promise<BearerKeyModel> {
    const entity = await this.repository.create({
      name: data.name,
      token: data.token as string,
      tokenHash: data.tokenHash,
      tokenPrefix: data.tokenPrefix,
      enabled: data.enabled,
      kind: data.kind ?? 'system',
      owner: data.owner,
      accessType: data.accessType,
      allowedGroups: data.allowedGroups ?? [],
      allowedServers: data.allowedServers ?? [],
    } as any);
    // The raw token is returned here only, so the caller can show it once.
    return { ...this.toModel(entity as any), token: data.token };
  }

  async hashLegacyTokens(): Promise<number> {
    const count = await this.repository.hashLegacyTokens();
    // Instances migrated by an older version still carry the raw legacy key
    const systemConfigRepo = new SystemConfigRepository();
    const routing = ((await systemConfigRepo.get()) as any)?.routing || {};
    if (routing.bearerAuthKey) {
      await systemConfigRepo.updateSection('routing', { ...routing, bearerAuthKey: '' });
    }
    return count;
  }

  async update(
    id: string,
    data: Partial<Omit<BearerKeyModel, 'id'>>,
  ): Promise<BearerKeyModel | null> {
    const entity = await this.repository.update(id, {
      name: data.name,
      ...(data.tokenHash !== undefined
        ? { token: null, tokenHash: data.tokenHash, tokenPrefix: data.tokenPrefix }
        : {}),
      enabled: data.enabled,
      kind: data.kind,
      owner: data.owner,
      accessType: data.accessType,
      allowedGroups: data.allowedGroups,
      allowedServers: data.allowedServers,
    } as any);
    return entity ? this.toModel(entity as any) : null;
  }

  async delete(id: string): Promise<boolean> {
    return await this.repository.delete(id);
  }

  async deleteByOwner(owner: string): Promise<number> {
    return await this.repository.deleteByOwner(owner);
  }

  async updateServerName(oldName: string, newName: string): Promise<number> {
    return this.renameScopeEntry('allowedServers', oldName, newName);
  }

  async updateGroupName(oldName: string, newName: string): Promise<number> {
    return this.renameScopeEntry('allowedGroups', oldName, newName);
  }

  private async renameScopeEntry(
    field: 'allowedServers' | 'allowedGroups',
    oldName: string,
    newName: string,
  ): Promise<number> {
    const allKeys = await this.repository.findAll();
    let updatedCount = 0;

    for (const key of allKeys) {
      if (key[field]?.includes(oldName)) {
        const renamed = key[field]!.map((entry) => (entry === oldName ? newName : entry));
        await this.repository.update(key.id, { [field]: renamed });
        updatedCount++;
      }
    }

    return updatedCount;
  }
}
