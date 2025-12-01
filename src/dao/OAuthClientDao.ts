import { IOAuthClient } from '../types/index.js';
import { BaseDao } from './base/BaseDao.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';

/**
 * OAuth Client DAO interface with OAuth client-specific operations
 */
export interface OAuthClientDao extends BaseDao<IOAuthClient, string> {
  /**
   * Find OAuth client by client ID
   */
  findByClientId(clientId: string): Promise<IOAuthClient | null>;

  /**
   * Find OAuth clients by owner
   */
  findByOwner(owner: string): Promise<IOAuthClient[]>;

  /**
   * Validate client credentials
   */
  validateCredentials(clientId: string, clientSecret?: string): Promise<boolean>;
}

/**
 * JSON file-based OAuth Client DAO implementation
 */
export class OAuthClientDaoImpl extends JsonFileBaseDao implements OAuthClientDao {
  protected async getAll(): Promise<IOAuthClient[]> {
    const settings = await this.loadSettings();
    return settings.oauthClients || [];
  }

  protected async saveAll(clients: IOAuthClient[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.oauthClients = clients;
    await this.saveSettings(settings);
  }

  protected getEntityId(client: IOAuthClient): string {
    return client.clientId;
  }

  protected createEntity(_data: Omit<IOAuthClient, 'clientId'>): IOAuthClient {
    throw new Error('clientId must be provided');
  }

  protected updateEntity(existing: IOAuthClient, updates: Partial<IOAuthClient>): IOAuthClient {
    return {
      ...existing,
      ...updates,
      clientId: existing.clientId, // clientId should not be updated
    };
  }

  async findAll(): Promise<IOAuthClient[]> {
    return this.getAll();
  }

  async findById(clientId: string): Promise<IOAuthClient | null> {
    return this.findByClientId(clientId);
  }

  async findByClientId(clientId: string): Promise<IOAuthClient | null> {
    const clients = await this.getAll();
    return clients.find((client) => client.clientId === clientId) || null;
  }

  async findByOwner(owner: string): Promise<IOAuthClient[]> {
    const clients = await this.getAll();
    return clients.filter((client) => client.owner === owner);
  }

  async create(data: IOAuthClient): Promise<IOAuthClient> {
    const clients = await this.getAll();

    // Check if client already exists
    if (clients.find((client) => client.clientId === data.clientId)) {
      throw new Error(`OAuth client ${data.clientId} already exists`);
    }

    const newClient: IOAuthClient = {
      ...data,
      owner: data.owner || 'admin',
    };

    clients.push(newClient);
    await this.saveAll(clients);

    return newClient;
  }

  async update(clientId: string, updates: Partial<IOAuthClient>): Promise<IOAuthClient | null> {
    const clients = await this.getAll();
    const index = clients.findIndex((client) => client.clientId === clientId);

    if (index === -1) {
      return null;
    }

    // Don't allow clientId changes
    const { clientId: _, ...allowedUpdates } = updates;
    const updatedClient = this.updateEntity(clients[index], allowedUpdates);
    clients[index] = updatedClient;

    await this.saveAll(clients);
    return updatedClient;
  }

  async delete(clientId: string): Promise<boolean> {
    const clients = await this.getAll();
    const index = clients.findIndex((client) => client.clientId === clientId);
    if (index === -1) {
      return false;
    }

    clients.splice(index, 1);
    await this.saveAll(clients);
    return true;
  }

  async exists(clientId: string): Promise<boolean> {
    const client = await this.findByClientId(clientId);
    return client !== null;
  }

  async count(): Promise<number> {
    const clients = await this.getAll();
    return clients.length;
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
}
