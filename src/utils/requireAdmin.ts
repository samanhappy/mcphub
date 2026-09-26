import { NextFunction, Request, Response } from 'express';

// Shared dashboard-API admin gate. Mirrors the inline checks in
// userController/serverController so every global-scope mutation enforces the
// same rule: only requests carrying an admin identity may proceed.
export const requireAdmin = async (req: Request, res: Response): Promise<boolean> => {
  const user = (req as any).user;
  if (!user || !user.isAdmin) {
    res.status(403).json({
      success: false,
      message: 'Admin privileges required',
    });
    return false;
  }
  return true;
};

// Express middleware adapter for requireAdmin. Use it on routes whose handler
// or earlier middleware would otherwise consume untrusted request data before
// an authorization check (e.g. multer staging an upload body to disk).
export const requireAdminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (await requireAdmin(req, res)) {
    next();
  }
};
