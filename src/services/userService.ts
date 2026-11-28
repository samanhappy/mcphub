import { getOAuthApprovalDao, getPasskeyDao } from '../dao/index.js';
import { getAppDataSource } from '../db/connection.js';
import { databaseTransaction } from '../db/transactionContext.js';
import { UserDaoDbImpl } from '../dao/UserDaoDbImpl.js';
import { revokeUserAuthorizationCodes, revokeUserTokens } from '../models/OAuth.js';
import { IUser } from '../types/index.js';
import { getBearerKeyDao, getUserDao, getGroupDao, getServerDao } from '../dao/index.js';
import type { RequestPrincipal } from './authorizationService.js';
import { logger } from '../utils/logger.js';

// Get all users
export const getAllUsers = async (): Promise<IUser[]> => {
  const userDao = getUserDao();
  return await userDao.findAll();
};

// Get user by username
export const getUserByUsername = async (username: string): Promise<IUser | undefined> => {
  const userDao = getUserDao();
  const user = await userDao.findByUsername(username);
  return user || undefined;
};

/** Usernames reserved for system use (case-insensitive). */
const RESERVED_USERNAMES = ['system', 'admin', 'guest', 'root'];

/**
 * Check if a username is reserved for system use.
 * Returns the reason string if reserved, or null if allowed.
 */
export const checkReservedUsername = (username: string): string | null => {
  const lower = username.toLowerCase();
  if (RESERVED_USERNAMES.includes(lower)) {
    return `Username "${username}" is reserved and cannot be used`;
  }
  return null;
};

// Create a new user
export const createNewUser = async (
  username: string,
  password: string,
  isAdmin: boolean = false,
  email?: string,
): Promise<IUser | null> => {
  try {
    const reservedError = checkReservedUsername(username);
    if (reservedError) {
      logger.warn(`User creation blocked: ${reservedError}`);
      return null;
    }

    const userDao = getUserDao();
    const existingUser = await userDao.findByUsername(username);
    if (existingUser) {
      return null; // User already exists
    }

    return await userDao.createWithHashedPassword(username, password, isAdmin, email || undefined);
  } catch (error) {
    logger.error('Failed to create user:', error);
    return null;
  }
};

export class UserAdminConflict extends Error {}

let pendingFileMutation: Promise<unknown> = Promise.resolve();

