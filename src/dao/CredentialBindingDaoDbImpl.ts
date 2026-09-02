import type {
  CredentialBinding,
  EncryptedCredentialValues,
} from '../types/index.js';
import type { CredentialBindingDao } from './CredentialBindingDao.js';
import { CredentialBindingRepository } from '../db/repositories/CredentialBindingRepository.js';

export class CredentialBindingDaoDbImpl implements CredentialBindingDao {
  private readonly repository = new CredentialBindingRepository();

  private toModel(entity: import('../db/entities/CredentialBinding.js').CredentialBinding): CredentialBinding {
    return {
      id: entity.id,
      serverName: entity.serverName,
      username: entity.username,
      encryptedValues: entity.encryptedValues,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  async findByServerAndUsername(serverName: string, username: string): Promise<CredentialBinding | null> {
    const entity = await this.repository.findByServerAndUsername(serverName, username);
    return entity ? this.toModel(entity) : null;
  }

  async findByUsername(username: string): Promise<CredentialBinding[]> {
    return (await this.repository.findByUsername(username)).map((entity) => this.toModel(entity));
  }

  async upsert(
    serverName: string,
    username: string,
    encryptedValues: EncryptedCredentialValues,
  ): Promise<CredentialBinding> {
    return this.toModel(await this.repository.upsert(serverName, username, encryptedValues));
  }

  delete(serverName: string, username: string): Promise<boolean> {
    return this.repository.delete(serverName, username);
  }

  deleteByServer(serverName: string): Promise<number> {
    return this.repository.deleteByServer(serverName);
  }

  deleteByUsername(username: string): Promise<number> {
    return this.repository.deleteByUsername(username);
  }

  renameServer(oldName: string, newName: string): Promise<number> {
    return this.repository.renameServer(oldName, newName);
  }
}
