import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadSettings } from '../config/index.js';
import defaultConfig from '../config/index.js';

// Default secret key - in production, use an environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

const validateBearerAuth = (req: Request, routingConfig: any): boolean => {
  if (!routingConfig.enableBearerAuth) {
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  return authHeader.substring(7) === routingConfig.bearerAuthKey;
};

const readonlyAllowPaths = ['/tools/call/'];

const checkReadonly = (req: Request): boolean => {
  if (!defaultConfig.readonly) {
    return true;
  }

  for (const path of readonlyAllowPaths) {
    if (req.path.startsWith(defaultConfig.basePath + path)) {
      return true;
    }
  }

  return req.method === 'GET';
};

// Middleware to authenticate JWT token
export const auth = (req: Request, res: Response, next: NextFunction): void => {
  const t = (req as any).t;
  if (!checkReadonly(req)) {
    res.status(403).json({ success: false, message: t('api.errors.readonly') });
    return;
  }

  // Check if authentication is disabled globally
  const routingConfig = loadSettings().systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
    enableBearerAuth: false,
    bearerAuthKey: '',
    skipAuth: false,
  };

  if (routingConfig.skipAuth) {
    next();
    return;
  }

  // Check if bearer auth is enabled and validate it
  if (validateBearerAuth(req, routingConfig)) {
    next();
    return;
  }

  // Get token from header or query parameter
  const headerToken = req.header('x-auth-token');
  const queryToken = req.query.token as string;
  const token = headerToken || queryToken;

  // Check if no token
  if (!token) {
    res.status(401).json({ success: false, message: 'No token, authorization denied' });
    return;
  }

  // Verify token
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Add user from payload to request
    (req as any).user = (decoded as any).user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token is not valid' });
  }
};
