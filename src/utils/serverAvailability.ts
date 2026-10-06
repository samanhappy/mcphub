import { ServerInfo } from '../types/index.js';

/**
 * Whether a server can serve a tool request right now: enabled, and either
 * connected or configured to start on demand. A disconnected on-demand server
 * may still have a cached tool list from a previous wake-up, and the call path
 * wakes it; any other disconnected server cannot serve the request (#1029).
 */
export const canServeToolRequests = (serverInfo: ServerInfo): boolean =>
  serverInfo.enabled !== false &&
  (serverInfo.status === 'connected' || serverInfo.config?.startOnDemand === true);
