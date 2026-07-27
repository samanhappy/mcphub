import { ServerConfig } from '../types/index.js';
import { BaseDao } from './base/BaseDao.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';
import { randomUUID } from 'node:crypto';

/**
 * Pagination result interface
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Server DAO interface with server-specific operations
 */
export interface ServerDao extends BaseDao<ServerConfigWithName, string> {
  /** Find every server with the given user-facing name. */
  findByName(name: string): Promise<ServerConfigWithName[]>;
  /**
   * Find all servers with pagination
   */
  findAllPaginated(page: number, limit: number): Promise<PaginatedResult<ServerConfigWithName>>;

  /**
   * Find servers by owner with pagination
   */
  findByOwnerPaginated(
    owner: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<ServerConfigWithName>>;

  /**
   * Find servers visible to a non-admin user with pagination.
   * Visible means owned by the user or marked public.
   */
  findVisibleToUserPaginated(
    username: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<ServerConfigWithName>>;

  /**
   * Find servers by owner
   */
  findByOwner(owner: string): Promise<ServerConfigWithName[]>;

  /**
   * Find enabled servers only
   */
  findEnabled(): Promise<ServerConfigWithName[]>;

  /**
   * Find servers by type
   */
  findByType(type: string): Promise<ServerConfigWithName[]>;

  /**
   * Enable/disable server
   */
  setEnabled(name: string, enabled: boolean): Promise<boolean>;

  /**
   * Update server tools configuration
   */
  updateTools(
    name: string,
    tools: Record<string, { enabled: boolean; description?: string }>,
  ): Promise<boolean>;

  /**
   * Update server prompts configuration
   */
  updatePrompts(
    name: string,
    prompts: Record<string, { enabled: boolean; description?: string }>,
  ): Promise<boolean>;

  /**
   * Update server resources configuration
   */
  updateResources(
    name: string,
    resources: Record<string, { enabled: boolean; description?: string }>,
  ): Promise<boolean>;

  /**
   * Rename a server (change its name/key)
   */
  rename(oldName: string, newName: string): Promise<boolean>;
}

/**
 * Server configuration with name for DAO operations
 */
export interface ServerConfigWithName extends ServerConfig {
  id: string;
  name: string;
}

/**
 * JSON file-based Server DAO implementation
 */
export class ServerDaoImpl extends JsonFileBaseDao implements ServerDao {
  private resolveIndex(servers: ServerConfigWithName[], identifier: string): number {
    const byId = servers.findIndex((server) => server.id === identifier);
    if (byId !== -1) return byId;
    const byName = servers
      .map((server, index) => ({ server, index }))
      .filter(({ server }) => server.name === identifier);
    return byName.length === 1 ? byName[0].index : -1;
  }

  protected async getAll(): Promise<ServerConfigWithName[]> {
    const settings = await this.loadSettings();
    const servers: ServerConfigWithName[] = [];

    for (const [id, storedConfig] of Object.entries(settings.mcpServers || {})) {
      const { name: storedName, ...config } = storedConfig;
      servers.push({
        id,
        name: storedName || id,
        ...config,
      });
    }

    return servers;
  }

  protected async saveAll(servers: ServerConfigWithName[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.mcpServers = {};

    for (const server of servers) {
      const { id, name, ...config } = server;
      settings.mcpServers[id] = {
        ...(id === name ? {} : { name }),
        ...config,
      };
    }

    await this.saveSettings(settings);
  }

  protected getEntityId(server: ServerConfigWithName): string {
    return server.id;
  }

  protected createEntity(_data: Omit<ServerConfigWithName, 'id'>): ServerConfigWithName {
    throw new Error('Server name must be provided');
  }

  protected updateEntity(
    existing: ServerConfigWithName,
    updates: Partial<ServerConfigWithName>,
  ): ServerConfigWithName {
    return {
      ...existing,
      ...updates,
      // Keep the existing name unless explicitly updating via rename
      name: updates.name ?? existing.name,
    };
  }

  async findAll(): Promise<ServerConfigWithName[]> {
    return this.getAll();
  }

  async findById(identifier: string): Promise<ServerConfigWithName | null> {
    const servers = await this.getAll();
    const byId = servers.find((server) => server.id === identifier);
    if (byId) return byId;
    const byName = servers.filter((server) => server.name === identifier);
    return byName.length === 1 ? byName[0] : null;
  }

  async findByName(name: string): Promise<ServerConfigWithName[]> {
    const servers = await this.getAll();
    return servers.filter((server) => server.name === name);
  }

  async create(data: Omit<ServerConfigWithName, 'id'>): Promise<ServerConfigWithName> {
    const servers = await this.getAll();

    const newServer: ServerConfigWithName = {
      id: randomUUID(),
      enabled: true, // Default to enabled
      owner: 'admin', // Default owner
      ...data,
    };

    servers.push(newServer);
    await this.saveAll(servers);

    return newServer;
  }

  async update(
    identifier: string,
    updates: Partial<ServerConfigWithName>,
  ): Promise<ServerConfigWithName | null> {
    const servers = await this.getAll();
    const index = this.resolveIndex(servers, identifier);

    if (index === -1) {
      return null;
    }

    const updatedServer = this.updateEntity(servers[index], updates);
    servers[index] = updatedServer;

    await this.saveAll(servers);
    return updatedServer;
  }

  async delete(identifier: string): Promise<boolean> {
    const servers = await this.getAll();
    const index = this.resolveIndex(servers, identifier);
    if (index === -1) {
      return false;
    }

    servers.splice(index, 1);
    await this.saveAll(servers);
    return true;
  }

  async exists(identifier: string): Promise<boolean> {
    const servers = await this.getAll();
    return servers.some((server) => server.id === identifier || server.name === identifier);
  }

  async count(): Promise<number> {
    const servers = await this.getAll();
    return servers.length;
  }

  async findAllPaginated(
    page: number,
    limit: number,
  ): Promise<PaginatedResult<ServerConfigWithName>> {
    const allServers = await this.getAll();
    // Sort: enabled servers first, then by creation time
    const sortedServers = allServers.sort((a, b) => {
      const aEnabled = a.enabled !== false;
      const bEnabled = b.enabled !== false;
      if (aEnabled !== bEnabled) {
        return aEnabled ? -1 : 1;
      }
      return 0; // Keep original order for same enabled status
    });

    const total = sortedServers.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const data = sortedServers.slice(startIndex, endIndex);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findByOwnerPaginated(
    owner: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<ServerConfigWithName>> {
    const allServers = await this.getAll();
    const filteredServers = allServers.filter((server) => server.owner === owner);
    // Sort: enabled servers first, then by creation time
    const sortedServers = filteredServers.sort((a, b) => {
      const aEnabled = a.enabled !== false;
      const bEnabled = b.enabled !== false;
      if (aEnabled !== bEnabled) {
        return aEnabled ? -1 : 1;
      }
      return 0; // Keep original order for same enabled status
    });

    const total = sortedServers.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const data = sortedServers.slice(startIndex, endIndex);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findVisibleToUserPaginated(
    username: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<ServerConfigWithName>> {
    const allServers = await this.getAll();
    const filteredServers = allServers.filter(
      (server) => server.owner === username || server.visibility === 'public',
    );
    const sortedServers = filteredServers.sort((a, b) => {
      const aEnabled = a.enabled !== false;
      const bEnabled = b.enabled !== false;
      if (aEnabled !== bEnabled) {
        return aEnabled ? -1 : 1;
      }
      return 0;
    });

    const total = sortedServers.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const data = sortedServers.slice(startIndex, endIndex);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findByOwner(owner: string): Promise<ServerConfigWithName[]> {
    const servers = await this.getAll();
    return servers.filter((server) => server.owner === owner);
  }

  async findEnabled(): Promise<ServerConfigWithName[]> {
    const servers = await this.getAll();
    return servers.filter((server) => server.enabled !== false);
  }

  async findByType(type: string): Promise<ServerConfigWithName[]> {
    const servers = await this.getAll();
    return servers.filter((server) => server.type === type);
  }

  async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    const result = await this.update(name, { enabled });
    return result !== null;
  }

  async updateTools(
    name: string,
    tools: Record<string, { enabled: boolean; description?: string }>,
  ): Promise<boolean> {
    const result = await this.update(name, { tools });
    return result !== null;
  }

  async updatePrompts(
    name: string,
    prompts: Record<string, { enabled: boolean; description?: string }>,
  ): Promise<boolean> {
    const result = await this.update(name, { prompts });
    return result !== null;
  }

  async updateResources(
    name: string,
    resources: Record<string, { enabled: boolean; description?: string }>,
  ): Promise<boolean> {
    const result = await this.update(name, { resources });
    return result !== null;
  }

  async rename(oldName: string, newName: string): Promise<boolean> {
    const servers = await this.getAll();
    const index = this.resolveIndex(servers, oldName);

    if (index === -1) {
      return false;
    }

    servers[index] = { ...servers[index], name: newName };
    await this.saveAll(servers);
    return true;
  }
}
