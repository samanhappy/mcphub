import { randomUUID } from 'node:crypto';
import { BuiltinResource } from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

/**
 * DAO interface for built-in configuration-driven resources
 */
export interface BuiltinResourceDao {
  findAll(): Promise<BuiltinResource[]>;
  findEnabled(): Promise<BuiltinResource[]>;
  findById(id: string): Promise<BuiltinResource | null>;
  findByUri(uri: string): Promise<BuiltinResource | null>;
  create(data: Omit<BuiltinResource, 'id'>): Promise<BuiltinResource>;
  update(id: string, data: Partial<Omit<BuiltinResource, 'id'>>): Promise<BuiltinResource | null>;
  delete(id: string): Promise<boolean>;
}

/**
 * JSON file-based BuiltinResource DAO implementation
 * Stores resources under the top-level `resources` field in mcp_settings.json
 */
export class BuiltinResourceDaoImpl extends JsonFileBaseDao implements BuiltinResourceDao {
  private async loadResources(): Promise<BuiltinResource[]> {
    const settings = await this.loadSettings();
    return settings.resources || [];
  }

  private async saveResources(resources: BuiltinResource[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.resources = resources;
    await this.saveSettings(settings);
  }

  async findAll(): Promise<BuiltinResource[]> {
    return this.loadResources();
  }

  async findEnabled(): Promise<BuiltinResource[]> {
    const resources = await this.loadResources();
    return resources.filter((r) => r.enabled !== false);
  }

  async findById(id: string): Promise<BuiltinResource | null> {
    const resources = await this.loadResources();
    return resources.find((r) => r.id === id) || null;
  }

  async findByUri(uri: string): Promise<BuiltinResource | null> {
    const resources = await this.loadResources();
    return resources.find((r) => r.uri === uri) || null;
  }

  async create(data: Omit<BuiltinResource, 'id'>): Promise<BuiltinResource> {
    const resources = await this.loadResources();

    // Check for duplicate URI
    if (resources.find((r) => r.uri === data.uri)) {
      throw new Error(`Builtin resource with URI '${data.uri}' already exists`);
    }

    const newResource: BuiltinResource = {
      id: randomUUID(),
      enabled: true,
      ...data,
    };
    resources.push(newResource);
    await this.saveResources(resources);
    return newResource;
  }

  async update(
    id: string,
    data: Partial<Omit<BuiltinResource, 'id'>>,
  ): Promise<BuiltinResource | null> {
    const resources = await this.loadResources();
    const index = resources.findIndex((r) => r.id === id);
    if (index === -1) return null;

    // If URI is being changed, check for duplicates
    if (data.uri && data.uri !== resources[index].uri) {
      if (resources.find((r) => r.uri === data.uri)) {
        throw new Error(`Builtin resource with URI '${data.uri}' already exists`);
      }
    }

    resources[index] = { ...resources[index], ...data };
    await this.saveResources(resources);
    return resources[index];
  }

  async delete(id: string): Promise<boolean> {
    const resources = await this.loadResources();
    const index = resources.findIndex((r) => r.id === id);
    if (index === -1) return false;

    resources.splice(index, 1);
    await this.saveResources(resources);
    return true;
  }
}
