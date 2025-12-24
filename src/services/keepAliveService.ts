import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ServerInfo, ServerConfig } from '../types/index.js';

export interface KeepAliveOptions {
  enabled?: boolean;
  intervalMs?: number;
}

/**
 * Set up keep-alive ping for MCP client connections (SSE or Streamable HTTP).
 * Keepalive is controlled per-server via `serverConfig.enableKeepAlive` (default off).
 */
export const setupClientKeepAlive = async (
  serverInfo: ServerInfo,
  serverConfig: ServerConfig,
): Promise<void> => {
  // Only set up keep-alive for SSE or Streamable HTTP client transports
  const isSSE = serverInfo.transport instanceof SSEClientTransport;
  const isStreamableHttp = serverInfo.transport instanceof StreamableHTTPClientTransport;
  if (!isSSE && !isStreamableHttp) {
    return;
  }

  const enabled = serverConfig.enableKeepAlive === true;
  if (!enabled) {
    // Ensure any previous timer is cleared
    if (serverInfo.keepAliveIntervalId) {
      clearInterval(serverInfo.keepAliveIntervalId as NodeJS.Timeout);
      serverInfo.keepAliveIntervalId = undefined;
    }
    return;
  }

  // Clear any existing interval first
  if (serverInfo.keepAliveIntervalId) {
    clearInterval(serverInfo.keepAliveIntervalId as NodeJS.Timeout);
  }

  // Default interval: 60 seconds
  const interval = serverConfig.keepAliveInterval || 60000;

  serverInfo.keepAliveIntervalId = setInterval(async () => {
    try {
      if (serverInfo.client && serverInfo.status === 'connected') {
        // Use client.ping() if available, otherwise fallback to listTools
        if (typeof (serverInfo.client as any).ping === 'function') {
          await (serverInfo.client as any).ping();
          console.log(`Keep-alive ping successful for server: ${serverInfo.name}`);
        } else {
          await serverInfo.client
            .listTools({}, { ...(serverInfo.options || {}), timeout: 5000 })
            .catch(() => void 0);
        }
      }
    } catch (error) {
      console.warn(`Keep-alive ping failed for server ${serverInfo.name}:`, error);
    }
  }, interval);

  console.log(
    `Keep-alive enabled for server ${serverInfo.name} at ${Math.round(interval / 1000)}s interval`,
  );
};

/**
 * Clear keep-alive timer for a server.
 */
export const clearClientKeepAlive = (serverInfo: ServerInfo): void => {
  if (serverInfo.keepAliveIntervalId) {
    clearInterval(serverInfo.keepAliveIntervalId as NodeJS.Timeout);
    serverInfo.keepAliveIntervalId = undefined;
    console.log(`Cleared keep-alive interval for server: ${serverInfo.name}`);
  }
};
