import { randomUUID } from 'node:crypto';
import type {
  CredentialBinding,
  EncryptedCredentialValues,
} from '../types/index.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

export interface CredentialBindingDao {
  findByServerAndUsername(serverName: string, username: string): Promise<CredentialBinding | null>;
  findByUsername(username: string): Promise<CredentialBinding[]>;
  upsert(
    serverName: string,
    username: string,
    encryptedValues: EncryptedCredentialValues,
  ): Promise<CredentialBinding>;
  delete(serverName: string, username: string): Promise<boolean>;
  deleteByServer(serverName: string): Promise<number>;
  deleteByUsername(username: string): Promise<number>;
  renameServer(oldName: string, newName: string): Promise<number>;
}

export class CredentialBindingDaoImpl
  extends JsonFileBaseDao
  implements CredentialBindingDao
{
  private async loadBindings(): Promise<CredentialBinding[]> {
    const settings = await this.loadSettings();
    return Array.isArray(settings.credentialBindings) ? settings.credentialBindings : [];
  }

  private async saveBindings(bindings: CredentialBinding[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.credentialBindings = bindings;
    await this.saveSettings(settings);
  }

  async findByServerAndUsername(
    serverName: string,
    username: string,
  ): Promise<CredentialBinding | null> {
    const bindings = await this.loadBindings();
    return (
      bindings.find(
        (binding) => binding.serverName === serverName && binding.username === username,
      ) ?? null
    );
  }

  async findByUsername(username: string): Promise<CredentialBinding[]> {
    const bindings = await this.loadBindings();
    return bindings.filter((binding) => binding.username === username);
  }

  async upsert(
    serverName: string,
    username: string,
    encryptedValues: EncryptedCredentialValues,
  ): Promise<CredentialBinding> {
    const bindings = await this.loadBindings();
    const index = bindings.findIndex(
      (binding) => binding.serverName === serverName && binding.username === username,
    );
    const now = new Date().toISOString();
    const existing = index >= 0 ? bindings[index] : undefined;
    const binding: CredentialBinding = {
      id: existing?.id ?? randomUUID(),
      serverName,
      username,
      encryptedValues,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (index >= 0) bindings[index] = binding;
    else bindings.push(binding);
    await this.saveBindings(bindings);
    return binding;
  }

  async delete(serverName: string, username: string): Promise<boolean> {
    const bindings = await this.loadBindings();
    const next = bindings.filter(
      (binding) => binding.serverName !== serverName || binding.username !== username,
    );
    if (next.length === bindings.length) return false;
    await this.saveBindings(next);
    return true;
  }

  async deleteByServer(serverName: string): Promise<number> {
    return this.deleteMatching((binding) => binding.serverName === serverName);
  }

  async deleteByUsername(username: string): Promise<number> {
    return this.deleteMatching((binding) => binding.username === username);
  }

  async renameServer(oldName: string, newName: string): Promise<number> {
    const bindings = await this.loadBindings();
    let updated = 0;
    for (const binding of bindings) {
      if (binding.serverName === oldName) {
        binding.serverName = newName;
        binding.updatedAt = new Date().toISOString();
        updated += 1;
      }
    }
    if (updated > 0) await this.saveBindings(bindings);
    return updated;
  }

  private async deleteMatching(predicate: (binding: CredentialBinding) => boolean): Promise<number> {
    const bindings = await this.loadBindings();
    const next = bindings.filter((binding) => !predicate(binding));
    const deleted = bindings.length - next.length;
    if (deleted > 0) await this.saveBindings(next);
    return deleted;
  }
}
