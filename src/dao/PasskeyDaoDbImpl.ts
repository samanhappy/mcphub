import { getAppDataSource } from '../db/connection.js';
import { Passkey } from '../db/entities/Passkey.js';
import type { UserPasskey } from '../types/index.js';
import type { PasskeyDao, PasskeyUse } from './PasskeyDao.js';

export class PasskeyDaoDbImpl implements PasskeyDao {
  private get repository() {
    return getAppDataSource().getRepository(Passkey);
  }

  async findById(id: string): Promise<UserPasskey | null> {
    return this.repository.findOneBy({ id });
  }

  async findByCredentialId(credentialId: string): Promise<UserPasskey | null> {
    return this.repository.findOneBy({ credentialId });
  }

  async findByUsername(username: string): Promise<UserPasskey[]> {
    return this.repository.find({ where: { username }, order: { createdAt: 'ASC' } });
  }

  async save(passkey: UserPasskey): Promise<void> {
    await this.repository.save(passkey);
  }

  async recordUse(id: string, use: PasskeyUse): Promise<boolean> {
    const result = await this.repository.update({ id }, use);
    return (result.affected ?? 0) > 0;
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  async deleteByUsername(username: string): Promise<void> {
    await this.repository.delete({ username });
  }
}
