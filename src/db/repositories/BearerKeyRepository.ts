import { Repository } from 'typeorm';
import { BearerKey } from '../entities/BearerKey.js';
import { getAppDataSource } from '../connection.js';
import { withDbRetry, RetryOptions } from '../../utils/dbRetry.js';

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
  private repository: Repository<BearerKey>;
  private retryOptions: RetryOptions;

  constructor(retryOptions?: RetryOptions) {
    this.repository = getAppDataSource().getRepository(BearerKey);
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
   * Find bearer key by token value
   */
  async findByToken(token: string): Promise<BearerKey | null> {
    return this.withRetry(() => this.repository.findOne({ where: { token } }), 'findByToken');
  }

  /**
   * Create a new bearer key
   */
  async create(data: Omit<BearerKey, 'id' | 'createdAt' | 'updatedAt'>): Promise<BearerKey> {
    return this.withRetry(async () => {
      const entity = this.repository.create(data);
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
   * Delete a bearer key
   */
  async delete(id: string): Promise<boolean> {
    return this.withRetry(async () => {
      const result = await this.repository.delete({ id });
      return (result.affected ?? 0) > 0;
    }, 'delete');
  }
}

export default BearerKeyRepository;
