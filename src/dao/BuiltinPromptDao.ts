import { randomUUID } from 'node:crypto';
import { BuiltinPrompt } from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

/**
 * DAO interface for built-in configuration-driven prompts
 */
export interface BuiltinPromptDao {
  findAll(): Promise<BuiltinPrompt[]>;
  findEnabled(): Promise<BuiltinPrompt[]>;
  findById(id: string): Promise<BuiltinPrompt | null>;
  findByName(name: string): Promise<BuiltinPrompt | null>;
  create(data: Omit<BuiltinPrompt, 'id'>): Promise<BuiltinPrompt>;
  update(id: string, data: Partial<Omit<BuiltinPrompt, 'id'>>): Promise<BuiltinPrompt | null>;
  delete(id: string): Promise<boolean>;
}

/**
 * JSON file-based BuiltinPrompt DAO implementation
 * Stores prompts under the top-level `prompts` field in mcp_settings.json
 */
export class BuiltinPromptDaoImpl extends JsonFileBaseDao implements BuiltinPromptDao {
  private async loadPrompts(): Promise<BuiltinPrompt[]> {
    const settings = await this.loadSettings();
    return settings.prompts || [];
  }

  private async savePrompts(prompts: BuiltinPrompt[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.prompts = prompts;
    await this.saveSettings(settings);
  }

  async findAll(): Promise<BuiltinPrompt[]> {
    return this.loadPrompts();
  }

  async findEnabled(): Promise<BuiltinPrompt[]> {
    const prompts = await this.loadPrompts();
    return prompts.filter((p) => p.enabled !== false);
  }

  async findById(id: string): Promise<BuiltinPrompt | null> {
    const prompts = await this.loadPrompts();
    return prompts.find((p) => p.id === id) || null;
  }

  async findByName(name: string): Promise<BuiltinPrompt | null> {
    const prompts = await this.loadPrompts();
    return prompts.find((p) => p.name === name) || null;
  }

  async create(data: Omit<BuiltinPrompt, 'id'>): Promise<BuiltinPrompt> {
    const prompts = await this.loadPrompts();

    // Check for duplicate name
    if (prompts.find((p) => p.name === data.name)) {
      throw new Error(`Builtin prompt with name '${data.name}' already exists`);
    }

    const newPrompt: BuiltinPrompt = {
      id: randomUUID(),
      enabled: true,
      ...data,
    };
    prompts.push(newPrompt);
    await this.savePrompts(prompts);
    return newPrompt;
  }

  async update(
    id: string,
    data: Partial<Omit<BuiltinPrompt, 'id'>>,
  ): Promise<BuiltinPrompt | null> {
    const prompts = await this.loadPrompts();
    const index = prompts.findIndex((p) => p.id === id);
    if (index === -1) return null;

    // If name is being changed, check for duplicates
    if (data.name && data.name !== prompts[index].name) {
      if (prompts.find((p) => p.name === data.name)) {
        throw new Error(`Builtin prompt with name '${data.name}' already exists`);
      }
    }

    prompts[index] = { ...prompts[index], ...data };
    await this.savePrompts(prompts);
    return prompts[index];
  }

  async delete(id: string): Promise<boolean> {
    const prompts = await this.loadPrompts();
    const index = prompts.findIndex((p) => p.id === id);
    if (index === -1) return false;

    prompts.splice(index, 1);
    await this.savePrompts(prompts);
    return true;
  }
}
