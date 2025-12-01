import { isOAuthServerEnabled } from '../services/oauthServerService.js';
import { getToken as getOAuthStoredToken } from '../models/OAuth.js';
import { findUserByUsername } from '../models/User.js';
import { IUser } from '../types/index.js';

/**
 * Resolve an MCPHub user from a raw OAuth bearer token.
 */
export const resolveOAuthUserFromToken = async (token?: string): Promise<IUser | null> => {
  if (!token || !isOAuthServerEnabled()) {
    return null;
  }

  const oauthToken = await getOAuthStoredToken(token);
  if (!oauthToken || oauthToken.accessToken !== token) {
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
 * Resolve an MCPHub user from an Authorization header.
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
