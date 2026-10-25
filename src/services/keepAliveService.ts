import { SSEClientTransport, StreamableHTTPClientTransport } from '../clients/mcpSdkClient.js';
import { ServerInfo, ServerConfig } from '../types/index.js';
import { formatErrorForLogging } from '../utils/serialization.js';
import { logger } from '../utils/logger.js';

export interface KeepAliveOptions {
  enabled?: boolean;
  intervalMs?: number;
  reconnectServer?: (serverName: string) => Promise<void>;
}

/**
 * Set up keep-alive ping for MCP client connections (SSE or Streamable HTTP).
 * Remote server health checks are opt-in because probes may count as upstream calls.
 */
export const setupClientKeepAlive = async (
  serverInfo: ServerInfo,
  serverConfig: ServerConfig,
  options: KeepAliveOptions = {},
): Promise<void> => {
  // Only set up keep-alive for SSE or Streamable HTTP client transports
  const isSSE = serverInfo.transport instanceof SSEClientTransport;
  const isStreamableHttp = serverInfo.transport instanceof StreamableHTTPClientTransport;
  if (!isSSE && !isStreamableHttp) {
    return;
  }

  // Repeated failed calls must not postpone an already scheduled recovery.
  if (
    serverInfo.enabled !== false &&
    serverInfo.status === 'disconnected' &&
    serverInfo.recovery?.nextAttemptAt !== undefined &&
    serverInfo.keepAliveIntervalId
  )
    return;

  if (serverInfo.keepAliveIntervalId) {
    clearInterval(serverInfo.keepAliveIntervalId);
    serverInfo.keepAliveIntervalId = undefined;
  }

  const canRetry = (): boolean =>
    serverInfo.enabled !== false && serverInfo.status === 'disconnected';

  if (serverInfo.enabled === false || serverInfo.status === 'oauth_required') {
    serverInfo.recovery = undefined;
    return;
  }

  if (serverInfo.status === 'disconnected' && options.reconnectServer) {
    const recovery = serverInfo.recovery ?? { attempts: 0 };
    serverInfo.recovery = recovery;
    // Equal jitter keeps retries spread out, bounded between 5 seconds and 5 minutes.
    const ceiling = Math.min(300000, 10000 * 2 ** Math.min(recovery.attempts, 5));
    const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5));
    recovery.nextAttemptAt = Date.now() + delay;
    serverInfo.keepAliveIntervalId = setTimeout(async () => {
      serverInfo.keepAliveIntervalId = undefined;
      recovery.nextAttemptAt = undefined;
      if (!canRetry()) return;
      recovery.attempts += 1;
      recovery.lastAttemptAt = Date.now();
      try {
        await options.reconnectServer!(serverInfo.name);
      } catch (error) {
        if (canRetry() && serverInfo.recovery === recovery) {
          serverInfo.error = `Reconnect failed: ${formatErrorForLogging(error)}`;
          await setupClientKeepAlive(serverInfo, serverConfig, options);
        }
      }
    }, delay);
    return;
  }

  if (serverInfo.status === 'connected') serverInfo.recovery = undefined;
  const enabled = serverConfig.enableKeepAlive === true;
  if (!enabled) return;

  // Default interval: 60 seconds
  const interval = serverConfig.keepAliveInterval || 60000;
  let isChecking = false;

  const isHealthCheckCurrent = (activeClient: NonNullable<ServerInfo['client']>): boolean =>
    serverInfo.client === activeClient &&
    serverInfo.enabled !== false &&
    serverInfo.status !== 'connecting' &&
    serverInfo.status !== 'oauth_required';

  const shouldSkipCheck = (): boolean =>
    serverInfo.enabled === false ||
    serverInfo.status === 'connecting' ||
    serverInfo.status === 'oauth_required';

  const checkRemoteHealth = async (): Promise<void> => {
    const activeClient = serverInfo.client;
    if (shouldSkipCheck() || isChecking) {
      return;
    }

    if (serverInfo.status === 'disconnected' && options.reconnectServer) {
      await setupClientKeepAlive(serverInfo, serverConfig, options);
      return;
    }

    if (!activeClient) {
      return;
    }

    isChecking = true;

    try {
      // Modern HTTP has no ping or server-push channel. Discovery is supported
      // even by servers that expose no tools and discover() always performs a network request.
      if (activeClient.getProtocolEra?.() === 'modern') {
        await activeClient.discover({ ...(serverInfo.options || {}), timeout: 5000 });
      } else if (typeof activeClient.ping === 'function') {
        await activeClient.ping({ ...(serverInfo.options || {}), timeout: 5000 });
      } else {
        await activeClient.listTools({}, { ...(serverInfo.options || {}), timeout: 5000 });
      }

      if (!isHealthCheckCurrent(activeClient)) {
        return;
      }

      if (serverInfo.status !== 'connected') {
        logger.log('Keep-alive ping restored server connection', {
          serverName: serverInfo.name,
        });
      }
      serverInfo.status = 'connected';
      serverInfo.error = null;
    } catch (error) {
      if (!isHealthCheckCurrent(activeClient)) {
        return;
      }

      const message = formatErrorForLogging(error);
      const nextError = `Keep-alive failed: ${message}`;
      if (serverInfo.status !== 'disconnected' || serverInfo.error !== nextError) {
        logger.warn('Keep-alive ping failed', { serverName: serverInfo.name, error });
      }
      serverInfo.status = 'disconnected';
      serverInfo.error = nextError;
      await setupClientKeepAlive(serverInfo, serverConfig, options);
    } finally {
      isChecking = false;
    }
  };

  serverInfo.keepAliveIntervalId = setInterval(async () => {
    await checkRemoteHealth();
  }, interval);

  logger.log('Keep-alive enabled for server', {
    serverName: serverInfo.name,
    intervalSeconds: Math.round(interval / 1000),
  });
};

/**
 * Clear keep-alive timer for a server.
 */
export const clearClientKeepAlive = (serverInfo: ServerInfo): void => {
  serverInfo.recovery = undefined;
  if (serverInfo.keepAliveIntervalId) {
    clearInterval(serverInfo.keepAliveIntervalId as NodeJS.Timeout);
    serverInfo.keepAliveIntervalId = undefined;
    logger.log('Cleared keep-alive interval', { serverName: serverInfo.name });
  }
};
