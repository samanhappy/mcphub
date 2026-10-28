import { createHash } from 'node:crypto';

// Legacy file entries have no UUID; materialize this ID on the next write/rename.
export const legacyServerId = (name: string): string => {
  const hash = createHash('sha256').update(`mcphub:server:${name}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
