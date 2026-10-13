import { getAppDataSource } from '../db/connection.js';
import { CredentialBinding } from '../db/entities/CredentialBinding.js';
import type { StoredCredentialBinding } from '../types/index.js';
import type { CredentialBindingDao } from './CredentialBindingDao.js';

export class CredentialBindingDaoDbImpl implements CredentialBindingDao {
  private get repository() {
    return getAppDataSource().getRepository(CredentialBinding);
  }

  async hasBindings(): Promise<boolean> {
    return this.repository.exists();
  }

  async get(serverName: string, username: string): Promise<StoredCredentialBinding | null> {
    return this.repository.findOneBy({ serverName, username });
  }

  async listUsernames(serverName: string): Promise<string[]> {
    const rows = await this.repository.find({
      where: { serverName },
      select: { username: true },
    });
    return rows.map((row) => row.username);
  }

  async save(binding: StoredCredentialBinding): Promise<void> {
    await this.repository.upsert(binding, ['serverName', 'username']);
  }

  async compareAndSave(binding: StoredCredentialBinding, expected?: string): Promise<boolean> {
    if (expected !== undefined) {
      const result = await this.repository.update(
        { serverName: binding.serverName, username: binding.username, encryptedValues: expected },
        binding,
      );
      return result.affected === 1;
    }
    const result = await this.repository
      .createQueryBuilder()
      .insert()
      .values(binding)
      .orIgnore()
      .returning(['serverName'])
      .execute();
    return result.raw.length === 1;
  }

  async delete(filter: { serverName?: string; username?: string }): Promise<void> {
    await this.repository.delete(filter);
  }
}
