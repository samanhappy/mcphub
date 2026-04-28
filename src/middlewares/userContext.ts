import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getSystemConfigDao } from '../dao/index.js';
import { JWT_SECRET } from '../config/jwt.js';
import { UserContextService } from '../services/userContextService.js';
import { IUser } from '../types/index.js';
import { resolveOAuthUserFromHeaders } from '../utils/oauthBearer.js';
import { getBearerTokenFromHeaders } from '../utils/bearerAuth.js';

const resolveJwtUser = (req: Request): IUser | null => {
  const headerToken = req.header('x-auth-token');
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = headerToken || queryToken;

  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { user?: IUser };
    return decoded.user || null;
  } catch {
    return null;
  }
};

const resolveAuthenticatedUserForSse = async (req: Request): Promise<IUser | null> => {
  const systemConfig = await getSystemConfigDao().get();
  const oauthUser = await resolveOAuthUserFromHeaders(req.headers, systemConfig);
  if (oauthUser) {
    return oauthUser;
  }

  const bearerToken = getBearerTokenFromHeaders(req.headers, systemConfig);
  if (bearerToken) {
    return null;
  }

  return resolveJwtUser(req);
};

/**
 * User context middleware
 * Sets user context after authentication middleware, allowing service layer to access current user information
 */
export const userContextMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const currentUser = (req as any).user as IUser;
    UserContextService.getInstance().runWithContext(() => {
      if (currentUser) {
        UserContextService.getInstance().setCurrentUser(currentUser);
      }
      next();
    }, currentUser || null);
  } catch (error) {
    console.error('Error in user context middleware:', error);
    next(error);
  }
};

/**
 * User context middleware for SSE/MCP endpoints
 * Extracts user from URL path parameter and sets user context
 */
export const sseUserContextMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userContextService = UserContextService.getInstance();
    const username = req.params.user;
    userContextService.runWithContext(async () => {
      if (username) {
        const authenticatedUser = await resolveAuthenticatedUserForSse(req);

        if (!authenticatedUser) {
          res.status(401).json({
            success: false,
            message: 'Authentication is required for user-scoped SSE routes',
          });
          return;
        }

        if (authenticatedUser.username !== username) {
          res.status(403).json({
            success: false,
            message: 'User-scoped SSE routes may only be accessed by the matching user',
          });
          return;
        }

        userContextService.setCurrentUser(authenticatedUser);
        console.log(`User context set for SSE/MCP endpoint: ${username}`);
      } else {
        const systemConfig = await getSystemConfigDao().get();
        const bearerUser = await resolveOAuthUserFromHeaders(req.headers, systemConfig);

        if (bearerUser) {
          userContextService.setCurrentUser(bearerUser);
          console.log('OAuth user context set for SSE/MCP endpoint');
        } else {
          console.log('Global SSE/MCP endpoint access - no user context');
        }
      }

      next();
    });
  } catch (error) {
    console.error('Error in SSE user context middleware:', error);
    next(error);
  }
};

/**
 * Extended data service that can directly access current user context
 */
export interface ContextAwareDataService {
  getCurrentUserFromContext(): Promise<IUser | null>;
  getUserDataFromContext(dataType: string): Promise<any>;
  isCurrentUserAdmin(): Promise<boolean>;
}

export class ContextAwareDataServiceImpl implements ContextAwareDataService {
  private getUserContextService() {
    return UserContextService.getInstance();
  }

  async getCurrentUserFromContext(): Promise<IUser | null> {
    const userContextService = this.getUserContextService();
    return userContextService.getCurrentUser();
  }

  async getUserDataFromContext(dataType: string): Promise<any> {
    const userContextService = this.getUserContextService();
    const user = userContextService.getCurrentUser();

    if (!user) {
      throw new Error('No user in context');
    }

    console.log(`Getting ${dataType} data for user: ${user.username}`);

    // Return different data based on user permissions
    if (user.isAdmin) {
      return {
        type: dataType,
        data: 'Admin level data from context',
        user: user.username,
        access: 'full',
      };
    } else {
      return {
        type: dataType,
        data: 'User level data from context',
        user: user.username,
        access: 'limited',
      };
    }
  }

  async isCurrentUserAdmin(): Promise<boolean> {
    const userContextService = this.getUserContextService();
    return userContextService.isAdmin();
  }
}
