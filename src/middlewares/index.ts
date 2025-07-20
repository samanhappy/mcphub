import express, { Request, Response, NextFunction } from 'express';
import { auth } from './auth.js';
import { userContextMiddleware } from './userContext.js';
import { initializeDefaultUser } from '../models/User.js';
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

  // Initialize default admin user if no users exist
  initializeDefaultUser().catch((err) => {
    console.error('Error initializing default user:', err);
  });

  // Protect API routes with authentication middleware, but exclude auth endpoints
  app.use(`${config.basePath}/api`, (req, res, next) => {
    // Skip authentication for login and register endpoints
    if (req.path === '/auth/login' || req.path === '/auth/register') {
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
