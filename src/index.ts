import 'reflect-metadata';
import AppServer from './server.js';
import { initializeDatabaseMode } from './utils/migration.js';
import { createFetchWithProxy, getProxyConfigFromEnv } from './services/proxy.js';

const appServer = new AppServer();

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
