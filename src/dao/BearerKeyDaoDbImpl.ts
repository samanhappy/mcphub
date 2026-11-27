import { BearerKeyDao } from './BearerKeyDao.js';
import { BearerKey as BearerKeyModel } from '../types/index.js';
import { BearerKeyRepository } from '../db/repositories/BearerKeyRepository.js';
import { SystemConfigRepository } from '../db/repositories/SystemConfigRepository.js';
import { normalizeBearerKeyTimestamp } from '../utils/bearerKeyExpiry.js';
import { logger } from '../utils/logger.js';

/**
 * Database-backed implementation of BearerKeyDao
 */
export class BearerKeyDaoDbImpl implements BearerKeyDao {
  private repository: BearerKeyRepository;

  constructor() {
    this.repository = new BearerKeyRepository();
  }

  private async loadUsageMapBestEffort(ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0 || typeof this.repository.findUsageByKeyIds !== 'function') {
      return new Map();
    }
    try {
      return await this.repository.findUsageByKeyIds(ids);
    } catch (error) {
      logger.warn('Failed to load bearer key usage metadata:', error);
      return new Map();
    }
  }

  private toModel(
    entity: import('../db/entities/BearerKey.js').BearerKey,
    lastUsedAt?: Date,
  ): BearerKeyModel {
    const expiresAt = normalizeBearerKeyTimestamp(entity.expiresAt);
    const normalizedLastUsedAt = normalizeBearerKeyTimestamp(lastUsedAt);
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
      excludedGroups: entity.excludedGroups ?? [],
      excludedServers: entity.excludedServers ?? [],
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(normalizedLastUsedAt !== undefined ? { lastUsedAt: normalizedLastUsedAt } : {}),
    };
  }

  async findAll(): Promise<BearerKeyModel[]> {
    const entities = await this.repository.findAll();
    const usage = await this.loadUsageMapBestEffort(entities.map((e) => e.id));
    return entities.map((e) => this.toModel(e, usage.get(e.id)));
  }

  // Auth-path lookups intentionally skip `bearer_key_usage` so usage-table latency or
  // failures never impact authentication.
  async findEnabled(): Promise<BearerKeyModel[]> {
    const entities = (await this.repository.findAll()).filter((e) => e.enabled);
    return entities.map((e) => this.toModel(e));
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
    const usage = await this.loadUsageMapBestEffort(entities.map((e) => e.id));
    return entities.map((e) => this.toModel(e, usage.get(e.id)));
  }

  async create(data: Omit<BearerKeyModel, 'id'>): Promise<BearerKeyModel> {
    const normalizedExpiresAt = normalizeBearerKeyTimestamp(data.expiresAt);
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
      excludedGroups: data.excludedGroups ?? [],
      excludedServers: data.excludedServers ?? [],
      ...(normalizedExpiresAt !== undefined ? { expiresAt: new Date(normalizedExpiresAt) } : {}),
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
    const expiresAtUpdate =
      data.expiresAt === null
        ? { expiresAt: null }
        : data.expiresAt !== undefined
          ? { expiresAt: new Date(data.expiresAt) }
          : {};
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
      excludedGroups: data.excludedGroups,
      excludedServers: data.excludedServers,
      ...expiresAtUpdate,
    } as any);
    if (!entity) return null;
    const usage = await this.loadUsageMapBestEffort([entity.id]);
    return this.toModel(entity as any, usage.get(entity.id));
  }

  async delete(id: string): Promise<boolean> {
    return await this.repository.delete(id);
  }

  async deleteByOwner(owner: string): Promise<number> {
    return await this.repository.deleteByOwner(owner);
  }

  async recordLastUsed(id: string, usedAt: Date): Promise<boolean> {
    return await this.repository.recordLastUsed(id, usedAt);
  }

  async updateServerName(oldName: string, newName: string): Promise<number> {
    const allKeys = await this.repository.findAll();
    let updatedCount = 0;

    for (const key of allKeys) {
      let updated = false;

      for (const field of ['allowedServers', 'excludedServers'] as const) {
        const servers = key[field];
        if (!servers || servers.length === 0) continue;

        const newServers = servers.map((server) => {
          if (server === oldName) {
            updated = true;
            return newName;
          }
          return server;
        });

        if (newServers.some((server, index) => server !== servers[index])) {
          await this.repository.update(key.id, { [field]: newServers });
        }
      }

      if (updated) {
        updatedCount++;
      }
    }

    return updatedCount;
  }
}
