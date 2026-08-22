import type { Connect, Plugin } from 'vite';
import { normalizeBasePath } from '../src/utils/basePath.js';

const NON_PAGE_PATHS = ['/api', '/config', '/public-config'];

const isPathWithin = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const isHtmlRequest = (request: Connect.IncomingMessage): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  return request.headers.accept?.includes('text/html') ?? false;
};

export const createDevBasePathRedirectMiddleware = (
  basePath?: string | null,
): Connect.NextHandleFunction => {
  const normalizedBasePath = normalizeBasePath(basePath);

  return (request, response, next) => {
    if (!normalizedBasePath || !isHtmlRequest(request)) {
      next();
      return;
    }

    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const { pathname, search } = requestUrl;

    if (
      isPathWithin(pathname, normalizedBasePath) ||
      NON_PAGE_PATHS.some((path) => isPathWithin(pathname, path))
    ) {
      next();
      return;
    }

    const targetPath = pathname === '/' ? '/' : pathname;
    response.statusCode = 302;
    response.setHeader('Location', `${normalizedBasePath}${targetPath}${search}`);
    response.end();
  };
};

export const createDevBasePathRedirectPlugin = (basePath?: string | null): Plugin => ({
  name: 'mcphub-dev-base-path-redirect',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(createDevBasePathRedirectMiddleware(basePath));
  },
});
