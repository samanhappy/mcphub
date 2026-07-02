import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ServerInfo, ServerConfig } from '../types/index.js';

export interface KeepAliveOptions {
  enabled?: boolean;
  intervalMs?: number;
}

/**
 * Set up keep-alive ping for MCP client connections (SSE or Streamable HTTP).
 * Remote server health checks are opt-in because probes may count as upstream calls.
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

  const formatKeepAliveError = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  };

  const checkRemoteHealth = async (): Promise<void> => {
    if (
      !serverInfo.client ||
      serverInfo.enabled === false ||
      serverInfo.status === 'connecting' ||
      serverInfo.status === 'oauth_required'
    ) {
      return;
    }

    try {
      // Use client.ping() if available, otherwise fallback to listTools.
      if (typeof (serverInfo.client as any).ping === 'function') {
        await (serverInfo.client as any).ping({ ...(serverInfo.options || {}), timeout: 5000 });
      } else {
        await serverInfo.client.listTools({}, { ...(serverInfo.options || {}), timeout: 5000 });
      }

      if (serverInfo.status !== 'connected') {
        console.log('Keep-alive ping restored server connection', {
          serverName: serverInfo.name,
        });
      }
      serverInfo.status = 'connected';
      serverInfo.error = null;
    } catch (error) {
      const message = formatKeepAliveError(error);
      const nextError = `Keep-alive failed: ${message}`;
      if (serverInfo.status !== 'disconnected' || serverInfo.error !== nextError) {
        console.warn('Keep-alive ping failed', { serverName: serverInfo.name, error });
      }
      serverInfo.status = 'disconnected';
      serverInfo.error = nextError;
    }
  };

  serverInfo.keepAliveIntervalId = setInterval(async () => {
    await checkRemoteHealth();
  }, interval);

  console.log('Keep-alive enabled for server', {
    serverName: serverInfo.name,
    intervalSeconds: Math.round(interval / 1000),
  });
};

/**
 * Clear keep-alive timer for a server.
 */
export const clearClientKeepAlive = (serverInfo: ServerInfo): void => {
  if (serverInfo.keepAliveIntervalId) {
    clearInterval(serverInfo.keepAliveIntervalId as NodeJS.Timeout);
    serverInfo.keepAliveIntervalId = undefined;
    console.log('Cleared keep-alive interval', { serverName: serverInfo.name });
  }
};
