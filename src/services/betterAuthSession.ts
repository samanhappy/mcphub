import crypto from 'crypto';
import { Request } from 'express';
import {
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserBySsoUserId,
} from '../models/User.js';
import { IUser } from '../types/index.js';
import { getBetterAuthRuntimeConfig } from './betterAuthConfig.js';
import { getUserDao } from '../dao/index.js';
import { isForwardAuthUser } from './forwardAuthService.js';
import { logger } from '../utils/logger.js';

export const getBetterAuthSession = async (req: Request): Promise<any | null> => {
  if (!(await getBetterAuthRuntimeConfig()).enabled) {
    return null;
  }

  try {
    const [{ auth }, { fromNodeHeaders }] = await Promise.all([
      import('../betterAuth.js'),
      import('better-auth/node'),
    ]);
    const headers = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers });
    return session || null;
  } catch (error) {
    logger.warn('Better Auth session lookup failed:', error);
    return null;
  }
};

// Forward-auth users belong to the upstream gateway's identity provider and are
// never adopted by a Better Auth login.
const rejectForwardAuthUser = (user: IUser | undefined): IUser | null | undefined => {
  if (user && isForwardAuthUser(user)) {
    logger.warn(
      `Better Auth login refused: user "${user.username}" is bound to a forward-auth identity`,
    );
    return null;
  }
  return user;
};

export const resolveBetterAuthUser = async (req: Request): Promise<IUser | null> => {
  const session = await getBetterAuthSession(req);
  if (!session) {
    return null;
  }

  const sessionCreatedAt = new Date(session.session?.createdAt).getTime();
  const isAvailable = (user: IUser) =>
    !user.disabled && (!user.suspendedAt || sessionCreatedAt > Date.parse(user.suspendedAt));

  // Better Auth user.id is stable — linked to OIDC sub via account.accountId.
  // Require a non-empty ssoUserId; never fall back to email or username adoption.
  const ssoUserId = typeof session.user?.id === 'string' ? session.user.id : '';
  if (!ssoUserId.trim()) {
    logger.warn('Better Auth login refused: session has no usable user ID');
    return null;
  }

  const email =
    typeof session.user?.email === 'string' && session.user.email ? session.user.email : undefined;

  // Priority 1: strict ssoUserId match (stable, survives email changes)
  const ssoMatch = rejectForwardAuthUser(await findUserBySsoUserId(ssoUserId));
  if (ssoMatch === null) {
    return null;
  }
  if (ssoMatch) {
    if (!isAvailable(ssoMatch)) return null;
    // Backfill email if missing
    if (email && !ssoMatch.email) {
      try {
        const userDao = getUserDao();
        await userDao.update(ssoMatch.username, { email });
      } catch (backfillError) {
        logger.warn('Email backfill failed (non-critical):', backfillError);
      }
    }
    return ssoMatch;
  }

  // Priority 2: auto-create new non-admin user (unless disabled)
  const username = email || session.user?.name || ssoUserId;
  if (!username) {
    return null;
  }

  const runtimeConfig = await getBetterAuthRuntimeConfig();
  if (runtimeConfig.disableAutoCreate) {
    logger.warn(`SSO auto-creation disabled: user "${username}" not found in system`);
    return null;
  }

  // Fail closed on username or email collision: never adopt or mutate an
  // existing local, admin, forward-auth, or other SSO account.
  // Re-check by ssoUserId before rejecting so a concurrent first login for the
  // same SSO identity does not fail with a spurious 401.
  if (await findUserByUsername(username)) {
    const concurrentUser = rejectForwardAuthUser(await findUserBySsoUserId(ssoUserId));
    if (concurrentUser === null) {
      return null;
    }
    if (concurrentUser) {
      return concurrentUser;
    }
    logger.warn(
      `Better Auth login refused: username "${username}" already belongs to another account`,
    );
    return null;
  }
  if (email && (await findUserByEmail(email))) {
    const concurrentUser = rejectForwardAuthUser(await findUserBySsoUserId(ssoUserId));
    if (concurrentUser === null) {
      return null;
    }
    if (concurrentUser) {
      return concurrentUser;
    }
    logger.warn(
      `Better Auth login refused: email "${email}" already belongs to another account`,
    );
    return null;
  }

  const generatedPassword = crypto.randomUUID();
  const createdUser = await createUser({
    username,
    password: generatedPassword,
    isAdmin: false,
    email,
    ssoUserId,
  });
  if (createdUser) {
    return createdUser;
  }

  // Handle race condition: another concurrent request for the same SSO identity
  // may have created the user between our check and createUser.
  const refreshedUser = rejectForwardAuthUser(await findUserBySsoUserId(ssoUserId));
  return refreshedUser && isAvailable(refreshedUser) ? refreshedUser : null;
};
