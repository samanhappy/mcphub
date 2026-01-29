import { Repository, EntityTarget, ObjectLiteral } from 'typeorm';
import { getAppDataSource } from '../connection.js';
import { withDbRetry, RetryOptions } from '../../utils/dbRetry.js';

// Default retry options for repository operations
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Base repository class with common CRUD operations and automatic retry logic
 * for handling transient database connection failures.
 */
export class BaseRepository<T extends ObjectLiteral> {
  protected readonly repository: Repository<T>;
  protected readonly retryOptions: RetryOptions;

  constructor(entityClass: EntityTarget<T>, retryOptions?: RetryOptions) {
    this.repository = getAppDataSource().getRepository(entityClass);
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  }

  /**
   * Execute an operation with retry logic
   * @param operation The operation to execute
   * @param operationName Name of the operation for logging
   */
  protected async withRetry<TResult>(
    operation: () => Promise<TResult>,
    operationName: string,
  ): Promise<TResult> {
    return withDbRetry(operation, {
      ...this.retryOptions,
      operationName: `${this.constructor.name}.${operationName}`,
    });
  }

  /**
   * Get repository access
   */
  getRepository(): Repository<T> {
    return this.repository;
  }

  /**
   * Find all entities
   */
  async findAll(): Promise<T[]> {
    return this.withRetry(() => this.repository.find(), 'findAll');
  }

  /**
   * Find entity by ID
   * @param id Entity ID
   */
  async findById(id: string | number): Promise<T | null> {
    return this.withRetry(() => this.repository.findOneBy({ id } as any), 'findById');
  }

  /**
   * Save or update an entity
   * @param entity Entity to save
   */
  async save(entity: Partial<T>): Promise<T> {
    return this.withRetry(() => this.repository.save(entity as any), 'save');
  }

  /**
   * Save multiple entities
   * @param entities Array of entities to save
   */
  async saveMany(entities: Partial<T>[]): Promise<T[]> {
    return this.withRetry(() => this.repository.save(entities as any[]), 'saveMany');
  }

  /**
   * Delete an entity by ID
   * @param id Entity ID
   */
  async delete(id: string | number): Promise<boolean> {
    return this.withRetry(async () => {
      const result = await this.repository.delete(id);
      return result.affected !== null && result.affected !== undefined && result.affected > 0;
    }, 'delete');
  }

  /**
   * Count total entities
   */
  async count(): Promise<number> {
    return this.withRetry(() => this.repository.count(), 'count');
  }
}

export default BaseRepository;
