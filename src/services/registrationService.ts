import {
  getServerDao,
  getGroupDao,
  getOAuthClientDao,
  getOAuthTokenDao,
  getBearerKeyDao,
  getUserConfigDao,
} from '../dao/DaoFactory.js';

/**
 * Usernames are authorization identities. A missing user record does not make a
 * name safe to claim while ownership, sharing or authentication state survives.
 * Use unfiltered DAOs so anonymous registration checks private resources in both
 * file and database mode. Read errors must propagate and prevent registration.
 */
export const isRegistrationUsernameReserved = async (username: string): Promise<boolean> => {
  // Legacy resources without an explicit owner belong to admin.
  if (username === 'admin') return true;

  const [servers, groups, clients, tokens, keys, hasUserConfig] = await Promise.all([
    getServerDao().findAll(),
    getGroupDao().findAll(),
    getOAuthClientDao().findAll(),
    getOAuthTokenDao().findAll(),
    getBearerKeyDao().findAll(),
    getUserConfigDao().exists(username),
  ]);
  const referencesUser = (resource: { owner?: string; sharedWithUsers?: string[] }): boolean =>
    resource.owner?.trim() === username || resource.sharedWithUsers?.includes(username) === true;

  return (
    hasUserConfig ||
    servers.some(referencesUser) ||
    groups.some(referencesUser) ||
    clients.some(referencesUser) ||
    keys.some(referencesUser) ||
    tokens.some((token) => token.username === username)
  );
};
