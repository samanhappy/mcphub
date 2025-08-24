import express, { Request, Response, NextFunction } from 'express';
import { auth } from './auth.js';
import { userContextMiddleware } from './userContext.js';
import { i18nMiddleware } from './i18n.js';
import config from '../config/index.js';

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

  app.use((req, res, next) => {
    const basePath = config.basePath;
    // Only apply JSON parsing for API and auth routes, not for SSE or message endpoints
    // TODO exclude sse responses by mcp endpoint
    if (
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
      express.json()(req, res, next);
    } else {
      next();
    }
  });

  // Protect API routes with authentication middleware, but exclude auth endpoints
  app.use(`${config.basePath}/api`, (req, res, next) => {
    // Skip authentication for login endpoint
    if (req.path === '/auth/login') {
      next();
    } else {
      // Apply authentication middleware first
      auth(req, res, (err) => {
        if (err) {
          next(err);
        } else {
          // Apply user context middleware after successful authentication
          userContextMiddleware(req, res, next);
        }
      });
    }
  });

  app.use(errorHandler);
};
