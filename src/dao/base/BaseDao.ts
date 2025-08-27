/**
 * Base DAO interface providing common CRUD operations
 */
export interface BaseDao<T, K = string> {
  /**
   * Find all entities
   */
  findAll(): Promise<T[]>;

  /**
   * Find entity by ID
   */
  findById(id: K): Promise<T | null>;

  /**
   * Create new entity
   */
  create(entity: Omit<T, 'id'>): Promise<T>;

  /**
   * Update existing entity
   */
  update(id: K, entity: Partial<T>): Promise<T | null>;

  /**
   * Delete entity by ID
   */
  delete(id: K): Promise<boolean>;

  /**
   * Check if entity exists
   */
  exists(id: K): Promise<boolean>;

  /**
   * Count total entities
   */
  count(): Promise<number>;
}

/**
 * Base DAO implementation with common functionality
 */
export abstract class BaseDaoImpl<T, K = string> implements BaseDao<T, K> {
  protected abstract getAll(): Promise<T[]>;
  protected abstract saveAll(entities: T[]): Promise<void>;
  protected abstract getEntityId(entity: T): K;
  protected abstract createEntity(data: Omit<T, 'id'>): T;
  protected abstract updateEntity(existing: T, updates: Partial<T>): T;

  async findAll(): Promise<T[]> {
    return this.getAll();
  }

  async findById(id: K): Promise<T | null> {
    const entities = await this.getAll();
    return entities.find((entity) => this.getEntityId(entity) === id) || null;
  }

  async create(data: Omit<T, 'id'>): Promise<T> {
    const entities = await this.getAll();
    const newEntity = this.createEntity(data);

    entities.push(newEntity);
    await this.saveAll(entities);

    return newEntity;
  }

  async update(id: K, updates: Partial<T>): Promise<T | null> {
    const entities = await this.getAll();
    const index = entities.findIndex((entity) => this.getEntityId(entity) === id);

    if (index === -1) {
      return null;
    }

    const updatedEntity = this.updateEntity(entities[index], updates);
    entities[index] = updatedEntity;

    await this.saveAll(entities);
    return updatedEntity;
  }

  async delete(id: K): Promise<boolean> {
    const entities = await this.getAll();
    const index = entities.findIndex((entity) => this.getEntityId(entity) === id);

    if (index === -1) {
      return false;
    }

    entities.splice(index, 1);
    await this.saveAll(entities);
    return true;
  }

  async exists(id: K): Promise<boolean> {
    const entity = await this.findById(id);
    return entity !== null;
  }

  async count(): Promise<number> {
    const entities = await this.getAll();
    return entities.length;
  }
}