const withUserAdminLock = async <T>(run: () => Promise<T>): Promise<T> => {
  if (!(getUserDao() instanceof UserDaoDbImpl)) {
    const mutation = pendingFileMutation.then(run);
    pendingFileMutation = mutation.catch(() => undefined);
    return mutation;
  }

  const existing = databaseTransaction.getStore();
  if (existing?.isTransactionActive) {
    await existing.query('SELECT pg_advisory_xact_lock(1527, 0)');
    return run();
  }

  const runner = getAppDataSource().createQueryRunner();
  try {
    await runner.startTransaction();
    await runner.query('SELECT pg_advisory_xact_lock(1527, 0)');
    const result = await databaseTransaction.run(runner, run);
    await runner.commitTransaction();
    return result;
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
};

const requireOtherEnabledAdmin = async (user: IUser): Promise<void> => {
  if (
    user.isAdmin &&
    !user.disabled &&
    !(await getUserDao().findAll()).some(
      (other) => other.username !== user.username && other.isAdmin && !other.disabled,
    )
  ) {
    throw new UserAdminConflict('Cannot remove the last enabled administrator');
  }
};

// Update user information
export const updateUser = async (
  username: string,
  data: {
    isAdmin?: boolean;
    newPassword?: string;
    email?: string;
    userGroups?: string[];
    disabled?: boolean;
  },
  actor?: RequestPrincipal,
): Promise<IUser | null> => {
  return withUserAdminLock(async () => {
    const userDao = getUserDao();
    const user = await userDao.findByUsername(username);
    if (!user) return null;

    if (actor && actor.credentialEligible !== false) {
      const currentActor = await userDao.findByUsername(actor.username);
      if (!currentActor?.isAdmin || currentActor.disabled) {
        throw new UserAdminConflict('Administrator access changed');
      }
    }
    if (data.disabled && actor?.username === username) {
      throw new UserAdminConflict('Cannot suspend your own account');
    }
    if (data.disabled || data.isAdmin === false) await requireOtherEnabledAdmin(user);

    if (data.userGroups !== undefined) {
      if (!(await userDao.update(username, { userGroups: data.userGroups }))) return null;
    }

    // Update admin status if provided
    if (data.isAdmin !== undefined) {
      const result = await userDao.update(username, { isAdmin: data.isAdmin });
      if (!result) {
        return null;
      }
    }

    // Update email if provided
    if (data.email !== undefined) {
      const result = await userDao.update(username, { email: data.email || null });
      if (!result) {
        return null;
      }
    }

    // Update password if provided
    if (data.newPassword) {
      const success = await userDao.updatePassword(username, data.newPassword);
      if (!success) {
        return null;
      }
    }

    if (data.disabled !== undefined && data.disabled !== Boolean(user.disabled)) {
      if (data.disabled) await revokeUserAuthorizationCodes(username);
      const updated = await userDao.update(username, {
        disabled: data.disabled,
        ...(data.disabled
          ? {
              suspendedAt: new Date(
                Math.max(Date.now(), (Date.parse(user.suspendedAt ?? '') || 0) + 1),
              ).toISOString(),
            }
          : {}),
      });
      if (!updated) return null;
      logger.log('User account status changed', {
        actor: actor?.username,
        target: username,
        disabled: data.disabled,
      });
      return updated;
    }

    return userDao.findByUsername(username);
  });
};

// Delete a user
export const deleteUser = async (username: string, actor?: RequestPrincipal): Promise<boolean> => {
  return withUserAdminLock(async () => {
    const userDao = getUserDao();
    if (actor && actor.credentialEligible !== false) {
      const currentActor = await userDao.findByUsername(actor.username);
      if (!currentActor?.isAdmin || currentActor.disabled) return false;
    }
    const userToDelete = (await userDao.findAll()).find((user) => user.username === username);
    if (userToDelete) await requireOtherEnabledAdmin(userToDelete);

    if (userToDelete) {
      await getBearerKeyDao().deleteByOwner(username);
      await revokeUserTokens(username);
      await getOAuthApprovalDao().deleteByUsername(username);
      await getPasskeyDao().deleteByUsername(username);
      const groupDao = getGroupDao();
      for (const group of await groupDao.findAll()) {
        if (group.sharedWithUsers?.includes(username)) {
          await groupDao.update(group.id, {
            sharedWithUsers: group.sharedWithUsers.filter((name) => name !== username),
          });
        }
      }
      const serverDao = getServerDao();
      for (const server of await serverDao.findAll()) {
        if (server.sharedWithUsers?.includes(username)) {
          const sharedWithUsers = server.sharedWithUsers.filter((name) => name !== username);
          await serverDao.update(server.name, { sharedWithUsers });
          const { updateServerInfoVisibility } = await import('./mcpService.js');
          updateServerInfoVisibility(
            server.name,
            server.visibility,
            sharedWithUsers,
            server.sharedWithUserGroups,
          );
        }
      }
    }
    return userToDelete ? await userDao.delete(username) : false;
  }).catch((error) => {
    logger.error('Failed to delete user:', error);
    return false;
  });
};

// Check if user has admin permissions
export const isUserAdmin = async (username: string): Promise<boolean> => {
  const userDao = getUserDao();
  const user = await userDao.findByUsername(username);
  return user?.isAdmin || false;
};

// Get user count
export const getUserCount = async (): Promise<number> => {
  const userDao = getUserDao();
  return await userDao.count();
};

// Get admin count
export const getAdminCount = async (): Promise<number> => {
  const userDao = getUserDao();
  const admins = await userDao.findAdmins();
  return admins.length;
};
