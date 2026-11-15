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

/**
 * One in-flight resolution per username (#1056).
 *
 * File-mode users have no stable id, so the salt is generated on first use.
 * Two concurrent first requests would otherwise generate different salts, the
 * later write would win, and files created under the first identity would be
 * unreachable (and the child's cwd would differ between calls).
 */
const inflight = new Map<string, Promise<StagingPrincipal>>();

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

  const pending = inflight.get(name);
  if (pending) return pending;

  const resolution = resolveUncachedPrincipal(name);
  inflight.set(name, resolution);
  try {
    return await resolution;
  } finally {
    inflight.delete(name);
  }
};

const resolveUncachedPrincipal = async (name: string): Promise<StagingPrincipal> => {
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
  // Re-read: a concurrent writer (another process sharing the file store) may
  // have persisted a different salt first; the stored value is authoritative.
  const persisted = (await getUserDao().findByUsername(name))?.stagingSalt ?? salt;
  return { username: name, ownerHash: hashIdentity(persisted) };
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
