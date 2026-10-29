import { IsNull, Repository } from 'typeorm';
import { BearerKey } from '../entities/BearerKey.js';
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
   * Apply several key updates in one transaction: either all are saved or none are.
   */
  async updateMany(
    updates: { id: string; changes: Partial<Omit<BearerKey, 'id' | 'createdAt' | 'updatedAt'>> }[],
  ): Promise<void> {
    await this.withRetry(
      () =>
        getAppDataSource().transaction(async (manager) => {
          const repository = manager.getRepository(BearerKey);
          for (const { id, changes } of updates) {
            const existing = await repository.findOne({ where: { id } });
            if (existing) {
              await repository.save(repository.merge(existing, changes));
            }
          }
        }),
      'updateMany',
    );
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
   * Delete a bearer key
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
}

export default BearerKeyRepository;
