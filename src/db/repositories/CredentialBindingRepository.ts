import { Repository } from 'typeorm';
import { CredentialBinding } from '../entities/CredentialBinding.js';
import { getAppDataSource } from '../connection.js';
import type { EncryptedCredentialValues } from '../../types/index.js';

export class CredentialBindingRepository {
  private readonly repository: Repository<CredentialBinding>;

  constructor() {
    this.repository = getAppDataSource().getRepository(CredentialBinding);
  }

  findByServerAndUsername(serverName: string, username: string): Promise<CredentialBinding | null> {
    return this.repository.findOne({ where: { serverName, username } });
  }

  findByUsername(username: string): Promise<CredentialBinding[]> {
    return this.repository.find({ where: { username }, order: { createdAt: 'ASC' } });
  }

  async upsert(
    serverName: string,
    username: string,
    encryptedValues: EncryptedCredentialValues,
  ): Promise<CredentialBinding> {
    const existing = await this.findByServerAndUsername(serverName, username);
    const entity = existing
      ? this.repository.merge(existing, { encryptedValues })
      : this.repository.create({ serverName, username, encryptedValues });
    return this.repository.save(entity);
  }

  async delete(serverName: string, username: string): Promise<boolean> {
    const result = await this.repository.delete({ serverName, username });
    return (result.affected ?? 0) > 0;
  }

  async deleteByServer(serverName: string): Promise<number> {
    const result = await this.repository.delete({ serverName });
    return result.affected ?? 0;
  }

  async deleteByUsername(username: string): Promise<number> {
    const result = await this.repository.delete({ username });
    return result.affected ?? 0;
  }

  async renameServer(oldName: string, newName: string): Promise<number> {
    const result = await this.repository.update({ serverName: oldName }, { serverName: newName });
    return result.affected ?? 0;
  }
}

export default CredentialBindingRepository;
