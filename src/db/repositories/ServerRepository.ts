import { Repository } from 'typeorm';
import { Server } from '../entities/Server.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for Server entity
 */
export class ServerRepository {
  private repository: Repository<Server>;

  constructor() {
    this.repository = getAppDataSource().getRepository(Server);
  }

  /**
   * Find all servers
   */
  async findAll(): Promise<Server[]> {
    return await this.repository.find({ order: { createdAt: 'ASC' } });
  }

  /**
   * Find server by name
   */
  async findByName(name: string): Promise<Server | null> {
    return await this.repository.findOne({ where: { name } });
  }

  /**
   * Create a new server
   */
  async create(server: Omit<Server, 'id' | 'createdAt' | 'updatedAt'>): Promise<Server> {
    const newServer = this.repository.create(server);
    return await this.repository.save(newServer);
  }

  /**
   * Update an existing server
   */
  async update(name: string, serverData: Partial<Server>): Promise<Server | null> {
    const server = await this.findByName(name);
    if (!server) {
      return null;
    }
    const updated = this.repository.merge(server, serverData);
    return await this.repository.save(updated);
  }

  /**
   * Delete a server
   */
  async delete(name: string): Promise<boolean> {
    const result = await this.repository.delete({ name });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Check if server exists
   */
  async exists(name: string): Promise<boolean> {
    const count = await this.repository.count({ where: { name } });
    return count > 0;
  }

  /**
   * Count total servers
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Find servers by owner
   */
  async findByOwner(owner: string): Promise<Server[]> {
    return await this.repository.find({ where: { owner }, order: { createdAt: 'ASC' } });
  }

  /**
   * Find enabled servers
   */
  async findEnabled(): Promise<Server[]> {
    return await this.repository.find({ where: { enabled: true }, order: { createdAt: 'ASC' } });
  }

  /**
   * Set server enabled status
   */
  async setEnabled(name: string, enabled: boolean): Promise<Server | null> {
    return await this.update(name, { enabled });
  }

  /**
   * Rename a server
   */
  async rename(oldName: string, newName: string): Promise<boolean> {
    const server = await this.findByName(oldName);
    if (!server) {
      return false;
    }
    server.name = newName;
    await this.repository.save(server);
    return true;
  }
}

export default ServerRepository;
