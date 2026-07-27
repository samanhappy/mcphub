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

  async findAllByName(name: string): Promise<Server[]> {
    return await this.repository.find({ where: { name }, order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<Server | null> {
    return await this.repository.findOne({ where: { id } });
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
  async update(id: string, serverData: Partial<Server>): Promise<Server | null> {
    const server = await this.findById(id);
    if (!server) {
      return null;
    }
    const updated = this.repository.merge(server, serverData);
    return await this.repository.save(updated);
  }

  /**
   * Delete a server
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Check if server exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await this.repository.count({ where: { id } });
    return count > 0;
  }

  /**
   * Count total servers
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Find servers with pagination
   */
  async findAllPaginated(page: number, limit: number): Promise<{ data: Server[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await this.repository.findAndCount({
      order: {
        enabled: 'DESC', // Enabled servers first
        createdAt: 'ASC', // Then by creation time
      },
      skip,
      take: limit,
    });

    return { data, total };
  }

  /**
   * Find servers by owner with pagination
   */
  async findByOwnerPaginated(
    owner: string,
    page: number,
    limit: number,
  ): Promise<{ data: Server[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await this.repository.findAndCount({
      where: { owner },
      order: {
        enabled: 'DESC', // Enabled servers first
        createdAt: 'ASC', // Then by creation time
      },
      skip,
      take: limit,
    });

    return { data, total };
  }

  /**
   * Find servers visible to a non-admin user with pagination.
   */
  async findVisibleToUserPaginated(
    username: string,
    page: number,
    limit: number,
  ): Promise<{ data: Server[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await this.repository
      .createQueryBuilder('server')
      .where('server.owner = :username', { username })
      .orWhere('server.visibility = :visibility', { visibility: 'public' })
      .orderBy('server.enabled', 'DESC')
      .addOrderBy('server.createdAt', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { data, total };
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
  async setEnabled(id: string, enabled: boolean): Promise<Server | null> {
    return await this.update(id, { enabled });
  }

  /**
   * Rename a server
   */
  async rename(id: string, newName: string): Promise<boolean> {
    const server = await this.findById(id);
    if (!server) {
      return false;
    }
    server.name = newName;
    await this.repository.save(server);
    return true;
  }
}

export default ServerRepository;
