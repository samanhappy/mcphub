import { Repository, EntityTarget, ObjectLiteral } from 'typeorm';
import { getAppDataSource } from '../connection.js';

/**
 * Base repository class with common CRUD operations
 */
export class BaseRepository<T extends ObjectLiteral> {
  protected readonly repository: Repository<T>;

  constructor(entityClass: EntityTarget<T>) {
    this.repository = getAppDataSource().getRepository(entityClass);
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
    return this.repository.find();
  }

  /**
   * Find entity by ID
   * @param id Entity ID
   */
  async findById(id: string | number): Promise<T | null> {
    return this.repository.findOneBy({ id } as any);
  }

  /**
   * Save or update an entity
   * @param entity Entity to save
   */
  async save(entity: Partial<T>): Promise<T> {
    return this.repository.save(entity as any);
  }

  /**
   * Save multiple entities
   * @param entities Array of entities to save
   */
  async saveMany(entities: Partial<T>[]): Promise<T[]> {
    return this.repository.save(entities as any[]);
  }

  /**
   * Delete an entity by ID
   * @param id Entity ID
   */
  async delete(id: string | number): Promise<boolean> {
    const result = await this.repository.delete(id);
    return result.affected !== null && result.affected !== undefined && result.affected > 0;
  }

  /**
   * Count total entities
   */
  async count(): Promise<number> {
    return this.repository.count();
  }
}

export default BaseRepository;
