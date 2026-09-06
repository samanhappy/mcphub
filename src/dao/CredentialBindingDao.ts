import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSettingsPath } from '../config/index.js';
import type { StoredCredentialBinding } from '../types/index.js';

export interface CredentialBindingDao {
  hasBindings(): Promise<boolean>;
  get(serverName: string, username: string): Promise<StoredCredentialBinding | null>;
  save(binding: StoredCredentialBinding): Promise<void>;
  delete(filter: { serverName?: string; username?: string }): Promise<void>;
}

// Kept outside settings/config exports. Only authenticated ciphertext is persisted.
export class CredentialBindingDaoImpl implements CredentialBindingDao {
  async hasBindings(): Promise<boolean> {
    return this.readAll().length > 0;
  }

  readAll(): StoredCredentialBinding[] {
    try {
      const bindings = JSON.parse(fs.readFileSync(`${getSettingsPath()}.credentials.json`, 'utf8'));
      if (!Array.isArray(bindings)) throw new Error('Invalid credential binding store');
      return bindings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private write(bindings: StoredCredentialBinding[]): void {
    const file = `${getSettingsPath()}.credentials.json`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(bindings), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  async get(serverName: string, username: string): Promise<StoredCredentialBinding | null> {
    return (
      this.readAll().find((item) => item.serverName === serverName && item.username === username) ??
      null
    );
  }

  async save(binding: StoredCredentialBinding): Promise<void> {
    const bindings = this.readAll().filter(
      (item) => item.serverName !== binding.serverName || item.username !== binding.username,
    );
    this.write([...bindings, binding]);
  }

  async delete(filter: { serverName?: string; username?: string }): Promise<void> {
    this.write(
      this.readAll().filter(
        (item) =>
          (filter.serverName !== undefined && item.serverName !== filter.serverName) ||
          (filter.username !== undefined && item.username !== filter.username),
      ),
    );
  }
}
