import { OAuthTokenDao } from './OAuthTokenDao.js';
import { OAuthTokenRepository } from '../db/repositories/OAuthTokenRepository.js';
import { IOAuthToken } from '../types/index.js';

/**
 * Database-backed implementation of OAuthTokenDao
 */
export class OAuthTokenDaoDbImpl implements OAuthTokenDao {
  private repository: OAuthTokenRepository;

  constructor() {
    this.repository = new OAuthTokenRepository();
  }

  async findAll(): Promise<IOAuthToken[]> {
    const tokens = await this.repository.findAll();
    return tokens.map((t) => this.mapToOAuthToken(t));
  }

  async findById(accessToken: string): Promise<IOAuthToken | null> {
    const token = await this.repository.findByAccessToken(accessToken);
    return token ? this.mapToOAuthToken(token) : null;
  }

  async findByAccessToken(accessToken: string): Promise<IOAuthToken | null> {
    return this.findById(accessToken);
  }

  async findByRefreshToken(refreshToken: string): Promise<IOAuthToken | null> {
    const token = await this.repository.findByRefreshToken(refreshToken);
    return token ? this.mapToOAuthToken(token) : null;
  }

  async findByClientId(clientId: string): Promise<IOAuthToken[]> {
    const tokens = await this.repository.findByClientId(clientId);
    return tokens.map((t) => this.mapToOAuthToken(t));
  }

  async findByUsername(username: string): Promise<IOAuthToken[]> {
    const tokens = await this.repository.findByUsername(username);
    return tokens.map((t) => this.mapToOAuthToken(t));
  }

  async create(entity: IOAuthToken): Promise<IOAuthToken> {
    const token = await this.repository.create({
      accessToken: entity.accessToken,
      accessTokenExpiresAt: entity.accessTokenExpiresAt,
      refreshToken: entity.refreshToken,
      refreshTokenExpiresAt: entity.refreshTokenExpiresAt,
      scope: entity.scope,
      clientId: entity.clientId,
      username: entity.username,
    });
    return this.mapToOAuthToken(token);
  }

  async update(accessToken: string, entity: Partial<IOAuthToken>): Promise<IOAuthToken | null> {
    const token = await this.repository.update(accessToken, {
      accessTokenExpiresAt: entity.accessTokenExpiresAt,
      refreshToken: entity.refreshToken,
      refreshTokenExpiresAt: entity.refreshTokenExpiresAt,
      scope: entity.scope,
    });
    return token ? this.mapToOAuthToken(token) : null;
  }

  async delete(accessToken: string): Promise<boolean> {
    return await this.repository.delete(accessToken);
  }

  async exists(accessToken: string): Promise<boolean> {
    return await this.repository.exists(accessToken);
  }

  async count(): Promise<number> {
    return await this.repository.count();
  }

  async revokeToken(token: string): Promise<boolean> {
    return await this.repository.revokeToken(token);
  }

  async revokeUserTokens(username: string): Promise<number> {
    return await this.repository.revokeUserTokens(username);
  }

  async revokeClientTokens(clientId: string): Promise<number> {
    return await this.repository.revokeClientTokens(clientId);
  }

  async cleanupExpired(): Promise<number> {
    return await this.repository.cleanupExpired();
  }

  async isAccessTokenValid(accessToken: string): Promise<boolean> {
    return await this.repository.isAccessTokenValid(accessToken);
  }

  async isRefreshTokenValid(refreshToken: string): Promise<boolean> {
    return await this.repository.isRefreshTokenValid(refreshToken);
  }

  private mapToOAuthToken(token: {
    accessToken: string;
    accessTokenExpiresAt: Date;
    refreshToken?: string;
    refreshTokenExpiresAt?: Date;
    scope?: string;
    clientId: string;
    username: string;
  }): IOAuthToken {
    return {
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      scope: token.scope,
      clientId: token.clientId,
      username: token.username,
    };
  }
}
