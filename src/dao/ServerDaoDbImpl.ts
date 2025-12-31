import { ServerDao, ServerConfigWithName } from './index.js';
import { ServerRepository } from '../db/repositories/ServerRepository.js';

/**
 * Database-backed implementation of ServerDao
 */
export class ServerDaoDbImpl implements ServerDao {
  private repository: ServerRepository;

  constructor() {
    this.repository = new ServerRepository();
  }

  async findAll(): Promise<ServerConfigWithName[]> {
    const servers = await this.repository.findAll();
    return servers.map((s) => this.mapToServerConfig(s));
  }

  async findById(name: string): Promise<ServerConfigWithName | null> {
    const server = await this.repository.findByName(name);
    return server ? this.mapToServerConfig(server) : null;
  }

  async create(entity: ServerConfigWithName): Promise<ServerConfigWithName> {
    const server = await this.repository.create({
      name: entity.name,
      type: entity.type,
      url: entity.url,
      command: entity.command,
      args: entity.args,
      env: entity.env,
      headers: entity.headers,
      enabled: entity.enabled !== undefined ? entity.enabled : true,
      owner: entity.owner,
      enableKeepAlive: entity.enableKeepAlive,
      keepAliveInterval: entity.keepAliveInterval,
      tools: entity.tools,
      prompts: entity.prompts,
      options: entity.options,
      oauth: entity.oauth,
      proxy: entity.proxy,
      openapi: entity.openapi,
    });
    return this.mapToServerConfig(server);
  }

  async update(
    name: string,
    entity: Partial<ServerConfigWithName>,
  ): Promise<ServerConfigWithName | null> {
    const server = await this.repository.update(name, {
      type: entity.type,
      url: entity.url,
      command: entity.command,
      args: entity.args,
      env: entity.env,
      headers: entity.headers,
      enabled: entity.enabled,
      owner: entity.owner,
      enableKeepAlive: entity.enableKeepAlive,
      keepAliveInterval: entity.keepAliveInterval,
      tools: entity.tools,
      prompts: entity.prompts,
      options: entity.options,
      oauth: entity.oauth,
      proxy: entity.proxy,
      openapi: entity.openapi,
    });
    return server ? this.mapToServerConfig(server) : null;
  }

  async delete(name: string): Promise<boolean> {
    return await this.repository.delete(name);
  }

  async exists(name: string): Promise<boolean> {
    return await this.repository.exists(name);
  }

  async count(): Promise<number> {
    return await this.repository.count();
  }

  async findByOwner(owner: string): Promise<ServerConfigWithName[]> {
    const servers = await this.repository.findByOwner(owner);
    return servers.map((s) => this.mapToServerConfig(s));
  }

  async findEnabled(): Promise<ServerConfigWithName[]> {
    const servers = await this.repository.findEnabled();
    return servers.map((s) => this.mapToServerConfig(s));
  }

  async findByType(type: string): Promise<ServerConfigWithName[]> {
    const allServers = await this.repository.findAll();
    return allServers.filter((s) => s.type === type).map((s) => this.mapToServerConfig(s));
  }

  async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    const server = await this.repository.setEnabled(name, enabled);
    return server !== null;
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

  async rename(oldName: string, newName: string): Promise<boolean> {
    // Check if newName already exists
    if (await this.repository.exists(newName)) {
      throw new Error(`Server ${newName} already exists`);
    }

    return await this.repository.rename(oldName, newName);
  }

  private mapToServerConfig(server: {
    name: string;
    type?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    enabled: boolean;
    owner?: string;
    enableKeepAlive?: boolean;
    keepAliveInterval?: number;
    tools?: Record<string, { enabled: boolean; description?: string }>;
    prompts?: Record<string, { enabled: boolean; description?: string }>;
    options?: Record<string, any>;
    oauth?: Record<string, any>;
    proxy?: Record<string, any>;
    openapi?: Record<string, any>;
  }): ServerConfigWithName {
    return {
      name: server.name,
      type: server.type as 'stdio' | 'sse' | 'streamable-http' | 'openapi' | undefined,
      url: server.url,
      command: server.command,
      args: server.args,
      env: server.env,
      headers: server.headers,
      enabled: server.enabled,
      owner: server.owner,
      enableKeepAlive: server.enableKeepAlive,
      keepAliveInterval: server.keepAliveInterval,
      tools: server.tools,
      prompts: server.prompts,
      options: server.options,
      oauth: server.oauth,
      proxy: server.proxy,
      openapi: server.openapi,
    };
  }
}
