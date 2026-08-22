import type { Socket } from 'net';
import type http from 'http';
import { logger } from './logger.js';

export const SHUTDOWN_GRACE_PERIOD_MS = 10_000;

export const closeHttpServer = (
  server: http.Server,
  connections: ReadonlySet<Socket>,
  gracePeriodMs = SHUTDOWN_GRACE_PERIOD_MS,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const forceCloseTimer = setTimeout(() => {
      if (connections.size === 0) {
        return;
      }

      logger.warn('[SHUTDOWN] Grace period expired; force closing HTTP connections', {
        connections: connections.size,
        gracePeriodMs,
      });

      for (const socket of connections) {
        socket.destroy();
      }
    }, gracePeriodMs);

    server.close((error) => {
      clearTimeout(forceCloseTimer);

      if (error) {
        reject(error);
        return;
      }

      logger.log('[SHUTDOWN] HTTP server closed');
      resolve();
    });
  });
};
