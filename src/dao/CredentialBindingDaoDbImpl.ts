import { getAppDataSource } from '../db/connection.js';
import { CredentialBinding } from '../db/entities/CredentialBinding.js';
import type { StoredCredentialBinding } from '../types/index.js';
import type { CredentialBindingDao } from './CredentialBindingDao.js';

export class CredentialBindingDaoDbImpl implements CredentialBindingDao {
  private get repository() {
    return getAppDataSource().getRepository(CredentialBinding);
  }

  async get(serverName: string, username: string): Promise<StoredCredentialBinding | null> {
    return this.repository.findOneBy({ serverName, username });
  }

  async save(binding: StoredCredentialBinding): Promise<void> {
    await this.repository.upsert(binding, ['serverName', 'username']);
  }

  async delete(filter: { serverName?: string; username?: string }): Promise<void> {
    await this.repository.delete(filter);
  }
}
