import { randomUUID } from 'node:crypto';
import { BearerKey } from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';
import { bearerKeyMatches, toStoredToken } from '../utils/bearerKeyToken.js';

/**
 * DAO interface for bearer authentication keys
 */
export interface BearerKeyDao {
  findAll(): Promise<BearerKey[]>;
  findEnabled(): Promise<BearerKey[]>;
  findById(id: string): Promise<BearerKey | undefined>;
  findByToken(token: string): Promise<BearerKey | undefined>;
  findByOwner(owner: string): Promise<BearerKey[]>;
  create(data: Omit<BearerKey, 'id'>): Promise<BearerKey>;
  update(id: string, data: Partial<Omit<BearerKey, 'id'>>): Promise<BearerKey | null>;
  delete(id: string): Promise<boolean>;
  deleteByOwner(owner: string): Promise<number>;
  /**
   * Replace raw tokens still stored (keys created before hashing) with their hash and prefix.
   * Returns the number of keys hashed.
   */
  hashLegacyTokens(): Promise<number>;
  /**
   * Update server name in all bearer keys (when server is renamed)
   */
  updateServerName(oldName: string, newName: string): Promise<number>;
  /**
   * Update group name in all bearer keys (when group is renamed)
   */
  updateGroupName(oldName: string, newName: string): Promise<number>;
}

/**
 * JSON file-based BearerKey DAO implementation
 * Stores keys under the top-level `bearerKeys` field in mcp_settings.json
 * and performs one-time migration from legacy routing.enableBearerAuth/bearerAuthKey.
 */
export class BearerKeyDaoImpl extends JsonFileBaseDao implements BearerKeyDao {
  private normalizeKey(key: BearerKey): BearerKey {
    return {
      ...key,
      kind: key.kind ?? 'system',
    };
  }

  private async loadKeysWithMigration(): Promise<BearerKey[]> {
    const settings = await this.loadSettings();

    // Treat an existing array (including an empty array) as already migrated.
    // Otherwise, when there are no configured keys, we'd rewrite mcp_settings.json
    // on every request, which also clears the global settings cache.
    if (Array.isArray(settings.bearerKeys)) {
      return settings.bearerKeys.map((key) => this.normalizeKey(key));
    }

    // Perform one-time migration from legacy routing config if present
    const routing = settings.systemConfig?.routing || {};
    const enableBearerAuth: boolean = !!routing.enableBearerAuth;
    const rawKey: string = (routing.bearerAuthKey || '').trim();

    let migrated: BearerKey[] = [];

    if (rawKey) {
      // Cases 2 and 3 in migration rules
      migrated = [
        {
          id: randomUUID(),
          name: 'default',
          ...toStoredToken(rawKey),
          enabled: enableBearerAuth,
          kind: 'system',
          accessType: 'all',
          allowedGroups: [],
          allowedServers: [],
        },
      ];
    }

    // Cases 1 and 4 both result in empty keys list
    settings.bearerKeys = migrated;
    if (rawKey && settings.systemConfig?.routing) {
      settings.systemConfig.routing.bearerAuthKey = ''; // do not leave the raw key behind
    }
    await this.saveSettings(settings);

    return migrated;
  }

  private async saveKeys(keys: BearerKey[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.bearerKeys = keys;
    await this.saveSettings(settings);
  }

  async findAll(): Promise<BearerKey[]> {
    return await this.loadKeysWithMigration();
  }

  async findEnabled(): Promise<BearerKey[]> {
    const keys = await this.loadKeysWithMigration();
    return keys.filter((key) => key.enabled);
  }

  async findById(id: string): Promise<BearerKey | undefined> {
    const keys = await this.loadKeysWithMigration();
    return keys.find((key) => key.id === id);
  }

  async findByToken(token: string): Promise<BearerKey | undefined> {
    const keys = await this.loadKeysWithMigration();
    return keys.find((key) => bearerKeyMatches(key, token));
  }

  async findByOwner(owner: string): Promise<BearerKey[]> {
    const keys = await this.loadKeysWithMigration();
    return keys.filter((key) => key.kind === 'user' && key.owner === owner);
  }

  async create(data: Omit<BearerKey, 'id'>): Promise<BearerKey> {
    const keys = await this.loadKeysWithMigration();
    const { token, ...rest } = data;
    const stored: BearerKey = {
      id: randomUUID(),
      ...rest,
      ...(token ? toStoredToken(token) : {}),
    };
    keys.push(stored);
    await this.saveKeys(keys);
    // The raw token is returned here only, so the caller can show it once.
    return { ...stored, token };
  }

  async hashLegacyTokens(): Promise<number> {
    const keys = await this.loadKeysWithMigration();
    let count = 0;
    for (const key of keys) {
      if (key.token && !key.tokenHash) {
        Object.assign(key, toStoredToken(key.token));
        delete key.token;
        count++;
      }
    }
    if (count > 0) {
      await this.saveKeys(keys);
    }
    // Instances migrated by an older version still carry the raw legacy key
    const settings = await this.loadSettings();
    if (settings.systemConfig?.routing?.bearerAuthKey) {
      settings.systemConfig.routing.bearerAuthKey = '';
      await this.saveSettings(settings);
    }
    return count;
  }

  async update(id: string, data: Partial<Omit<BearerKey, 'id'>>): Promise<BearerKey | null> {
    const keys = await this.loadKeysWithMigration();
    const index = keys.findIndex((key) => key.id === id);
    if (index === -1) {
      return null;
    }

    const updated: BearerKey = {
      ...keys[index],
      ...data,
      id: keys[index].id,
    };
    keys[index] = updated;
    await this.saveKeys(keys);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const keys = await this.loadKeysWithMigration();
    const next = keys.filter((key) => key.id !== id);
    if (next.length === keys.length) {
      return false;
    }
    await this.saveKeys(next);
    return true;
  }

  async deleteByOwner(owner: string): Promise<number> {
    const keys = await this.loadKeysWithMigration();
    const next = keys.filter((key) => key.kind !== 'user' || key.owner !== owner);
    const deletedCount = keys.length - next.length;
    if (deletedCount > 0) {
      await this.saveKeys(next);
    }
    return deletedCount;
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
    const keys = await this.loadKeysWithMigration();
    let updatedCount = 0;

    for (const key of keys) {
      if (key[field]?.includes(oldName)) {
        key[field] = key[field]!.map((entry) => (entry === oldName ? newName : entry));
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await this.saveKeys(keys);
    }

    return updatedCount;
  }
}
