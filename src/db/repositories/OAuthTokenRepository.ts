import { Repository, MoreThan } from 'typeorm';
import { OAuthToken } from '../entities/OAuthToken.js';
import { getAppDataSource } from '../connection.js';
import { withDbRetry, RetryOptions } from '../../utils/dbRetry.js';

// Default retry options
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Repository for OAuthToken entity with automatic retry logic
 */
export class OAuthTokenRepository {
  private repository: Repository<OAuthToken>;
  private retryOptions: RetryOptions;

  constructor(retryOptions?: RetryOptions) {
    this.repository = getAppDataSource().getRepository(OAuthToken);
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  }

  /**
   * Execute an operation with retry logic
   */
  private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    return withDbRetry(operation, {
      ...this.retryOptions,
      operationName: `OAuthTokenRepository.${operationName}`,
    });
  }

  /**
   * Find all OAuth tokens
   */
  async findAll(): Promise<OAuthToken[]> {
    return this.withRetry(() => this.repository.find(), 'findAll');
  }

  /**
   * Find OAuth token by access token
   */
  async findByAccessToken(accessToken: string): Promise<OAuthToken | null> {
    return this.withRetry(
      () => this.repository.findOne({ where: { accessToken } }),
      'findByAccessToken',
    );
  }

  /**
   * Find OAuth token by refresh token
   */
  async findByRefreshToken(refreshToken: string): Promise<OAuthToken | null> {
    return this.withRetry(
      () => this.repository.findOne({ where: { refreshToken } }),
      'findByRefreshToken',
    );
  }

  /**
   * Find OAuth tokens by client ID
   */
  async findByClientId(clientId: string): Promise<OAuthToken[]> {
    return this.withRetry(() => this.repository.find({ where: { clientId } }), 'findByClientId');
  }

  /**
   * Find OAuth tokens by username
   */
  async findByUsername(username: string): Promise<OAuthToken[]> {
    return this.withRetry(() => this.repository.find({ where: { username } }), 'findByUsername');
  }

  /**
   * Create a new OAuth token
   */
  async create(token: Omit<OAuthToken, 'id' | 'createdAt' | 'updatedAt'>): Promise<OAuthToken> {
    return this.withRetry(async () => {
      // Remove any existing tokens with the same access token or refresh token
      if (token.accessToken) {
        await this.repository.delete({ accessToken: token.accessToken });
      }
      if (token.refreshToken) {
        await this.repository.delete({ refreshToken: token.refreshToken });
      }

      const newToken = this.repository.create(token);
      return await this.repository.save(newToken);
    }, 'create');
  }

  /**
   * Update an existing OAuth token
   */
  async update(accessToken: string, tokenData: Partial<OAuthToken>): Promise<OAuthToken | null> {
    return this.withRetry(async () => {
      const token = await this.repository.findOne({ where: { accessToken } });
      if (!token) {
        return null;
      }
      const updated = this.repository.merge(token, tokenData);
      return await this.repository.save(updated);
    }, 'update');
  }

  /**
   * Delete an OAuth token by access token
   */
  async delete(accessToken: string): Promise<boolean> {
    return this.withRetry(async () => {
      const result = await this.repository.delete({ accessToken });
      return (result.affected ?? 0) > 0;
    }, 'delete');
  }

  /**
   * Check if OAuth token exists by access token
   */
  async exists(accessToken: string): Promise<boolean> {
    return this.withRetry(async () => {
      const count = await this.repository.count({ where: { accessToken } });
      return count > 0;
    }, 'exists');
  }

  /**
   * Count total OAuth tokens
   */
  async count(): Promise<number> {
    return this.withRetry(() => this.repository.count(), 'count');
  }

  /**
   * Revoke token by access token or refresh token
   */
  async revokeToken(token: string): Promise<boolean> {
    return this.withRetry(async () => {
      // Try to find by access token first
      let tokenEntity = await this.repository.findOne({ where: { accessToken: token } });
      if (!tokenEntity) {
        // Try to find by refresh token
        tokenEntity = await this.repository.findOne({ where: { refreshToken: token } });
      }

      if (!tokenEntity) {
        return false;
      }

      const result = await this.repository.delete({ id: tokenEntity.id });
      return (result.affected ?? 0) > 0;
    }, 'revokeToken');
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeUserTokens(username: string): Promise<number> {
    return this.withRetry(async () => {
      const result = await this.repository.delete({ username });
      return result.affected ?? 0;
    }, 'revokeUserTokens');
  }

  /**
   * Revoke all tokens for a client
   */
  async revokeClientTokens(clientId: string): Promise<number> {
    return this.withRetry(async () => {
      const result = await this.repository.delete({ clientId });
      return result.affected ?? 0;
    }, 'revokeClientTokens');
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpired(): Promise<number> {
    return this.withRetry(async () => {
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
    }, 'cleanupExpired');
  }

  /**
   * Check if access token is valid (exists and not expired)
   */
  async isAccessTokenValid(accessToken: string): Promise<boolean> {
    return this.withRetry(async () => {
      const count = await this.repository.count({
        where: {
          accessToken,
          accessTokenExpiresAt: MoreThan(new Date()),
        },
      });
      return count > 0;
    }, 'isAccessTokenValid');
  }

  /**
   * Check if refresh token is valid (exists and not expired)
   */
  async isRefreshTokenValid(refreshToken: string): Promise<boolean> {
    return this.withRetry(async () => {
      const token = await this.repository.findOne({ where: { refreshToken } });
      if (!token) {
        return false;
      }
      if (!token.refreshTokenExpiresAt) {
        return true; // No expiration means always valid
      }
      return token.refreshTokenExpiresAt > new Date();
    }, 'isRefreshTokenValid');
  }
}

export default OAuthTokenRepository;
