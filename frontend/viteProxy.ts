import { joinBasePath } from '../src/utils/basePath.js';

export interface DevProxyEntry {
  target: string;
  changeOrigin: boolean;
}

const DEV_PROXY_ROUTES = ['/api', '/config', '/public-config'] as const;

export const createDevProxyConfig = (
  basePath?: string | null,
  target = 'http://localhost:3000',
): Record<string, DevProxyEntry> =>
  Object.fromEntries(
    DEV_PROXY_ROUTES.map((route) => [
      joinBasePath(basePath, route),
      {
        target,
        changeOrigin: true,
      },
    ]),
  );
