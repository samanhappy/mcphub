import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSettingsPath } from '../config/index.js';
import { BearerKey } from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';
import { bearerKeyMatches, toStoredToken } from '../utils/bearerKeyToken.js';
import { normalizeBearerKeyTimestamp } from '../utils/bearerKeyExpiry.js';

export const getBearerKeyUsageStorePath = (): string => `${getSettingsPath()}.bearer-key-usage.json`;

const MALFORMED_EXPIRES_AT_SENTINEL = 'invalid-expires-at';

// Per-settings-path in-process mutex to serialize key deletions and sidecar usage writes.
const fileOpQueues = new Map<string, Promise<void>>();

const withSerializedFileOp = async <T>(settingsPath: string, fn: () => Promise<T>): Promise<T> => {
  const prev = fileOpQueues.get(settingsPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => current);
  fileOpQueues.set(settingsPath, tail);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (fileOpQueues.get(settingsPath) === tail) {
      fileOpQueues.delete(settingsPath);
    }
  }
};

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
   * Record the most recent successful authorized use of a key as isolated operational metadata.
   * Never recreates deleted keys or overwrites concurrent key configuration edits.
   */
  recordLastUsed(id: string, usedAt: Date): Promise<boolean>;
  /**
   * Replace raw tokens still stored (keys created before hashing) with their hash and prefix.
   * Returns the number of keys hashed.
   */
  hashLegacyTokens(): Promise<number>;
  /**
   * Update server name in all bearer keys (when server is renamed)
   */
  updateServerName(oldName: string, newName: string): Promise<number>;
}

/**
 * JSON file-based BearerKey DAO implementation
 * Stores keys under the top-level `bearerKeys` field in mcp_settings.json
 * and performs one-time migration from legacy routing.enableBearerAuth/bearerAuthKey.
 * Operational `lastUsedAt` timestamps live in a sidecar file so usage writes never
 * rewrite mcp_settings.json or race with concurrent key edits/resets/deletions.
 */
