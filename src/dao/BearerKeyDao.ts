import { randomUUID } from 'node:crypto';
import { BearerKey } from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

/**
 * DAO interface for bearer authentication keys
 */
export interface BearerKeyDao {
  findAll(): Promise<BearerKey[]>;
  findEnabled(): Promise<BearerKey[]>;
  findById(id: string): Promise<BearerKey | undefined>;
  findByToken(token: string): Promise<BearerKey | undefined>;
  create(data: Omit<BearerKey, 'id'>): Promise<BearerKey>;
  update(id: string, data: Partial<Omit<BearerKey, 'id'>>): Promise<BearerKey | null>;
  delete(id: string): Promise<boolean>;
}

/**
 * JSON file-based BearerKey DAO implementation
 * Stores keys under the top-level `bearerKeys` field in mcp_settings.json
 * and performs one-time migration from legacy routing.enableBearerAuth/bearerAuthKey.
 */
export class BearerKeyDaoImpl extends JsonFileBaseDao implements BearerKeyDao {
  private async loadKeysWithMigration(): Promise<BearerKey[]> {
    const settings = await this.loadSettings();

    // Treat an existing array (including an empty array) as already migrated.
    // Otherwise, when there are no configured keys, we'd rewrite mcp_settings.json
    // on every request, which also clears the global settings cache.
    if (Array.isArray(settings.bearerKeys)) {
      return settings.bearerKeys;
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
          token: rawKey,
          enabled: enableBearerAuth,
          accessType: 'all',
          allowedGroups: [],
          allowedServers: [],
        },
      ];
    }

    // Cases 1 and 4 both result in empty keys list
    settings.bearerKeys = migrated;
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
    return keys.find((key) => key.token === token);
  }

  async create(data: Omit<BearerKey, 'id'>): Promise<BearerKey> {
    const keys = await this.loadKeysWithMigration();
    const newKey: BearerKey = {
      id: randomUUID(),
      ...data,
    };
    keys.push(newKey);
    await this.saveKeys(keys);
    return newKey;
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
}
