import { IGroup } from '../types/index.js';
import { BaseDao } from './base/BaseDao.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Group DAO interface with group-specific operations
 */
export interface GroupDao extends BaseDao<IGroup, string> {
  /**
   * Find groups by owner
   */
  findByOwner(owner: string): Promise<IGroup[]>;

  /**
   * Find groups containing specific server
   */
  findByServer(serverName: string): Promise<IGroup[]>;

  /**
   * Add server to group
   */
  addServerToGroup(groupId: string, serverName: string): Promise<boolean>;

  /**
   * Remove server from group
   */
  removeServerFromGroup(groupId: string, serverName: string): Promise<boolean>;

  /**
   * Update group servers
   */
  updateServers(groupId: string, servers: string[] | IGroup['servers']): Promise<boolean>;

  /**
   * Find group by name
   */
  findByName(name: string): Promise<IGroup | null>;
}

/**
 * JSON file-based Group DAO implementation
 */
export class GroupDaoImpl extends JsonFileBaseDao implements GroupDao {
  protected async getAll(): Promise<IGroup[]> {
    const settings = await this.loadSettings();
    return settings.groups || [];
  }

  protected async saveAll(groups: IGroup[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.groups = groups;
    await this.saveSettings(settings);
  }

  protected getEntityId(group: IGroup): string {
    return group.id;
  }

  protected createEntity(data: Omit<IGroup, 'id'>): IGroup {
    return {
      id: uuidv4(),
      owner: 'admin', // Default owner
      ...data,
      servers: data.servers || [],
    };
  }

  protected updateEntity(existing: IGroup, updates: Partial<IGroup>): IGroup {
    return {
      ...existing,
      ...updates,
      id: existing.id, // ID should not be updated
    };
  }

  async findAll(): Promise<IGroup[]> {
    return this.getAll();
  }

  async findById(id: string): Promise<IGroup | null> {
    const groups = await this.getAll();
    return groups.find((group) => group.id === id) || null;
  }

  async create(data: Omit<IGroup, 'id'>): Promise<IGroup> {
    const groups = await this.getAll();

    // Check if group name already exists
    if (groups.find((group) => group.name === data.name)) {
      throw new Error(`Group with name ${data.name} already exists`);
    }

    const newGroup = this.createEntity(data);
    groups.push(newGroup);
    await this.saveAll(groups);

    return newGroup;
  }

  async update(id: string, updates: Partial<IGroup>): Promise<IGroup | null> {
    const groups = await this.getAll();
    const index = groups.findIndex((group) => group.id === id);

    if (index === -1) {
      return null;
    }

    // Check if name update would cause conflict
    if (updates.name && updates.name !== groups[index].name) {
      const existingGroup = groups.find((group) => group.name === updates.name && group.id !== id);
      if (existingGroup) {
        throw new Error(`Group with name ${updates.name} already exists`);
      }
    }

    // Don't allow ID changes
    const { id: _, ...allowedUpdates } = updates;
    const updatedGroup = this.updateEntity(groups[index], allowedUpdates);
    groups[index] = updatedGroup;

    await this.saveAll(groups);
    return updatedGroup;
  }

  async delete(id: string): Promise<boolean> {
    const groups = await this.getAll();
    const index = groups.findIndex((group) => group.id === id);

    if (index === -1) {
      return false;
    }

    groups.splice(index, 1);
    await this.saveAll(groups);
    return true;
  }

  async exists(id: string): Promise<boolean> {
    const group = await this.findById(id);
    return group !== null;
  }

  async count(): Promise<number> {
    const groups = await this.getAll();
    return groups.length;
  }

  async findByOwner(owner: string): Promise<IGroup[]> {
    const groups = await this.getAll();
    return groups.filter((group) => group.owner === owner);
  }

  async findByServer(serverName: string): Promise<IGroup[]> {
    const groups = await this.getAll();
    return groups.filter((group) => {
      if (Array.isArray(group.servers)) {
        return group.servers.some((server) => {
          if (typeof server === 'string') {
            return server === serverName;
          } else {
            return server.name === serverName;
          }
        });
      }
      return false;
    });
  }

  async addServerToGroup(groupId: string, serverName: string): Promise<boolean> {
    const group = await this.findById(groupId);
    if (!group) {
      return false;
    }

    // Check if server already exists in group
    const serverExists = group.servers.some((server) => {
      if (typeof server === 'string') {
        return server === serverName;
      } else {
        return server.name === serverName;
      }
    });

    if (serverExists) {
      return true; // Already exists, consider it success
    }

    const updatedServers = [...group.servers, serverName] as IGroup['servers'];
    const result = await this.update(groupId, { servers: updatedServers });
    return result !== null;
  }

  async removeServerFromGroup(groupId: string, serverName: string): Promise<boolean> {
    const group = await this.findById(groupId);
    if (!group) {
      return false;
    }

    const updatedServers = group.servers.filter((server) => {
      if (typeof server === 'string') {
        return server !== serverName;
      } else {
        return server.name !== serverName;
      }
    }) as IGroup['servers'];

    const result = await this.update(groupId, { servers: updatedServers });
    return result !== null;
  }

  async updateServers(groupId: string, servers: string[] | IGroup['servers']): Promise<boolean> {
    const result = await this.update(groupId, { servers });
    return result !== null;
  }

  async findByName(name: string): Promise<IGroup | null> {
    const groups = await this.getAll();
    return groups.find((group) => group.name === name) || null;
  }
}
