import 'reflect-metadata';
import AppServer from './server.js';
import { initializeDatabaseMode } from './utils/migration.js';
import { createFetchWithProxy, getProxyConfigFromEnv } from './services/proxy.js';
import { isRetryableDbError } from './utils/dbRetry.js';

const appServer = new AppServer();

// Track consecutive fatal errors for circuit breaker pattern
let consecutiveFatalErrors = 0;
const MAX_CONSECUTIVE_FATAL_ERRORS = 5;
const FATAL_ERROR_WINDOW_MS = 60000; // 1 minute
let lastFatalErrorTime = 0;

/**
 * Handle uncaught exceptions - log and determine if recovery is possible
 */
const handleUncaughtException = (error: Error): void => {
  console.error('[FATAL] Uncaught exception:', error);

  // Check if this is a retryable database error
  if (isRetryableDbError(error)) {
    console.warn('[RECOVERY] Database connection error detected, attempting to continue...');
    // For database errors, we don't crash - the retry logic should handle it
    return;
  }

  // Track consecutive fatal errors
  const now = Date.now();
  if (now - lastFatalErrorTime < FATAL_ERROR_WINDOW_MS) {
    consecutiveFatalErrors++;
  } else {
    consecutiveFatalErrors = 1;
  }
  lastFatalErrorTime = now;

  // Circuit breaker: if too many consecutive errors, exit
  if (consecutiveFatalErrors >= MAX_CONSECUTIVE_FATAL_ERRORS) {
    console.error(
      `[FATAL] Too many consecutive fatal errors (${consecutiveFatalErrors}), exiting...`,
    );
    process.exit(1);
  }

  console.warn(
    `[RECOVERY] Non-fatal error, continuing... (error count: ${consecutiveFatalErrors})`,
  );
};

/**
 * Handle unhandled promise rejections - log and determine if recovery is possible
 */
const handleUnhandledRejection = (reason: unknown, promise: Promise<unknown>): void => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[FATAL] Unhandled promise rejection:', error);
  console.error('[FATAL] Promise:', promise);

  // Check if this is a retryable database error
  if (isRetryableDbError(error)) {
    console.warn(
      '[RECOVERY] Database connection error detected in promise, attempting to continue...',
    );
    // For database errors, we don't crash - the retry logic should handle it
    return;
  }

  // Track consecutive fatal errors
  const now = Date.now();
  if (now - lastFatalErrorTime < FATAL_ERROR_WINDOW_MS) {
    consecutiveFatalErrors++;
  } else {
    consecutiveFatalErrors = 1;
  }
  lastFatalErrorTime = now;

  // Circuit breaker: if too many consecutive errors, exit
  if (consecutiveFatalErrors >= MAX_CONSECUTIVE_FATAL_ERRORS) {
    console.error(
      `[FATAL] Too many consecutive fatal errors (${consecutiveFatalErrors}), exiting...`,
    );
    process.exit(1);
  }

  console.warn(
    `[RECOVERY] Non-fatal error, continuing... (error count: ${consecutiveFatalErrors})`,
  );
};

// Set up global error handlers
process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[SHUTDOWN] Received SIGTERM, shutting down gracefully...');
  await appServer.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[SHUTDOWN] Received SIGINT, shutting down gracefully...');
  await appServer.shutdown();
  process.exit(0);
});

const maskProxyUrl = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.username) {
      url.username = '***';
    }
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return value.replace(/\/\/([^@]+)@/g, '//***@');
  }
};

const setupGlobalProxyFetch = (): void => {
  const envVars = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
  const proxyConfig = getProxyConfigFromEnv(envVars);
  const proxyEnabled = Boolean(proxyConfig.httpProxy || proxyConfig.httpsProxy);

  if (!proxyEnabled) {
    return;
  }

  if (typeof globalThis.fetch !== 'function') {
    console.warn('[proxy] Global fetch is unavailable; proxy is not enabled');
    return;
  }

  const baseFetch = globalThis.fetch.bind(globalThis);
  const proxyRequest = createFetchWithProxy(proxyConfig, baseFetch);
  const proxyFetchWithLog = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const targetUrl = input instanceof Request ? input.url : input.toString();
    console.info('[proxy] Request via proxy', { url: targetUrl });
    const proxyInput = input instanceof Request ? input.url : input;
    return proxyRequest(proxyInput, init);
  };

  globalThis.fetch = proxyFetchWithLog as typeof fetch;
  console.info('[proxy] Global fetch overridden for proxy usage', {
    httpProxy: maskProxyUrl(proxyConfig.httpProxy),
    httpsProxy: maskProxyUrl(proxyConfig.httpsProxy),
    noProxy: proxyConfig.noProxy,
  });
};

async function boot() {
  try {
    setupGlobalProxyFetch();

    // Check if database mode is enabled
    // If USE_DB is explicitly set, use its value; otherwise, auto-detect based on DB_URL presence
    const useDatabase =
      process.env.USE_DB !== undefined ? process.env.USE_DB === 'true' : !!process.env.DB_URL;
    if (useDatabase) {
      console.log('Database mode enabled, initializing...');
      const dbInitialized = await initializeDatabaseMode();
      if (!dbInitialized) {
        console.error('Failed to initialize database mode');
        process.exit(1);
      }
    }

    await appServer.initialize();
    appServer.start();
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

boot();

export default appServer.getApp();
