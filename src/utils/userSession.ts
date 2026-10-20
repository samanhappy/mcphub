import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt.js';
import { getUserDao } from '../dao/index.js';
import { IUser } from '../types/index.js';
import { safeCompare } from './safeCompare.js';

// Salted password hashes change on password reset and account recreation.
export const getUserSessionVersion = (user: IUser): string =>
  createHash('sha256').update(`${user.username}\0${user.password}`).digest('hex');

export const resolveUserSession = async (session: unknown): Promise<IUser | null> => {
  if (!session || typeof session !== 'object') return null;
  const { username, sessionVersion } = session as Record<string, unknown>;
  if (typeof username !== 'string' || typeof sessionVersion !== 'string') return null;
  const user = await getUserDao().findByUsername(username);
  return user && user.password && safeCompare(getUserSessionVersion(user), sessionVersion)
    ? user
    : null;
};

export const resolveJwtUser = async (token: string): Promise<IUser | null> => {
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
  return typeof payload === 'object' ? resolveUserSession(payload.user) : null;
};
