import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadSettings } from '../config/index.js';
import defaultConfig from '../config/index.js';
import { JWT_SECRET } from '../config/jwt.js';
import { getToken } from '../models/OAuth.js';
import { isOAuthServerEnabled } from '../services/oauthServerService.js';
import { getBearerKeyDao } from '../dao/index.js';
import { BearerKey } from '../types/index.js';

const validateBearerAuth = async (req: Request): Promise<boolean> => {
  const bearerKeyDao = getBearerKeyDao();
  const enabledKeys = await bearerKeyDao.findEnabled();

  // If there are no enabled keys, bearer auth via static keys is disabled
  if (enabledKeys.length === 0) {
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return false;
  }

  const matchingKey: BearerKey | undefined = enabledKeys.find((key) => key.token === token);
  if (!matchingKey) {
    console.warn('Bearer auth failed: token did not match any configured bearer key');
    return false;
  }

  console.log(
    `Bearer auth succeeded with key id=${matchingKey.id}, name=${matchingKey.name}, accessType=${matchingKey.accessType}`,
  );
  return true;
};

const readonlyAllowPaths = ['/tools/'];

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
export const auth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const t = (req as any).t;
  if (!checkReadonly(req)) {
    res.status(403).json({ success: false, message: t('api.errors.readonly') });
    return;
  }

  // Check if authentication is disabled globally
  const routingConfig = loadSettings().systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
    skipAuth: false,
  };

  if (routingConfig.skipAuth) {
    next();
    return;
  }

  // Check if bearer auth via configured keys can validate this request
  if (await validateBearerAuth(req)) {
    next();
    return;
  }

  // Check for OAuth access token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && isOAuthServerEnabled()) {
    const accessToken = authHeader.substring(7);
    const oauthToken = await getToken(accessToken);

    if (oauthToken && oauthToken.accessToken === accessToken) {
      // Valid OAuth token - look up user to get admin status
      const { findUserByUsername } = await import('../models/User.js');
      const user = await findUserByUsername(oauthToken.username);

      // Set user context with proper admin status
      (req as any).user = {
        username: oauthToken.username,
        isAdmin: user?.isAdmin || false,
      };
      (req as any).oauthToken = oauthToken;
      next();
      return;
    }
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

  // Verify JWT token
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Add user from payload to request
    (req as any).user = (decoded as any).user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token is not valid' });
  }
};
