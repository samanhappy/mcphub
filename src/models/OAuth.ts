import crypto from 'crypto';
import { getOAuthClientDao, getOAuthTokenDao } from '../dao/index.js';
import { IOAuthClient, IOAuthAuthorizationCode, IOAuthToken } from '../types/index.js';

// In-memory storage for authorization codes (short-lived, no persistence needed)
const authorizationCodes = new Map<string, IOAuthAuthorizationCode>();

// In-memory cache for tokens (also persisted via DAO)
const tokensCache = new Map<string, IOAuthToken>();

// Flag to track if we've initialized from DAO
let initialized = false;

/**
 * Initialize token cache from DAO (async)
 */
const initializeTokenCache = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;

  try {
    const tokenDao = getOAuthTokenDao();
    const allTokens = await tokenDao.findAll();
    for (const token of allTokens) {
      tokensCache.set(token.accessToken, token);
      if (token.refreshToken) {
        tokensCache.set(token.refreshToken, token);
      }
    }
  } catch (error) {
    console.error('Failed to initialize OAuth tokens from DAO:', error);
  }
};

// Initialize on module load (fire and forget for backward compatibility)
initializeTokenCache().catch(console.error);

/**
 * Get all OAuth clients from configuration
 */
export const getOAuthClients = async (): Promise<IOAuthClient[]> => {
  const clientDao = getOAuthClientDao();
  return clientDao.findAll();
};

/**
 * Find OAuth client by client ID
 */
export const findOAuthClientById = async (clientId: string): Promise<IOAuthClient | undefined> => {
  const clientDao = getOAuthClientDao();
  const client = await clientDao.findByClientId(clientId);
  return client || undefined;
};

/**
 * Create a new OAuth client
 */
export const createOAuthClient = async (client: IOAuthClient): Promise<IOAuthClient> => {
  const clientDao = getOAuthClientDao();

  // Check if client already exists
  const existing = await clientDao.findByClientId(client.clientId);
  if (existing) {
    throw new Error(`OAuth client with ID ${client.clientId} already exists`);
  }

  return clientDao.create(client);
};

/**
 * Update an existing OAuth client
 */
export const updateOAuthClient = async (
  clientId: string,
  updates: Partial<IOAuthClient>,
): Promise<IOAuthClient | null> => {
  const clientDao = getOAuthClientDao();
  return clientDao.update(clientId, updates);
};

/**
 * Delete an OAuth client
 */
export const deleteOAuthClient = async (clientId: string): Promise<boolean> => {
  const clientDao = getOAuthClientDao();
  return clientDao.delete(clientId);
};

/**
 * Generate a secure random token
 */
const generateToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Save authorization code
 */
export const saveAuthorizationCode = (
  code: Omit<IOAuthAuthorizationCode, 'code' | 'expiresAt'>,
  expiresIn: number = 300,
): string => {
  const authCode = generateToken();
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  authorizationCodes.set(authCode, {
    code: authCode,
    expiresAt,
    ...code,
  });

  return authCode;
};

/**
 * Get authorization code
 */
export const getAuthorizationCode = (code: string): IOAuthAuthorizationCode | undefined => {
  const authCode = authorizationCodes.get(code);
  if (!authCode) {
    return undefined;
  }

  // Check if expired
  if (authCode.expiresAt < new Date()) {
    authorizationCodes.delete(code);
    return undefined;
  }

  return authCode;
};

/**
 * Revoke authorization code
 */
export const revokeAuthorizationCode = (code: string): void => {
  authorizationCodes.delete(code);
};

/**
 * Save access token and optionally refresh token
 */
