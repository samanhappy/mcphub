import { Repository, MoreThan } from 'typeorm';
import { OAuthToken } from '../entities/OAuthToken.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for OAuthToken entity
 */
export class OAuthTokenRepository {
  private repository: Repository<OAuthToken>;

  constructor() {
    this.repository = getAppDataSource().getRepository(OAuthToken);
  }

  /**
   * Find all OAuth tokens
   */
  async findAll(): Promise<OAuthToken[]> {
    return await this.repository.find();
  }

  /**
   * Find OAuth token by access token
   */
  async findByAccessToken(accessToken: string): Promise<OAuthToken | null> {
    return await this.repository.findOne({ where: { accessToken } });
  }

  /**
   * Find OAuth token by refresh token
   */
  async findByRefreshToken(refreshToken: string): Promise<OAuthToken | null> {
    return await this.repository.findOne({ where: { refreshToken } });
  }

  /**
   * Find OAuth tokens by client ID
   */
  async findByClientId(clientId: string): Promise<OAuthToken[]> {
    return await this.repository.find({ where: { clientId } });
  }

  /**
   * Find OAuth tokens by username
   */
  async findByUsername(username: string): Promise<OAuthToken[]> {
    return await this.repository.find({ where: { username } });
  }

  /**
   * Create a new OAuth token
   */
  async create(token: Omit<OAuthToken, 'id' | 'createdAt' | 'updatedAt'>): Promise<OAuthToken> {
    // Remove any existing tokens with the same access token or refresh token
    if (token.accessToken) {
      await this.repository.delete({ accessToken: token.accessToken });
    }
    if (token.refreshToken) {
      await this.repository.delete({ refreshToken: token.refreshToken });
    }

    const newToken = this.repository.create(token);
    return await this.repository.save(newToken);
  }

  /**
   * Update an existing OAuth token
   */
  async update(accessToken: string, tokenData: Partial<OAuthToken>): Promise<OAuthToken | null> {
    const token = await this.findByAccessToken(accessToken);
    if (!token) {
      return null;
    }
    const updated = this.repository.merge(token, tokenData);
    return await this.repository.save(updated);
  }

  /**
   * Delete an OAuth token by access token
   */
  async delete(accessToken: string): Promise<boolean> {
    const result = await this.repository.delete({ accessToken });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Check if OAuth token exists by access token
   */
  async exists(accessToken: string): Promise<boolean> {
    const count = await this.repository.count({ where: { accessToken } });
    return count > 0;
  }

  /**
   * Count total OAuth tokens
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Revoke token by access token or refresh token
   */
  async revokeToken(token: string): Promise<boolean> {
    // Try to find by access token first
    let tokenEntity = await this.findByAccessToken(token);
    if (!tokenEntity) {
      // Try to find by refresh token
      tokenEntity = await this.findByRefreshToken(token);
    }

    if (!tokenEntity) {
      return false;
    }

    const result = await this.repository.delete({ id: tokenEntity.id });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeUserTokens(username: string): Promise<number> {
    const result = await this.repository.delete({ username });
    return result.affected ?? 0;
  }

  /**
   * Revoke all tokens for a client
   */
  async revokeClientTokens(clientId: string): Promise<number> {
    const result = await this.repository.delete({ clientId });
    return result.affected ?? 0;
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpired(): Promise<number> {
    const now = new Date();

    // Delete tokens where both access token and refresh token are expired
    // (or refresh token doesn't exist)
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(OAuthToken)
      .where('access_token_expires_at < :now', { now })
      .andWhere('(refresh_token_expires_at IS NULL OR refresh_token_expires_at < :now)', { now })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Check if access token is valid (exists and not expired)
   */
  async isAccessTokenValid(accessToken: string): Promise<boolean> {
    const count = await this.repository.count({
      where: {
        accessToken,
        accessTokenExpiresAt: MoreThan(new Date()),
      },
    });
    return count > 0;
  }

  /**
   * Check if refresh token is valid (exists and not expired)
   */
  async isRefreshTokenValid(refreshToken: string): Promise<boolean> {
    const token = await this.findByRefreshToken(refreshToken);
    if (!token) {
      return false;
    }
    if (!token.refreshTokenExpiresAt) {
      return true; // No expiration means always valid
    }
    return token.refreshTokenExpiresAt > new Date();
  }
}

export default OAuthTokenRepository;
