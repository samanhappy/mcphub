import { Request, Response } from 'express';
import { resolveBetterAuthUser } from '../services/betterAuthSession.js';
import { getDataService } from '../services/services.js';

const dataService = getDataService();

export const getBetterAuthUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await resolveBetterAuthUser(req);
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
    console.error('Get Better Auth user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