export class BearerKeyDaoImpl extends JsonFileBaseDao implements BearerKeyDao {
  private readUsageMap(): Record<string, string> {
    try {
      const parsed = JSON.parse(fs.readFileSync(getBearerKeyUsageStorePath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      const result: Record<string, string> = {};
      for (const [keyId, value] of Object.entries(parsed)) {
        const normalized = normalizeBearerKeyTimestamp(value);
        if (normalized) {
          result[keyId] = normalized;
        }
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      return {};
    }
  }

  private writeUsageMap(usage: Record<string, string>): void {
    const file = getBearerKeyUsageStorePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(usage), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  private removeUsageEntries(ids: string[]): void {
    if (ids.length === 0) return;
    const usage = this.readUsageMap();
    let changed = false;
    for (const id of ids) {
      if (Object.prototype.hasOwnProperty.call(usage, id)) {
        delete usage[id];
        changed = true;
      }
    }
    if (changed) {
      try {
        this.writeUsageMap(usage);
      } catch {
        // Best-effort cleanup of operational metadata.
      }
    }
  }

  private normalizeKey(key: BearerKey, usageMap?: Record<string, string>): BearerKey {
    const normalized: BearerKey = {
      ...key,
      kind: key.kind ?? 'system',
    };

    // Preserve malformed persisted expiresAt values instead of dropping them so
    // `isBearerKeyExpired` fails closed rather than turning corrupted data into non-expiring.
    if (key.expiresAt === undefined || key.expiresAt === null) {
      delete normalized.expiresAt;
    } else {
      const normalizedExpiresAt = normalizeBearerKeyTimestamp(key.expiresAt);
      if (normalizedExpiresAt !== undefined) {
        normalized.expiresAt = normalizedExpiresAt;
      } else {
        normalized.expiresAt =
          typeof key.expiresAt === 'string' && key.expiresAt.length > 0
            ? key.expiresAt
            : MALFORMED_EXPIRES_AT_SENTINEL;
      }
    }

    if (usageMap) {
      const lastUsedAt = usageMap[key.id] ?? normalizeBearerKeyTimestamp(key.lastUsedAt);
      if (lastUsedAt !== undefined) {
        normalized.lastUsedAt = lastUsedAt;
      } else {
        delete normalized.lastUsedAt;
      }
    } else {
      delete normalized.lastUsedAt;
    }

    return normalized;
  }

  private stripOperationalFields(keys: BearerKey[]): BearerKey[] {
    return keys.map(({ lastUsedAt: _lastUsedAt, ...rest }) => {
      if (rest.expiresAt === null || rest.expiresAt === undefined) {
        const { expiresAt: _expiresAt, ...withoutExpiry } = rest;
        return withoutExpiry;
      }
      return rest;
    });
  }

  private async loadKeysWithMigration(includeUsage = false): Promise<BearerKey[]> {
    const settings = await this.loadSettings();

    // Treat an existing array (including an empty array) as already migrated.
    // Otherwise, when there are no configured keys, we'd rewrite mcp_settings.json
    // on every request, which also clears the global settings cache.
    if (Array.isArray(settings.bearerKeys)) {
      const usageMap = includeUsage ? this.readUsageMap() : undefined;
      return settings.bearerKeys.map((key) => this.normalizeKey(key, usageMap));
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
    settings.bearerKeys = this.stripOperationalFields(keys);
    await this.saveSettings(settings);
  }

  async findAll(): Promise<BearerKey[]> {
    return await this.loadKeysWithMigration(true);
  }

  // Auth-path lookups skip reading the usage sidecar.
  async findEnabled(): Promise<BearerKey[]> {
    const keys = await this.loadKeysWithMigration(false);
    return keys.filter((key) => key.enabled);
  }

  async findById(id: string): Promise<BearerKey | undefined> {
    const keys = await this.loadKeysWithMigration(false);
    return keys.find((key) => key.id === id);
  }

  async findByToken(token: string): Promise<BearerKey | undefined> {
    const keys = await this.loadKeysWithMigration(false);
    return keys.find((key) => bearerKeyMatches(key, token));
  }

  async findByOwner(owner: string): Promise<BearerKey[]> {
    const keys = await this.loadKeysWithMigration(true);
    return keys.filter((key) => key.kind === 'user' && key.owner === owner);
  }

  async create(data: Omit<BearerKey, 'id'>): Promise<BearerKey> {
    const keys = await this.loadKeysWithMigration();
    const { token, lastUsedAt: _lastUsedAt, expiresAt, ...rest } = data;
    const normalizedExpiresAt = normalizeBearerKeyTimestamp(expiresAt);
    const stored: BearerKey = {
      id: randomUUID(),
      ...rest,
      ...(normalizedExpiresAt !== undefined ? { expiresAt: normalizedExpiresAt } : {}),
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

    const { lastUsedAt: _lastUsedAt, expiresAt, ...rest } = data;
    const updated: BearerKey = {
      ...keys[index],
      ...rest,
      id: keys[index].id,
    };
    if (expiresAt === null) {
      delete updated.expiresAt;
    } else if (expiresAt !== undefined) {
      const normalizedExpiresAt = normalizeBearerKeyTimestamp(expiresAt);
      if (normalizedExpiresAt !== undefined) {
        updated.expiresAt = normalizedExpiresAt;
      } else {
        delete updated.expiresAt;
      }
    }
    keys[index] = updated;
    await this.saveKeys(keys);
    return this.normalizeKey(updated, this.readUsageMap());
  }

  async delete(id: string): Promise<boolean> {
    return withSerializedFileOp(getSettingsPath(), async () => {
      const keys = await this.loadKeysWithMigration(false);
      const next = keys.filter((key) => key.id !== id);
      if (next.length === keys.length) {
        return false;
      }
      await this.saveKeys(next);
      this.removeUsageEntries([id]);
      return true;
    });
  }

  async deleteByOwner(owner: string): Promise<number> {
    return withSerializedFileOp(getSettingsPath(), async () => {
      const keys = await this.loadKeysWithMigration(false);
      const removedIds = keys
        .filter((key) => key.kind === 'user' && key.owner === owner)
        .map((key) => key.id);
      const next = keys.filter((key) => key.kind !== 'user' || key.owner !== owner);
      const deletedCount = keys.length - next.length;
      if (deletedCount > 0) {
        await this.saveKeys(next);
        this.removeUsageEntries(removedIds);
      }
      return deletedCount;
    });
  }

  async recordLastUsed(id: string, usedAt: Date): Promise<boolean> {
    const nextIso = normalizeBearerKeyTimestamp(usedAt);
    if (!nextIso) {
      return false;
    }
    return withSerializedFileOp(getSettingsPath(), async () => {
      // Re-check key existence inside the critical section so a concurrent delete cannot
      // leave an orphaned usage entry in the sidecar.
      const keys = await this.loadKeysWithMigration(false);
      if (!keys.some((key) => key.id === id)) {
        return false;
      }
      const usage = this.readUsageMap();
      const existingMs = usage[id] ? Date.parse(usage[id]) : Number.NEGATIVE_INFINITY;
      const nextMs = Date.parse(nextIso);
      if (existingMs >= nextMs) {
        return false;
      }
      usage[id] = nextIso;
      this.writeUsageMap(usage);
      return true;
    });
  }

  async updateServerName(oldName: string, newName: string): Promise<number> {
    const keys = await this.loadKeysWithMigration();
    let updatedCount = 0;

    for (const key of keys) {
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
          key[field] = newServers;
        }
      }

      if (updated) {
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await this.saveKeys(keys);
    }

    return updatedCount;
  }
}
