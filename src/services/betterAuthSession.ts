import crypto from 'crypto';
import { Request } from 'express';
import { createUser, findUserByUsername, findUserByEmail, findUserBySsoUserId } from '../models/User.js';
import { IUser } from '../types/index.js';
import { getBetterAuthRuntimeConfig } from './betterAuthConfig.js';
import { getUserDao } from '../dao/index.js';

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
    console.warn('Better Auth session lookup failed:', error);
    return null;
  }
};

export const resolveBetterAuthUser = async (req: Request): Promise<IUser | null> => {
  const session = await getBetterAuthSession(req);
  if (!session) {
    return null;
  }

  // Better Auth user.id is stable — linked to OIDC sub via account.accountId
  const ssoUserId = session.user?.id;
  const email = session.user?.email;

  // Priority 1: ssoUserId match (stable, survives email changes)
  if (ssoUserId) {
    const ssoMatch = await findUserBySsoUserId(ssoUserId);
    if (ssoMatch) {
      // Backfill email if missing
      if (email && !ssoMatch.email) {
        try {
          const userDao = getUserDao();
          await userDao.update(ssoMatch.username, { email });
        } catch (backfillError) {
          console.warn('Email backfill failed (non-critical):', backfillError);
        }
      }
      return ssoMatch;
    }
  }

  // Priority 2: Email match (fallback for users created before ssoUserId support)
  if (email) {
    const emailMatch = await findUserByEmail(email);
    if (emailMatch) {
      // Backfill ssoUserId for stable matching on subsequent logins
      if (ssoUserId && !emailMatch.ssoUserId) {
        try {
          const userDao = getUserDao();
          await userDao.update(emailMatch.username, { ssoUserId });
        } catch (backfillError) {
          console.warn('ssoUserId backfill failed (non-critical):', backfillError);
        }
      }
      return emailMatch;
    }
  }

  // Priority 3: Username match (backward compatibility)
  const username = email || session.user?.name || session.user?.id;
  if (username) {
    const usernameMatch = await findUserByUsername(username);
    if (usernameMatch) {
      // Backfill both ssoUserId and email for existing users
      const userDao = getUserDao();
      if (ssoUserId && !usernameMatch.ssoUserId) {
        try {
          await userDao.update(usernameMatch.username, { ssoUserId });
        } catch (backfillError) {
          console.warn('ssoUserId backfill failed (non-critical):', backfillError);
        }
      }
      if (email && !usernameMatch.email) {
        try {
          await userDao.update(usernameMatch.username, { email });
        } catch (backfillError) {
          console.warn('Email backfill failed (non-critical):', backfillError);
        }
      }
      return usernameMatch;
    }
  }

  // Priority 4: Create new user (unless disabled)
  if (!username) {
    return null;
  }

  const runtimeConfig = await getBetterAuthRuntimeConfig();
  if (runtimeConfig.disableAutoCreate) {
    console.warn(`SSO auto-creation disabled: user "${username}" not found in system`);
    return null;
  }

  const generatedPassword = crypto.randomUUID();
  const createdUser = await createUser({
    username,
    password: generatedPassword,
    isAdmin: false,
    email: email || undefined,
    ssoUserId: ssoUserId || undefined,
  });
  if (createdUser) {
    return createdUser;
  }

  // Handle race condition: another request created the user between our check and create
  const refreshedUser = await findUserByUsername(username);
  return refreshedUser || null;
};
