import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { auth } from './auth.js';
import { initializeDefaultUser } from '../models/User.js';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to find the correct frontend file path
const findFrontendPath = (): string => {
  // First try development environment path
  const devPath = path.join(dirname(__dirname), 'frontend', 'dist', 'index.html');
  if (fs.existsSync(devPath)) {
    return path.join(dirname(__dirname), 'frontend', 'dist');
  }
  
  // Try npm/npx installed path (remove /dist directory)
  const npmPath = path.join(dirname(dirname(__dirname)), 'frontend', 'dist', 'index.html');
  if (fs.existsSync(npmPath)) {
    return path.join(dirname(dirname(__dirname)), 'frontend', 'dist');
  }
  
  // If none of the above paths exist, return the most reasonable default path and log a warning
  console.warn('Warning: Could not locate frontend files. Using default path.');
  return path.join(dirname(__dirname), 'frontend', 'dist');
};

const frontendPath = findFrontendPath();

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
  // Serve static files from the dynamically determined frontend path
  app.use(express.static(frontendPath));

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
    // Serve the frontend application
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  app.use(errorHandler);
};
