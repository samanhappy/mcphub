import type { Request, Response } from 'express';
import { getOAuthApprovalDao, getOAuthTokenDao } from '../dao/index.js';
import { revokeUserClientAuthorizationCodes } from '../models/OAuth.js';
import { logger } from '../utils/logger.js';

export const listMyOAuthApprovals = async (req: Request, res: Response): Promise<void> => {
  const user = (req as Request & { user?: { username: string } }).user;
  if (!user) {
    res.sendStatus(401);
    return;
  }
  try {
    const approvals = await getOAuthApprovalDao().findByUsername(user.username);
    res.json({
      success: true,
      data: approvals.map((row) => ({
        id: row.id,
        clientId: row.clientId,
        scopes: row.scopes,
        redirectUri: row.redirectUri,
        resource: row.resource,
        approvedAt: row.approvedAt,
        expiresAt: row.expiresAt,
      })),
    });
  } catch (error) {
    logger.error('Failed to list OAuth approvals:', error);
    res.status(500).json({ success: false, message: 'Failed to list OAuth approvals' });
  }
};

// Revoke the entire application for this user, including its other resources/scopes.
export const revokeMyOAuthApproval = async (req: Request, res: Response): Promise<void> => {
  const user = (req as Request & { user?: { username: string } }).user;
  if (!user) {
    res.sendStatus(401);
    return;
  }
  try {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.approvalId)
    ) {
      res.sendStatus(404);
      return;
    }
    const dao = getOAuthApprovalDao();
    const approval = await dao.findById(req.params.approvalId);
    if (!approval || approval.username !== user.username) {
      res.sendStatus(404);
      return;
    }
    // Delete grants first: racing exchanges/refreshes cannot resurrect access.
    await dao.deleteByUserAndClient(user.username, approval.clientId);
    await revokeUserClientAuthorizationCodes(user.username, approval.clientId);
    const tokenDao = getOAuthTokenDao();
    for (const token of await tokenDao.findByUsername(user.username)) {
      if (token.clientId === approval.clientId) await tokenDao.revokeToken(token.accessToken);
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to revoke OAuth approval:', error);
    res.status(500).json({ success: false, message: 'Failed to revoke OAuth approval' });
  }
};
