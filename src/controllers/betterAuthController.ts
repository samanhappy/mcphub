import { Request, Response } from 'express';
import { resolveBetterAuthUser } from '../services/betterAuthSession.js';
import { getDataService } from '../services/services.js';
import { IUser } from '../types/index.js';
import { logger } from '../utils/logger.js';

const dataService = getDataService();

export const getBetterAuthUser = async (req: Request, res: Response): Promise<void> => {
  try {
    // The dashboard bootstraps through this endpoint when it holds no local
    // token, so a gateway-authenticated (forward auth) user enters directly.
    const user: IUser | null = (req as any).forwardAuthUser || (await resolveBetterAuthUser(req));
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    res.json({
      success: true,
      user: {
        username: user.username,
        isAdmin: user.isAdmin,
        permissions: dataService.getPermissions(user),
      },
    });
  } catch (error) {
    logger.error('Get Better Auth user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
