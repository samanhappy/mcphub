import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { auth } from './auth.js';
import { initializeDefaultUser } from '../models/User.js';

export const errorHandler = (
  err: Error, 
  _req: Request, 
  res: Response, 
  _next: NextFunction
): void => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
};

export const initMiddlewares = (app: express.Application): void => {
  app.use(express.static('frontend/dist'));

  app.use((req, res, next) => {
    if (req.path !== '/sse' && req.path !== '/messages') {
      express.json()(req, res, next);
    } else {
      next();
    }
  });

  // Initialize default admin user if no users exist
  initializeDefaultUser().catch(err => {
    console.error('Error initializing default user:', err);
  });

  // Protect all API routes with authentication middleware
  app.use('/api', auth);

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(process.cwd(), 'frontend', 'dist', 'index.html'));
  });

  app.use(errorHandler);
};
