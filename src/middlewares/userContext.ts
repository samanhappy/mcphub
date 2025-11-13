import { Request, Response, NextFunction } from 'express';
import { UserContextService } from '../services/userContextService.js';
import { AccessControlService } from '../services/accessControlService.js';
import { IUser } from '../types/index.js';

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

    if (currentUser) {
      // Set user context
      const userContextService = UserContextService.getInstance();
      userContextService.setCurrentUser(currentUser);

      // Clean up user context when response ends
      res.on('finish', () => {
        const userContextService = UserContextService.getInstance();
        userContextService.clearCurrentUser();
      });
    }

    next();
  } catch (error) {
    console.error('Error in user context middleware:', error);
    next(error);
  }
};

/**
 * User context middleware for SSE/MCP endpoints
 * Extracts user from URL path parameter and validates user exists
 *
 * SECURITY: This middleware now properly validates users instead of creating fake user objects
 */
export const sseUserContextMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userContextService = UserContextService.getInstance();
    const accessControlService = AccessControlService.getInstance();
    const username = req.params.user;

    if (username) {
      // SECURITY FIX: Validate that the user actually exists in the database
      const user = accessControlService.getUserByUsername(username);

      if (!user) {
        console.warn(`SSE/MCP access denied: User '${username}' does not exist`);
        res.status(401).json({
          success: false,
          message: 'User not found or invalid credentials',
        });
        return;
      }

      // Set the validated user context
      userContextService.setCurrentUser(user);

      // Clean up user context when response ends
      res.on('finish', () => {
        userContextService.clearCurrentUser();
      });

      // Also clean up on connection close for SSE
      res.on('close', () => {
        userContextService.clearCurrentUser();
      });

      console.log(`User context set for SSE/MCP endpoint: ${username} (validated)`);
    } else {
      // For global routes, clear user context
      // Note: Access control for global routes is handled in sseService.ts
      userContextService.clearCurrentUser();
      console.log('Global SSE/MCP endpoint access - no user context');
    }

    next();
  } catch (error) {
    console.error('Error in SSE user context middleware:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
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
