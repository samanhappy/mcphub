import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadSettings } from '../config/index.js';
import defaultConfig from '../config/index.js';
import { JWT_SECRET } from '../config/jwt.js';
import { getToken } from '../models/OAuth.js';
import { isOAuthServerEnabled } from '../services/oauthServerService.js';
import { getBearerKeyDao, getSystemConfigDao } from '../dao/index.js';
import { BearerKey, SystemConfig } from '../types/index.js';
import { getBetterAuthRuntimeConfig } from '../services/betterAuthConfig.js';
import { safeCompare } from '../utils/safeCompare.js';
import { getBearerTokenFromHeaders } from '../utils/bearerAuth.js';

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.JEST_WORKER_ID !== undefined ||
  process.env.VITEST_WORKER_ID !== undefined;

const resolveBetterAuthUserSafe = async (req: Request) => {
  if (isTestEnv) {
    return null;
  }

  const module = await import('../services/betterAuthSession.js');
  return module.resolveBetterAuthUser(req);
};

const validateBearerAuth = async (req: Request, systemConfig?: SystemConfig | null): Promise<boolean> => {
  const enableBearerAuth = systemConfig?.routing?.enableBearerAuth ?? true;
  if (!enableBearerAuth) {
    return false;
  }

  const bearerKeyDao = getBearerKeyDao();
  const enabledKeys = await bearerKeyDao.findEnabled();

  // If there are no enabled keys, bearer auth via static keys is disabled
  if (enabledKeys.length === 0) {
    return false;
  }

  const token = getBearerTokenFromHeaders(req.headers, systemConfig);
  if (!token) {
    return false;
  }

  const matchingKey: BearerKey | undefined = enabledKeys.find((key) => safeCompare(key.token, token));
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
  const systemConfig = await getSystemConfigDao().get();
  const routingConfig = systemConfig?.routing || loadSettings().systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
    skipAuth: false,
  };

  if (routingConfig.skipAuth) {
    next();
    return;
  }

  // Check if bearer auth via configured keys can validate this request
  if (await validateBearerAuth(req, systemConfig)) {
    next();
    return;
  }

  // Check for OAuth access token in the configured bearer auth header
  const accessToken = getBearerTokenFromHeaders(req.headers, systemConfig);
  if (accessToken && isOAuthServerEnabled()) {
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

  const betterAuthConfig = getBetterAuthRuntimeConfig();
  if (betterAuthConfig.enabled) {
    const betterAuthUser = await resolveBetterAuthUserSafe(req);
    if (betterAuthUser) {
      (req as any).user = {
        username: betterAuthUser.username,
        isAdmin: betterAuthUser.isAdmin || false,
      };
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
