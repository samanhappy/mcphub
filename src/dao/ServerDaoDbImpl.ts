import { ServerDao, ServerConfigWithName, PaginatedResult } from './index.js';
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

  async findAllPaginated(
    page: number,
    limit: number,
  ): Promise<PaginatedResult<ServerConfigWithName>> {
    const { data, total } = await this.repository.findAllPaginated(page, limit);
    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((s) => this.mapToServerConfig(s)),
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
    const { data, total } = await this.repository.findByOwnerPaginated(owner, page, limit);
    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((s) => this.mapToServerConfig(s)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findById(name: string): Promise<ServerConfigWithName | null> {
    const server = await this.repository.findByName(name);
    return server ? this.mapToServerConfig(server) : null;
  }

  async create(entity: ServerConfigWithName): Promise<ServerConfigWithName> {
    const server = await this.repository.create({
      name: entity.name,
      type: entity.type,
      description: entity.description,
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
      resources: entity.resources,
      options: entity.options,
      oauth: entity.oauth,
      proxy: entity.proxy,
      openapi: entity.openapi,
      passthroughHeaders: entity.passthroughHeaders,
    });
    return this.mapToServerConfig(server);
  }

  async update(
    name: string,
    entity: Partial<ServerConfigWithName>,
  ): Promise<ServerConfigWithName | null> {
    const updateData: Record<string, unknown> = {};
    const hasOwn = <K extends keyof ServerConfigWithName>(key: K) =>
      Object.prototype.hasOwnProperty.call(entity, key);

    const assignNullable = <K extends keyof ServerConfigWithName>(key: K) => {
      if (!hasOwn(key)) {
        return;
      }

      updateData[key] = entity[key] === undefined ? null : entity[key];
    };

    const assign = <K extends keyof ServerConfigWithName>(key: K) => {
      if (!hasOwn(key)) {
        return;
      }

      updateData[key] = entity[key];
    };

    assignNullable('type');
    assignNullable('description');
    assignNullable('url');
    assignNullable('command');
    assignNullable('args');
    assignNullable('env');
    assignNullable('headers');
    assign('enabled');
    assignNullable('owner');
    if (hasOwn('enableKeepAlive')) {
      updateData.enableKeepAlive = entity.enableKeepAlive ?? false;
    }
    assignNullable('keepAliveInterval');
    assignNullable('tools');
    assignNullable('prompts');
    assignNullable('resources');
    assignNullable('options');
    assignNullable('oauth');
    assignNullable('proxy');
    assignNullable('openapi');
    assignNullable('passthroughHeaders');

    const server = await this.repository.update(name, updateData as any);
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

  async updateResources(
    name: string,
    resources: Record<string, { enabled: boolean; description?: string }>,
  ): Promise<boolean> {
    const result = await this.update(name, { resources });
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
    description?: string;
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
    resources?: Record<string, { enabled: boolean; description?: string }>;
    options?: Record<string, any>;
    oauth?: Record<string, any>;
    proxy?: Record<string, any>;
    openapi?: Record<string, any>;
    passthroughHeaders?: string[];
  }): ServerConfigWithName {
    return {
      name: server.name,
      type: server.type as 'stdio' | 'sse' | 'streamable-http' | 'openapi' | undefined,
      description: server.description,
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
      resources: server.resources,
      options: server.options,
      oauth: server.oauth,
      proxy: server.proxy,
      openapi: server.openapi,
      passthroughHeaders: server.passthroughHeaders,
    };
  }
}
