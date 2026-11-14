import { createHash, randomBytes } from 'node:crypto';

import { getUserDao } from '../../dao/DaoFactory.js';
import { StagingError } from './types.js';

export interface StagingPrincipal {
  username: string;
  /** `sha256("user:<stable-id>")`; never a raw username or email. */
  ownerHash: string;
}

const hashIdentity = (value: string): string =>
  createHash('sha256').update(`user:${value}`).digest('hex');

/** Names that must never receive a staging root. */
const RESERVED_NAMES = new Set(['system', 'api-session', 'openapi-session', 'guest', 'anonymous']);

/**
 * Resolve a stable per-principal identity for staging paths.
 *
 * DB users carry a UUID primary key, so a renamed or deleted/recreated account
 * cannot inherit the old staging root. File-mode users have no id, so a random
 * salt is persisted on first use. A username is never used as the hash input.
 */
export const resolveStagingPrincipal = async (username: string | undefined): Promise<StagingPrincipal> => {
  const name = username?.trim();
  if (!name || RESERVED_NAMES.has(name.toLowerCase())) {
    throw new StagingError('unauthenticated', 'A signed-in user is required for file staging');
  }

  const user = await getUserDao().findByUsername(name);
  if (!user) {
    throw new StagingError('unauthenticated', 'A signed-in user is required for file staging');
  }
  if (user.id) {
    return { username: name, ownerHash: hashIdentity(user.id) };
  }
  if (user.stagingSalt) {
    return { username: name, ownerHash: hashIdentity(user.stagingSalt) };
  }

  const salt = randomBytes(32).toString('hex');
  const updated = await getUserDao().update(name, { stagingSalt: salt });
  if (!updated) {
    throw new StagingError('unauthenticated', 'A signed-in user is required for file staging');
  }
  return { username: name, ownerHash: hashIdentity(salt) };
};

/** Owner hash used when a server has no principal child (owner-only runtime). */
export const resolveOwnerPrincipal = async (
  owner: string | undefined,
): Promise<StagingPrincipal | undefined> => {
  try {
    return await resolveStagingPrincipal(owner);
  } catch {
    return undefined;
  }
};
