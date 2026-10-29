import { assertSmartRoutingNameAvailable } from '../../utils/smartRoutingPath.js';
import { Repository } from 'typeorm';
import { Group } from '../entities/Group.js';
import { BearerKey } from '../entities/BearerKey.js';
import { getAppDataSource } from '../connection.js';
import { assertGroupNameAvailable, moveGroupKeyScopes } from '../../utils/groupKeyScope.js';

/**
 * Repository for Group entity
 */
export class GroupRepository {
  private get repository(): Repository<Group> {
    return getAppDataSource().getRepository(Group);
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
    assertSmartRoutingNameAvailable(group.name);
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
    assertSmartRoutingNameAvailable(groupData.name);
    assertSmartRoutingNameAvailable(groupData.id);
    const updated = this.repository.merge(group, groupData);
    return await this.repository.save(updated);
  }

  /**
   * Update a group and, if it is renamed, move bearer key allowedGroups entries to the
   * new name in the same transaction, so a failure changes neither.
   */
  async updateWithKeyScopes(id: string, groupData: Partial<Group>): Promise<Group | null> {
    assertSmartRoutingNameAvailable(groupData.name);
    assertSmartRoutingNameAvailable(groupData.id);
    return await getAppDataSource().transaction(async (manager) => {
      const groups = manager.getRepository(Group);
      // Lock the row so a concurrent rename of the same group waits for this one.
      const group = await groups.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!group) {
        return null;
      }

      const oldName = group.name;
      const updated = groups.merge(group, groupData);
      if (updated.name === oldName) {
        return await groups.save(updated);
      }

      const allGroups = await groups.find({ select: { id: true, name: true } });
      assertGroupNameAvailable(allGroups, id, updated.name);
      const saved = await groups.save(updated);
      const keys = manager.getRepository(BearerKey);
      const allKeys = await keys.find({
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const changed = moveGroupKeyScopes(
        allKeys,
        oldName,
        saved.name,
        allGroups.map((g) => g.id),
      );
      if (changed.length > 0) {
        await keys.save(changed);
      }
      return saved;
    });
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
