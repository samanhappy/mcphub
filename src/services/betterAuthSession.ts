import crypto from 'crypto';
import { Request } from 'express';
import { createUser, findUserByUsername, findUserByEmail } from '../models/User.js';
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

  const { fromNodeHeaders } = await import('better-auth/node');
  const { auth } = await import('../betterAuth.js');
  const headers = fromNodeHeaders(req.headers);
  const email = session.user?.email;

  // Priority 1: OIDC sub match
  // Trace: listUserAccounts → OIDC account found → use email to find app user
  try {
    const accounts = await auth.api.listUserAccounts({ headers });
    const config = await getBetterAuthRuntimeConfig();
    const providerId = config.providers.oidc.providerId || 'oidc';
    const oidcAccount = accounts?.find(
      (acc: any) => acc.providerId === providerId || acc.providerId?.startsWith('oidc'),
    );
    if (oidcAccount && email) {
      const appUser = await findUserByEmail(email);
      if (appUser) {
        return appUser;
      }
    }
  } catch (error) {
    console.warn('OIDC identity resolution failed, falling back:', error);
  }

  // Priority 2: Email match
  if (email) {
    const emailMatch = await findUserByEmail(email);
    if (emailMatch) {
      return emailMatch;
    }
  }

  // Priority 3: Username match (backward compatibility)
  const username = email || session.user?.name || session.user?.id;
  if (username) {
    const usernameMatch = await findUserByUsername(username);
    if (usernameMatch) {
      // Backfill email for existing users to enable Priority 1/2 on subsequent logins
      if (email && !usernameMatch.email) {
        try {
          const userDao = getUserDao();
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
  });
  if (createdUser) {
    return createdUser;
  }

  // Handle race condition: another request created the user between our check and create
  const refreshedUser = await findUserByUsername(username);
  return refreshedUser || null;
};
