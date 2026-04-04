import { isOAuthServerEnabled } from '../services/oauthServerService.js';
import { getToken as getOAuthStoredToken } from '../models/OAuth.js';
import { findUserByUsername } from '../models/User.js';
import { IUser, SystemConfig } from '../types/index.js';
import { safeCompare } from './safeCompare.js';
import { getBearerTokenFromHeaders } from './bearerAuth.js';

/**
 * Resolve an MCPHub user from a raw OAuth bearer token.
 */
export const resolveOAuthUserFromToken = async (token?: string): Promise<IUser | null> => {
  if (!token || !isOAuthServerEnabled()) {
    return null;
  }

  const oauthToken = await getOAuthStoredToken(token);
  if (!oauthToken || !safeCompare(oauthToken.accessToken, token)) {
    return null;
  }

  const dbUser = await findUserByUsername(oauthToken.username);

  return {
    username: oauthToken.username,
    password: '',
    isAdmin: dbUser?.isAdmin || false,
  };
};

/**
 * Resolve an MCPHub user from the configured bearer auth header.
 */
export const resolveOAuthUserFromAuthHeader = async (
  authHeader?: string,
): Promise<IUser | null> => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return null;
  }

  return resolveOAuthUserFromToken(token);
};

/**
 * Resolve an MCPHub user from request headers using the configured bearer auth header name.
 */
export const resolveOAuthUserFromHeaders = async (
  headers: Record<string, string | string[] | undefined>,
  systemConfig?: SystemConfig | null,
): Promise<IUser | null> => {
  const token = getBearerTokenFromHeaders(headers, systemConfig);
  return resolveOAuthUserFromToken(token || undefined);
};
