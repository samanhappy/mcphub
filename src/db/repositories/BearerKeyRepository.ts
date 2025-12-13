import { Repository } from 'typeorm';
import { BearerKey } from '../entities/BearerKey.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for BearerKey entity
 */
export class BearerKeyRepository {
  private repository: Repository<BearerKey>;

  constructor() {
    this.repository = getAppDataSource().getRepository(BearerKey);
  }

  /**
   * Find all bearer keys
   */
  async findAll(): Promise<BearerKey[]> {
    return await this.repository.find({ order: { createdAt: 'ASC' } });
  }

  /**
   * Count bearer keys
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Find bearer key by id
   */
  async findById(id: string): Promise<BearerKey | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find bearer key by token value
   */
  async findByToken(token: string): Promise<BearerKey | null> {
    return await this.repository.findOne({ where: { token } });
  }

  /**
   * Create a new bearer key
   */
  async create(data: Omit<BearerKey, 'id' | 'createdAt' | 'updatedAt'>): Promise<BearerKey> {
    const entity = this.repository.create(data);
    return await this.repository.save(entity);
  }

  /**
   * Update an existing bearer key
   */
  async update(
    id: string,
    updates: Partial<Omit<BearerKey, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<BearerKey | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }
    const merged = this.repository.merge(existing, updates);
    return await this.repository.save(merged);
  }

  /**
   * Delete a bearer key
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}

export default BearerKeyRepository;
