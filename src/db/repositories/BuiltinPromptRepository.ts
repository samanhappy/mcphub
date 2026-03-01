import { Repository } from 'typeorm';
import { BuiltinPrompt } from '../entities/BuiltinPrompt.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for BuiltinPrompt entity
 */
export class BuiltinPromptRepository {
  private repository: Repository<BuiltinPrompt>;

  constructor() {
    this.repository = getAppDataSource().getRepository(BuiltinPrompt);
  }

  async findAll(): Promise<BuiltinPrompt[]> {
    return await this.repository.find({ order: { createdAt: 'ASC' } });
  }

  async findEnabled(): Promise<BuiltinPrompt[]> {
    return await this.repository.find({ where: { enabled: true }, order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<BuiltinPrompt | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findByName(name: string): Promise<BuiltinPrompt | null> {
    return await this.repository.findOne({ where: { name } });
  }

  async create(
    data: Omit<BuiltinPrompt, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<BuiltinPrompt> {
    const entity = this.repository.create(data);
    return await this.repository.save(entity);
  }

  async update(id: string, updates: Partial<BuiltinPrompt>): Promise<BuiltinPrompt | null> {
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

export default BuiltinPromptRepository;
