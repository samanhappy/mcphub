import { In, IsNull, Repository } from 'typeorm';
import { BearerKey } from '../entities/BearerKey.js';
import { BearerKeyUsage } from '../entities/BearerKeyUsage.js';
import { getAppDataSource } from '../connection.js';
import { withDbRetry, RetryOptions } from '../../utils/dbRetry.js';
import { hashBearerToken, toStoredToken } from '../../utils/bearerKeyToken.js';

// Default retry options
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Repository for BearerKey entity with automatic retry logic
 */
export class BearerKeyRepository {
  private get repository(): Repository<BearerKey> {
    return getAppDataSource().getRepository(BearerKey);
  }
  private get usageRepository(): Repository<BearerKeyUsage> {
    return getAppDataSource().getRepository(BearerKeyUsage);
  }
  private retryOptions: RetryOptions;

  constructor(retryOptions?: RetryOptions) {
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  }

  /**
   * Execute an operation with retry logic
   */
  private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    return withDbRetry(operation, {
      ...this.retryOptions,
      operationName: `BearerKeyRepository.${operationName}`,
    });
  }

  /**
   * Find all bearer keys
   */
  async findAll(): Promise<BearerKey[]> {
    return this.withRetry(() => this.repository.find({ order: { createdAt: 'ASC' } }), 'findAll');
  }

  /**
   * Count bearer keys
   */
  async count(): Promise<number> {
    return this.withRetry(() => this.repository.count(), 'count');
  }

  /**
   * Find bearer key by id
   */
  async findById(id: string): Promise<BearerKey | null> {
    return this.withRetry(() => this.repository.findOne({ where: { id } }), 'findById');
  }

  /**
   * Find bearer key by token value (looked up by its SHA-256 hash)
   */
  async findByToken(token: string): Promise<BearerKey | null> {
    return this.withRetry(
      () =>
        this.repository.findOne({
          // unmigrated rows still hold the raw token
          where: [{ tokenHash: hashBearerToken(token) }, { token, tokenHash: IsNull() }],
        }),
      'findByToken',
    );
  }

  /**
   * Replace any raw token still stored with its hash and prefix. Returns the number of keys hashed.
   */
  async hashLegacyTokens(): Promise<number> {
    const legacy = (await this.findAll()).filter((key) => key.token && !key.tokenHash);
    for (const key of legacy) {
      await this.withRetry(
        () =>
          this.repository.update(
            { id: key.id },
            { ...toStoredToken(key.token as string), token: null },
          ),
        'hashLegacyTokens',
      );
    }
    return legacy.length;
  }

  async findByOwner(owner: string): Promise<BearerKey[]> {
    return this.withRetry(
      () => this.repository.find({ where: { kind: 'user', owner }, order: { createdAt: 'ASC' } }),
      'findByOwner',
    );
  }

  /**
   * Create a new bearer key
   */
  async create(
    data: Omit<BearerKey, 'id' | 'createdAt' | 'updatedAt' | 'token'> & { token?: string },
  ): Promise<BearerKey> {
    return this.withRetry(async () => {
      // Either a raw token (hashed here) or an already hashed tokenHash/tokenPrefix pair
      const { token, ...rest } = data;
      const entity = this.repository.create({ ...rest, ...(token ? toStoredToken(token) : {}) });
      return await this.repository.save(entity);
    }, 'create');
  }

  /**
   * Update an existing bearer key
   */
  async update(
    id: string,
    updates: Partial<Omit<BearerKey, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<BearerKey | null> {
    return this.withRetry(async () => {
      const existing = await this.findById(id);
      if (!existing) {
        return null;
      }
      const merged = this.repository.merge(existing, updates);
      return await this.repository.save(merged);
    }, 'update');
  }

  /**
   * Delete a bearer key (associated `bearer_key_usage` rows cascade automatically via FK).
   */
  async delete(id: string): Promise<boolean> {
    return this.withRetry(async () => {
      const result = await this.repository.delete({ id });
      return (result.affected ?? 0) > 0;
    }, 'delete');
  }

  async deleteByOwner(owner: string): Promise<number> {
    return this.withRetry(async () => {
      const result = await this.repository.delete({ kind: 'user', owner });
      return result.affected ?? 0;
    }, 'deleteByOwner');
  }

  /**
   * Look up operational lastUsedAt timestamps for a set of key IDs.
   */
  async findUsageByKeyIds(ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.withRetry(
      () => this.usageRepository.find({ where: { keyId: In(ids) } }),
      'findUsageByKeyIds',
    );
    const result = new Map<string, Date>();
    for (const row of rows) {
      result.set(row.keyId, row.lastUsedAt);
    }
    return result;
  }

  /**
   * Narrow conditional upsert into the isolated `bearer_key_usage` table.
   * Single bounded best-effort attempt (no retry loop): only writes if the key still exists
   * in `bearer_keys` and the timestamp advances; never modifies `bearer_keys` so replica
   * configuration revision is unaffected.
   */
  async recordLastUsed(id: string, usedAt: Date): Promise<boolean> {
    const rows = (await this.usageRepository.manager.query(
      `
      INSERT INTO "bearer_key_usage" ("key_id", "last_used_at")
      SELECT $1::uuid, $2::timestamptz
      WHERE EXISTS (SELECT 1 FROM "bearer_keys" WHERE "id" = $1::uuid)
      ON CONFLICT ("key_id") DO UPDATE
        SET "last_used_at" = EXCLUDED."last_used_at"
        WHERE "bearer_key_usage"."last_used_at" < EXCLUDED."last_used_at"
      RETURNING "key_id"
      `,
      [id, usedAt],
    )) as Array<{ key_id: string }>;
    return rows.length > 0;
  }
}

export default BearerKeyRepository;
