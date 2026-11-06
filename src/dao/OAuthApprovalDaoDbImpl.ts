import { getAppDataSource } from '../db/connection.js';
import { OAuthApproval } from '../db/entities/OAuthApproval.js';
import type { OAuthClientApproval } from '../types/index.js';
import type { OAuthApprovalDao } from './OAuthApprovalDao.js';

export class OAuthApprovalDaoDbImpl implements OAuthApprovalDao {
  private get repository() {
    return getAppDataSource().getRepository(OAuthApproval);
  }

  async findById(id: string): Promise<OAuthClientApproval | null> {
    return this.repository.findOneBy({ id });
  }

  async findByUsername(username: string): Promise<OAuthClientApproval[]> {
    return this.repository.findBy({ username });
  }

  async save(approval: OAuthClientApproval): Promise<void> {
    await this.repository.save(approval);
  }

  async deleteByUserAndClient(username: string, clientId: string): Promise<void> {
    await this.repository.delete({ username, clientId });
  }

  async deleteByClientId(clientId: string): Promise<void> {
    await this.repository.delete({ clientId });
  }

  async deleteByUsername(username: string): Promise<void> {
    await this.repository.delete({ username });
  }
}
