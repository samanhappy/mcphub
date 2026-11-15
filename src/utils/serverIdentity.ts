import { createHash } from 'node:crypto';

// Legacy file entries have no UUID; materialize this ID on the next write/rename.
export const legacyServerId = (name: string): string => {
  const hash = createHash('sha256').update(`mcphub:server:${name}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

/**
 * True when the id is the deterministic name-derived placeholder materialized
 * for legacy file entries. Staged refs need a persisted random UUID instead:
 * a rename would otherwise let a new server inherit another's refs (#1056).
 */
export const isLegacyServerId = (id: string | undefined, name: string): boolean =>
  typeof id === 'string' && id === legacyServerId(name);
