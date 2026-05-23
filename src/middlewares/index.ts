import express, { Request, Response, NextFunction } from 'express';
import { auth } from './auth.js';
import { userContextMiddleware } from './userContext.js';
import { i18nMiddleware } from './i18n.js';
import config from '../config/index.js';
import { getSystemConfigDao } from '../dao/index.js';
import { getBetterAuthRuntimeConfig } from '../services/betterAuthConfig.js';
import { resolveJsonBodyLimit } from '../utils/bearerAuth.js';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
};

export const initMiddlewares = (app: express.Application): void => {
  // Apply i18n middleware first to detect language for all requests
  app.use(i18nMiddleware);

  // Serve static files from the dynamically determined frontend path
  // Note: Static files will be handled by the server directly, not here

  app.use(async (req, res, next) => {
    // Only apply JSON parsing for API and auth routes, not for SSE or message endpoints
    // TODO exclude sse responses by mcp endpoint
    try {
      const basePath = config.basePath;
      const systemConfig = await getSystemConfigDao().get();
      const betterAuthConfig = await getBetterAuthRuntimeConfig(systemConfig);
      const betterAuthPath = `${basePath}${betterAuthConfig.basePath}`;

      if (
        !req.path.startsWith(betterAuthPath) &&
        req.path !== `${basePath}/sse` &&
        !req.path.startsWith(`${basePath}/sse/`) &&
        req.path !== `${basePath}/messages` &&
        !req.path.match(
          new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/messages$`),
        ) &&
        !req.path.match(
          new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/sse(/.*)?$`),
        )
      ) {
        const jsonBodyLimit = resolveJsonBodyLimit(systemConfig);
        express.json({ limit: jsonBodyLimit })(req, res, next);
        return;
      }

      next();
    } catch (error) {
      next(error as Error);
    }
  });

  // Protect API routes with authentication middleware, but exclude auth endpoints
  app.use(`${config.basePath}/api`, async (req, res, next) => {
    try {
      const betterAuthConfig = await getBetterAuthRuntimeConfig();
      const betterAuthApiPath = betterAuthConfig.basePath.startsWith('/api')
        ? betterAuthConfig.basePath.replace(/^\/api/, '') || '/'
        : null;

      // Skip authentication for login endpoint
      if (
        req.path === '/auth/login' ||
        (betterAuthApiPath !== null && req.path.startsWith(betterAuthApiPath)) ||
        req.path.startsWith('/better-auth')
      ) {
        next();
        return;
      }

      // Apply authentication middleware first
      auth(req, res, (err) => {
        if (err) {
          next(err);
        } else {
          // Apply user context middleware after successful authentication
          userContextMiddleware(req, res, next);
        }
      });
    } catch (error) {
      next(error as Error);
    }
  });

  app.use(errorHandler);
};
