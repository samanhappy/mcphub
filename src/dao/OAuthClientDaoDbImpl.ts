import { OAuthClientDao } from './OAuthClientDao.js';
import { OAuthClientRepository } from '../db/repositories/OAuthClientRepository.js';
import { IOAuthClient } from '../types/index.js';

/**
 * Database-backed implementation of OAuthClientDao
 */
export class OAuthClientDaoDbImpl implements OAuthClientDao {
  private repository: OAuthClientRepository;

  constructor() {
    this.repository = new OAuthClientRepository();
  }

  async findAll(): Promise<IOAuthClient[]> {
    const clients = await this.repository.findAll();
    return clients.map((c) => this.mapToOAuthClient(c));
  }

  async findById(clientId: string): Promise<IOAuthClient | null> {
    const client = await this.repository.findByClientId(clientId);
    return client ? this.mapToOAuthClient(client) : null;
  }

  async findByClientId(clientId: string): Promise<IOAuthClient | null> {
    return this.findById(clientId);
  }

  async findByOwner(owner: string): Promise<IOAuthClient[]> {
    const clients = await this.repository.findByOwner(owner);
    return clients.map((c) => this.mapToOAuthClient(c));
  }

  async create(entity: IOAuthClient): Promise<IOAuthClient> {
    const client = await this.repository.create({
      clientId: entity.clientId,
      clientSecret: entity.clientSecret,
      name: entity.name,
      redirectUris: entity.redirectUris,
      grants: entity.grants,
      scopes: entity.scopes,
      owner: entity.owner || 'admin',
      metadata: entity.metadata,
    });
    return this.mapToOAuthClient(client);
  }

  async update(clientId: string, entity: Partial<IOAuthClient>): Promise<IOAuthClient | null> {
    const client = await this.repository.update(clientId, {
      clientSecret: entity.clientSecret,
      name: entity.name,
      redirectUris: entity.redirectUris,
      grants: entity.grants,
      scopes: entity.scopes,
      owner: entity.owner,
      metadata: entity.metadata,
    });
    return client ? this.mapToOAuthClient(client) : null;
  }

  async delete(clientId: string): Promise<boolean> {
    return await this.repository.delete(clientId);
  }

  async exists(clientId: string): Promise<boolean> {
    return await this.repository.exists(clientId);
  }

  async count(): Promise<number> {
    return await this.repository.count();
  }

  async validateCredentials(clientId: string, clientSecret?: string): Promise<boolean> {
    const client = await this.findByClientId(clientId);
    if (!client) {
      return false;
    }

    // If client has no secret (public client), accept if no secret provided
    if (!client.clientSecret) {
      return !clientSecret;
    }

    // If client has a secret, it must match
    return client.clientSecret === clientSecret;
  }

  private mapToOAuthClient(client: {
    clientId: string;
    clientSecret?: string;
    name: string;
    redirectUris: string[];
    grants: string[];
    scopes?: string[];
    owner?: string;
    metadata?: Record<string, any>;
  }): IOAuthClient {
    return {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      name: client.name,
      redirectUris: client.redirectUris,
      grants: client.grants,
      scopes: client.scopes,
      owner: client.owner,
      metadata: client.metadata as IOAuthClient['metadata'],
    };
  }
}
