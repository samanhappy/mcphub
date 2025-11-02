import crypto from 'crypto';
import { loadSettings, saveSettings } from '../config/index.js';
import { IOAuthClient, IOAuthAuthorizationCode, IOAuthToken } from '../types/index.js';

// In-memory storage for authorization codes and tokens
// In production, these should be stored in a database
const authorizationCodes = new Map<string, IOAuthAuthorizationCode>();
const tokens = new Map<string, IOAuthToken>();

/**
 * Get all OAuth clients from configuration
 */
export const getOAuthClients = (): IOAuthClient[] => {
  const settings = loadSettings();
  return settings.oauthClients || [];
};

/**
 * Find OAuth client by client ID
 */
export const findOAuthClientById = (clientId: string): IOAuthClient | undefined => {
  const clients = getOAuthClients();
  return clients.find((c) => c.clientId === clientId);
};

/**
 * Create a new OAuth client
 */
export const createOAuthClient = (client: IOAuthClient): IOAuthClient => {
  const settings = loadSettings();
  if (!settings.oauthClients) {
    settings.oauthClients = [];
  }

  // Check if client already exists
  const existing = settings.oauthClients.find((c) => c.clientId === client.clientId);
  if (existing) {
    throw new Error(`OAuth client with ID ${client.clientId} already exists`);
  }

  settings.oauthClients.push(client);
  saveSettings(settings);
  return client;
};

/**
 * Update an existing OAuth client
 */
export const updateOAuthClient = (
  clientId: string,
  updates: Partial<IOAuthClient>,
): IOAuthClient | null => {
  const settings = loadSettings();
  if (!settings.oauthClients) {
    return null;
  }

  const index = settings.oauthClients.findIndex((c) => c.clientId === clientId);
  if (index === -1) {
    return null;
  }

  settings.oauthClients[index] = { ...settings.oauthClients[index], ...updates };
  saveSettings(settings);
  return settings.oauthClients[index];
};

/**
 * Delete an OAuth client
 */
export const deleteOAuthClient = (clientId: string): boolean => {
  const settings = loadSettings();
  if (!settings.oauthClients) {
    return false;
  }

  const index = settings.oauthClients.findIndex((c) => c.clientId === clientId);
  if (index === -1) {
    return false;
  }

  settings.oauthClients.splice(index, 1);
  saveSettings(settings);
  return true;
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
export const saveToken = (
  tokenData: Omit<IOAuthToken, 'accessToken' | 'accessTokenExpiresAt'>,
  accessTokenLifetime: number = 3600,
  refreshTokenLifetime?: number,
): IOAuthToken => {
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

  tokens.set(accessToken, token);
  if (refreshToken) {
    tokens.set(refreshToken, token);
  }

  return token;
};

/**
 * Get token by access token or refresh token
 */
export const getToken = (token: string): IOAuthToken | undefined => {
  const tokenData = tokens.get(token);
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
export const revokeToken = (token: string): void => {
  const tokenData = tokens.get(token);
  if (tokenData) {
    tokens.delete(tokenData.accessToken);
    if (tokenData.refreshToken) {
      tokens.delete(tokenData.refreshToken);
    }
  }
};

/**
 * Clean up expired codes and tokens (should be called periodically)
 */
export const cleanupExpired = (): void => {
  const now = new Date();

  // Clean up expired authorization codes
  for (const [code, authCode] of authorizationCodes.entries()) {
    if (authCode.expiresAt < now) {
      authorizationCodes.delete(code);
    }
  }

  // Clean up expired tokens
  const processedTokens = new Set<string>();
  for (const [_key, token] of tokens.entries()) {
    // Skip if we've already processed this token
    if (processedTokens.has(token.accessToken)) {
      continue;
    }
    processedTokens.add(token.accessToken);

    const accessExpired = token.accessTokenExpiresAt < now;
    const refreshExpired =
      token.refreshTokenExpiresAt && token.refreshTokenExpiresAt < now;

    // If both are expired, remove the token
    if (accessExpired && (!token.refreshToken || refreshExpired)) {
      tokens.delete(token.accessToken);
      if (token.refreshToken) {
        tokens.delete(token.refreshToken);
      }
    }
  }
};

// Run cleanup every 5 minutes in production
if (process.env.NODE_ENV !== 'test') {
  setInterval(cleanupExpired, 5 * 60 * 1000);
}
