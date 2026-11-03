import { isHostedModeEnabled } from '../services/hostedMode.js';
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
  const systemConfig = getCachedSystemConfig();
  // Hosted mode always accepts Authorization as a platform credential.
  const allowAuthorization =
    systemConfig?.routing?.allowAuthorizationPassthrough === true && !isHostedModeEnabled();
  // An opt-in must never forward the header used for MCPHub authentication.
  return (
    Boolean(normalized) &&
    (!sensitiveHeaders.has(normalized) || (normalized === 'authorization' && allowAuthorization)) &&
    normalized !== resolveBearerAuthHeaderName(systemConfig).toLowerCase()
  );
};
