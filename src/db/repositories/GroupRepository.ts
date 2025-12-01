import { Repository } from 'typeorm';
import { Group } from '../entities/Group.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for Group entity
 */
export class GroupRepository {
  private repository: Repository<Group>;

  constructor() {
    this.repository = getAppDataSource().getRepository(Group);
  }

  /**
   * Find all groups
   */
  async findAll(): Promise<Group[]> {
    return await this.repository.find({ order: { createdAt: 'ASC' } });
  }

  /**
   * Find group by ID
   */
  async findById(id: string): Promise<Group | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find group by name
   */
  async findByName(name: string): Promise<Group | null> {
    return await this.repository.findOne({ where: { name } });
  }

  /**
   * Create a new group
   */
  async create(group: Omit<Group, 'id' | 'createdAt' | 'updatedAt'>): Promise<Group> {
    const newGroup = this.repository.create(group);
    return await this.repository.save(newGroup);
  }

  /**
   * Update an existing group
   */
  async update(id: string, groupData: Partial<Group>): Promise<Group | null> {
    const group = await this.findById(id);
    if (!group) {
      return null;
    }
    const updated = this.repository.merge(group, groupData);
    return await this.repository.save(updated);
  }

  /**
   * Delete a group
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Check if group exists by ID
   */
  async exists(id: string): Promise<boolean> {
    const count = await this.repository.count({ where: { id } });
    return count > 0;
  }

  /**
   * Check if group exists by name
   */
  async existsByName(name: string): Promise<boolean> {
    const count = await this.repository.count({ where: { name } });
    return count > 0;
  }

  /**
   * Count total groups
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Find groups by owner
   */
  async findByOwner(owner: string): Promise<Group[]> {
    return await this.repository.find({ where: { owner }, order: { createdAt: 'ASC' } });
  }
}

export default GroupRepository;
