import type { ServerConfig } from '../types/index.js';
import { ServerConfigValidationError } from './serverConfigValidation.js';

// Preserve the v1 preference order for legacy handshakes, including auto fallback.
export const LEGACY_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

/** HTTP discovery is automatic; legacy-only transports and relays skip probing. */
export const resolveUpstreamProtocolMode = (
  config: ServerConfig,
  legacyElicitation = false,
): 'auto' | 'legacy' => {
  // Nullable database columns use null for an omitted override.
  const mode = config.protocolNegotiation ?? undefined;
  if (mode !== undefined && mode !== 'auto' && mode !== 'legacy') {
    throw new ServerConfigValidationError('protocolNegotiation must be auto or legacy');
  }
  if (mode === 'auto' && config.type !== 'streamable-http') {
    throw new ServerConfigValidationError('protocolNegotiation auto requires streamable-http');
  }
  return !legacyElicitation && config.type === 'streamable-http' ? (mode ?? 'auto') : 'legacy';
};
