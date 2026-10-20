import { resolveBearerAuthHeaderName } from './bearerAuth.js';
import { getCachedSystemConfig } from './systemConfigCache.js';

const sensitiveHeaders = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-auth-token',
  'x-api-key',
]);

export const isSafePassthroughHeader = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  // Server owners must never forward the invoking user's platform credentials.
  return (
    Boolean(normalized) &&
    !sensitiveHeaders.has(normalized) &&
    normalized !== resolveBearerAuthHeaderName(getCachedSystemConfig()).toLowerCase()
  );
};