export const saveToken = async (
  tokenData: Omit<IOAuthToken, 'accessToken' | 'accessTokenExpiresAt'>,
  accessTokenLifetime: number = 3600,
  refreshTokenLifetime?: number,
): Promise<IOAuthToken> => {
  const accessToken = generateToken();
  const accessTokenExpiresAt = new Date(Date.now() + accessTokenLifetime * 1000);

  let refreshToken: string | undefined;
  let refreshTokenExpiresAt: Date | undefined;

  if (refreshTokenLifetime) {
    refreshToken = generateToken();
    refreshTokenExpiresAt = new Date(Date.now() + refreshTokenLifetime * 1000);
  }

  const token: IOAuthToken = {
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt,
    ...tokenData,
  };

  // Update cache
  tokensCache.set(accessToken, token);
  if (refreshToken) {
    tokensCache.set(refreshToken, token);
  }

  // Persist to DAO
  try {
    const tokenDao = getOAuthTokenDao();
    await tokenDao.create(token);
  } catch (error) {
    console.error('Failed to persist OAuth token to DAO:', error);
  }

  return token;
};

/**
 * Get token by access token or refresh token
 */
export const getToken = async (token: string): Promise<IOAuthToken | undefined> => {
  // First check cache
  let tokenData = tokensCache.get(token);

  // If not in cache, try DAO
  if (!tokenData) {
    const tokenDao = getOAuthTokenDao();
    tokenData =
      (await tokenDao.findByAccessToken(token)) ||
      (await tokenDao.findByRefreshToken(token)) ||
      undefined;

    // Update cache if found
    if (tokenData) {
      tokensCache.set(tokenData.accessToken, tokenData);
      if (tokenData.refreshToken) {
        tokensCache.set(tokenData.refreshToken, tokenData);
      }
    }
  }

  if (!tokenData) {
    return undefined;
  }

  // Check if access token is expired
  if (tokenData.accessToken === token && tokenData.accessTokenExpiresAt < new Date()) {
    return undefined;
  }

  // Check if refresh token is expired
  if (
    tokenData.refreshToken === token &&
    tokenData.refreshTokenExpiresAt &&
    tokenData.refreshTokenExpiresAt < new Date()
  ) {
    return undefined;
  }

  return tokenData;
};

/**
 * Revoke token (both access and refresh tokens)
 */
export const revokeToken = async (token: string): Promise<void> => {
  const tokenData = tokensCache.get(token);
  if (tokenData) {
    tokensCache.delete(tokenData.accessToken);
    if (tokenData.refreshToken) {
      tokensCache.delete(tokenData.refreshToken);
    }
  }

  // Also remove from DAO
  try {
    const tokenDao = getOAuthTokenDao();
    await tokenDao.revokeToken(token);
  } catch (error) {
    console.error('Failed to remove OAuth token from DAO:', error);
  }
};

/**
 * Clean up expired codes and tokens (should be called periodically)
 */
export const cleanupExpired = async (): Promise<void> => {
  const now = new Date();

  // Clean up expired authorization codes
  for (const [code, authCode] of authorizationCodes.entries()) {
    if (authCode.expiresAt < now) {
      authorizationCodes.delete(code);
    }
  }

  // Clean up expired tokens from cache
  const processedTokens = new Set<string>();
  for (const [_key, token] of tokensCache.entries()) {
    // Skip if we've already processed this token
    if (processedTokens.has(token.accessToken)) {
      continue;
    }
    processedTokens.add(token.accessToken);

    const accessExpired = token.accessTokenExpiresAt < now;
    const refreshExpired = token.refreshTokenExpiresAt && token.refreshTokenExpiresAt < now;

    // If both are expired, remove from cache
    if (accessExpired && (!token.refreshToken || refreshExpired)) {
      tokensCache.delete(token.accessToken);
      if (token.refreshToken) {
        tokensCache.delete(token.refreshToken);
      }
    }
  }

  // Clean up expired tokens from DAO
  try {
    const tokenDao = getOAuthTokenDao();
    await tokenDao.cleanupExpired();
  } catch (error) {
    console.error('Failed to cleanup persisted OAuth tokens:', error);
  }
};

// Run cleanup every 5 minutes in production
let cleanupIntervalId: NodeJS.Timeout | null = null;
if (process.env.NODE_ENV !== 'test') {
  cleanupIntervalId = setInterval(
    () => {
      cleanupExpired().catch(console.error);
    },
    5 * 60 * 1000,
  );
  // Allow the interval to not keep the process alive
  cleanupIntervalId.unref();
}

/**
 * Stop the cleanup interval (for graceful shutdown)
 */
export const stopCleanup = (): void => {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
};
