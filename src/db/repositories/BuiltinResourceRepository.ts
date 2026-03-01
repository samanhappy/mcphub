import { Repository } from 'typeorm';
import { BuiltinResource } from '../entities/BuiltinResource.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for BuiltinResource entity
 */
export class BuiltinResourceRepository {
  private repository: Repository<BuiltinResource>;

  constructor() {
    this.repository = getAppDataSource().getRepository(BuiltinResource);
  }

  async findAll(): Promise<BuiltinResource[]> {
    return await this.repository.find({ order: { createdAt: 'ASC' } });
  }

  async findEnabled(): Promise<BuiltinResource[]> {
    return await this.repository.find({ where: { enabled: true }, order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<BuiltinResource | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findByUri(uri: string): Promise<BuiltinResource | null> {
    return await this.repository.findOne({ where: { uri } });
  }

  async create(
    data: Omit<BuiltinResource, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<BuiltinResource> {
    const entity = this.repository.create(data);
    return await this.repository.save(entity);
  }

  async update(id: string, updates: Partial<BuiltinResource>): Promise<BuiltinResource | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const merged = this.repository.merge(existing, updates);
    return await this.repository.save(merged);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}

export default BuiltinResourceRepository;
