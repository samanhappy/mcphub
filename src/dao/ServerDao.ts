import { ServerConfig } from '../types/index.js';
import { BaseDao } from './base/BaseDao.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

/**
 * Server DAO interface with server-specific operations
 */
export interface ServerDao extends BaseDao<ServerConfigWithName, string> {
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
}

/**
 * Server configuration with name for DAO operations
 */
export interface ServerConfigWithName extends ServerConfig {
  name: string;
}

/**
 * JSON file-based Server DAO implementation
 */
export class ServerDaoImpl extends JsonFileBaseDao implements ServerDao {
  protected async getAll(): Promise<ServerConfigWithName[]> {
    const settings = await this.loadSettings();
    const servers: ServerConfigWithName[] = [];

    for (const [name, config] of Object.entries(settings.mcpServers || {})) {
      servers.push({
        name,
        ...config,
      });
    }

    return servers;
  }

  protected async saveAll(servers: ServerConfigWithName[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.mcpServers = {};

    for (const server of servers) {
      const { name, ...config } = server;
      settings.mcpServers[name] = config;
    }

    await this.saveSettings(settings);
  }

  protected getEntityId(server: ServerConfigWithName): string {
    return server.name;
  }

  protected createEntity(_data: Omit<ServerConfigWithName, 'name'>): ServerConfigWithName {
    throw new Error('Server name must be provided');
  }

  protected updateEntity(
    existing: ServerConfigWithName,
    updates: Partial<ServerConfigWithName>,
  ): ServerConfigWithName {
    return {
      ...existing,
      ...updates,
      name: existing.name, // Name should not be updated
    };
  }

  async findAll(): Promise<ServerConfigWithName[]> {
    return this.getAll();
  }

  async findById(name: string): Promise<ServerConfigWithName | null> {
    const servers = await this.getAll();
    return servers.find((server) => server.name === name) || null;
  }

  async create(
    data: Omit<ServerConfigWithName, 'name'> & { name: string },
  ): Promise<ServerConfigWithName> {
    const servers = await this.getAll();

    // Check if server already exists
    if (servers.find((server) => server.name === data.name)) {
      throw new Error(`Server ${data.name} already exists`);
    }

    const newServer: ServerConfigWithName = {
      enabled: true, // Default to enabled
      owner: 'admin', // Default owner
      ...data,
    };

    servers.push(newServer);
    await this.saveAll(servers);

    return newServer;
  }

  async update(
    name: string,
    updates: Partial<ServerConfigWithName>,
  ): Promise<ServerConfigWithName | null> {
    const servers = await this.getAll();
    const index = servers.findIndex((server) => server.name === name);

    if (index === -1) {
      return null;
    }

    // Don't allow name changes
    const { name: _, ...allowedUpdates } = updates;
    const updatedServer = this.updateEntity(servers[index], allowedUpdates);
    servers[index] = updatedServer;

    await this.saveAll(servers);
    return updatedServer;
  }

  async delete(name: string): Promise<boolean> {
    const servers = await this.getAll();
    const index = servers.findIndex((server) => server.name === name);
    if (index === -1) {
      return false;
    }

    servers.splice(index, 1);
    await this.saveAll(servers);
    return true;
  }

  async exists(name: string): Promise<boolean> {
    const server = await this.findById(name);
    return server !== null;
  }

  async count(): Promise<number> {
    const servers = await this.getAll();
    return servers.length;
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
}
