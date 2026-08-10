import crypto from 'crypto';
import { Request } from 'express';
import { decode } from 'jsonwebtoken';
import { createUser, findUserByUsername, findUserByEmail, findUserBySsoUserId } from '../models/User.js';
import { IUser } from '../types/index.js';
import { getBetterAuthRuntimeConfig } from './betterAuthConfig.js';
import { getUserDao } from '../dao/index.js';

interface OidcIdentity {
  issuer: string;
  sub: string;
  stableId: string;
}

const normalizeOidcGroups = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

const resolveOidcGroups = (payload: Record<string, unknown> | null): string[] => {
  if (!payload) {
    return [];
  }

  const claimValues = [payload.groups, payload.entitlements];
  const normalizedValues = claimValues.flatMap((value) => normalizeOidcGroups(value));

  return Array.from(new Set(normalizedValues));
};

const getTokenPayload = (token: string | undefined): Record<string, unknown> | null => {
  if (!token) {
    return null;
  }

  try {
    const decoded = decode(token);
    return decoded && typeof decoded === 'object' ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const resolveOidcClaims = async (
  req: Request,
): Promise<{ identity: OidcIdentity | null; groups: string[]; isAdminClaim: boolean }> => {
  const runtimeConfig = await getBetterAuthRuntimeConfig();
  if (!runtimeConfig.providers?.oidc?.enabled) {
    return { identity: null, groups: [], isAdminClaim: false };
  }

  try {
    const oidcConfig = runtimeConfig.providers?.oidc;
    const [{ auth }, { fromNodeHeaders }] = await Promise.all([
      import('../betterAuth.js'),
      import('better-auth/node'),
    ]);
    const headers = fromNodeHeaders(req.headers);
    const tokenResponse = await auth.api.getAccessToken({
      headers,
      body: { providerId: oidcConfig?.providerId },
    });

    const payload = getTokenPayload(tokenResponse?.idToken || tokenResponse?.accessToken);
    const issuer = typeof payload?.iss === 'string' ? payload.iss : undefined;
    const sub = typeof payload?.sub === 'string' ? payload.sub : undefined;
    const groups = resolveOidcGroups(payload);
    const isAdminClaim =
      payload?.isAdmin === true ||
      payload?.is_admin === true ||
      groups.some((group) => group === 'isAdmin' || group.toLowerCase() === 'isadmin');

    return {
      identity: issuer && sub ? { issuer, sub, stableId: `${issuer}::${sub}` } : null,
      groups,
      isAdminClaim,
    };
  } catch (error) {
    console.warn('Failed to read OIDC identity claims from Better Auth session:', error);
    return { identity: null, groups: [], isAdminClaim: false };
  }
};

const syncUserProfile = async (
  user: IUser,
  targetSsoUserId: string | undefined,
  email: string | undefined,
  shouldBeAdmin: boolean,
): Promise<IUser> => {
  const updates: Partial<IUser> = {};

  if (targetSsoUserId && user.ssoUserId !== targetSsoUserId) {
    updates.ssoUserId = targetSsoUserId;
  }

  if (email && user.email !== email) {
    updates.email = email;
  }

  if (user.isAdmin !== shouldBeAdmin) {
    updates.isAdmin = shouldBeAdmin;
  }

  if (Object.keys(updates).length > 0) {
    try {
      const userDao = getUserDao();
      const updatedUser = await userDao.update(user.username, updates);
      if (updatedUser) {
        return { ...user, ...updates, ...updatedUser } as IUser;
      }
    } catch (backfillError) {
      console.warn('User profile sync failed (non-critical):', backfillError);
    }
  }

  return { ...user, ...updates } as IUser;
};

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

  const { identity, isAdminClaim } = await resolveOidcClaims(req);
  const runtimeConfig = await getBetterAuthRuntimeConfig();
  const shouldBeAdmin = Boolean(isAdminClaim);

  const email = session.user?.email;
  const fallbackSsoUserId = session.user?.id;
  const targetSsoUserId = identity?.stableId || fallbackSsoUserId;

  // Priority 1: stable OIDC identity match (issuer + sub), with Better Auth user.id as a fallback.
  const candidateSsoUserIds = [targetSsoUserId, fallbackSsoUserId].filter(
    (value): value is string => Boolean(value),
  );
  for (const candidateSsoUserId of candidateSsoUserIds) {
    const ssoMatch = await findUserBySsoUserId(candidateSsoUserId);
    if (ssoMatch) {
      const syncedUser = await syncUserProfile(ssoMatch, targetSsoUserId, email, shouldBeAdmin);
      return syncedUser;
    }
  }

  // Priority 2: Email match (fallback for users created before stable OIDC identity support)
  if (email) {
    const emailMatch = await findUserByEmail(email);
    if (emailMatch) {
      const syncedUser = await syncUserProfile(emailMatch, targetSsoUserId, email, shouldBeAdmin);
      return syncedUser;
    }
  }

  // Priority 3: Username match (backward compatibility)
  const username = email || session.user?.name || session.user?.id;
  if (username) {
    const usernameMatch = await findUserByUsername(username);
    if (usernameMatch) {
      const syncedUser = await syncUserProfile(usernameMatch, targetSsoUserId, email, shouldBeAdmin);
      return syncedUser;
    }
  }

  // Priority 4: Create new user (unless disabled)
  if (!username) {
    return null;
  }

  if (runtimeConfig.disableAutoCreate) {
    console.warn(`SSO auto-creation disabled: user "${username}" not found in system`);
    return null;
  }

  const generatedPassword = crypto.randomUUID();
  const createdUser = await createUser({
    username,
    password: generatedPassword,
    isAdmin: shouldBeAdmin,
    email: email || undefined,
    ssoUserId: targetSsoUserId || undefined,
  });
  if (createdUser) {
    return createdUser;
  }

  // Handle race condition: another request created the user between our check and create
  const refreshedUser = await findUserByUsername(username);
  return refreshedUser || null;
};
