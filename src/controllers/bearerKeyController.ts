import { randomBytes } from 'node:crypto';
import { Request, Response } from 'express';
import { ApiResponse, BearerKey, BearerKeyAccessType, BearerKeyKind } from '../types/index.js';
import { getBearerKeyDao, getUserDao } from '../dao/index.js';

const VALID_ACCESS_TYPES: BearerKeyAccessType[] = ['all', 'groups', 'servers', 'custom'];

type AuthenticatedUser = {
  username?: string;
  isAdmin?: boolean;
};

const getAuthenticatedUser = (req: Request): AuthenticatedUser | undefined =>
  (req as any).user as AuthenticatedUser | undefined;

const maskToken = (token: string): string =>
  token.length > 12 ? `${token.slice(0, 8)}...${token.slice(-4)}` : '********';

const sanitizeKey = (key: BearerKey): BearerKey => ({
  ...key,
  kind: key.kind ?? 'system',
  token: maskToken(key.token),
});

const canManageKey = (user: AuthenticatedUser | undefined, key: BearerKey): boolean =>
  Boolean(user?.isAdmin || (user?.username && key.kind === 'user' && key.owner === user.username));

const validateSystemScope = (
  accessType: BearerKeyAccessType | undefined,
  res: Response,
): accessType is BearerKeyAccessType => {
  if (!accessType || !VALID_ACCESS_TYPES.includes(accessType)) {
    res.status(400).json({ success: false, message: 'Invalid accessType' });
    return false;
  }
  return true;
};

export const getBearerKeys = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = getAuthenticatedUser(req);
    if (!user?.username) {
      res.status(403).json({ success: false, message: 'Authentication required' });
      return;
    }

    const dao = getBearerKeyDao();
    const keys = user.isAdmin ? await dao.findAll() : await dao.findByOwner(user.username);
    const response: ApiResponse = {
      success: true,
      data: keys.map(sanitizeKey),
    };
    res.json(response);
  } catch (error) {
    console.error('Failed to get bearer keys:', error);
    res.status(500).json({ success: false, message: 'Failed to get bearer keys' });
  }
};

export const createBearerKey = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = getAuthenticatedUser(req);
    if (!user?.username) {
      res.status(403).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { name, enabled, kind: requestedKind, owner, accessType, allowedGroups, allowedServers } =
      req.body as Partial<BearerKey>;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ success: false, message: 'Key name is required' });
      return;
    }

    const kind: BearerKeyKind = user.isAdmin ? requestedKind ?? 'system' : 'user';
    if (!['system', 'user'].includes(kind)) {
      res.status(400).json({ success: false, message: 'Invalid key kind' });
      return;
    }

    const resolvedOwner = kind === 'user' ? (user.isAdmin ? owner : user.username) : undefined;
    if (kind === 'user') {
      if (!resolvedOwner || typeof resolvedOwner !== 'string') {
        res.status(400).json({ success: false, message: 'User-level keys require an owner' });
        return;
      }
      if (!(await getUserDao().findByUsername(resolvedOwner))) {
        res.status(400).json({ success: false, message: 'Bearer key owner not found' });
        return;
      }
    }

    const resolvedAccessType = kind === 'user' ? 'all' : accessType;
    if (kind === 'system' && !validateSystemScope(resolvedAccessType, res)) {
      return;
    }

    const key = await getBearerKeyDao().create({
      name: name.trim(),
      token: `mcphub_${randomBytes(32).toString('hex')}`,
      enabled: enabled ?? true,
      kind,
      owner: resolvedOwner,
      accessType: resolvedAccessType ?? 'all',
      allowedGroups:
        kind === 'system' && Array.isArray(allowedGroups) ? allowedGroups : [],
      allowedServers:
        kind === 'system' && Array.isArray(allowedServers) ? allowedServers : [],
    });

    res.status(201).json({
      success: true,
      data: key,
      message: 'Bearer key created. The token is only shown once.',
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Failed to create bearer key:', error);
    res.status(500).json({ success: false, message: 'Failed to create bearer key' });
  }
};

export const updateBearerKey = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, message: 'Key id is required' });
      return;
    }

    const dao = getBearerKeyDao();
    const existing = await dao.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Bearer key not found' });
      return;
    }

    const user = getAuthenticatedUser(req);
    if (!canManageKey(user, existing)) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }

    const { name, enabled, accessType, allowedGroups, allowedServers } =
      req.body as Partial<BearerKey>;
    const updates: Partial<BearerKey> = {};
    if (name !== undefined) updates.name = name;
    if (enabled !== undefined) updates.enabled = enabled;

    if (existing.kind !== 'user' && user?.isAdmin) {
      if (accessType !== undefined) {
        if (!validateSystemScope(accessType, res)) return;
        updates.accessType = accessType;
      }
      if (allowedGroups !== undefined) {
        updates.allowedGroups = Array.isArray(allowedGroups) ? allowedGroups : [];
      }
      if (allowedServers !== undefined) {
        updates.allowedServers = Array.isArray(allowedServers) ? allowedServers : [];
      }
    }

    const updated = await dao.update(id, updates);
    res.json({ success: true, data: sanitizeKey(updated!) } satisfies ApiResponse);
  } catch (error) {
    console.error('Failed to update bearer key:', error);
    res.status(500).json({ success: false, message: 'Failed to update bearer key' });
  }
};

export const deleteBearerKey = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, message: 'Key id is required' });
      return;
    }

    const dao = getBearerKeyDao();
    const existing = await dao.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Bearer key not found' });
      return;
    }

    if (!canManageKey(getAuthenticatedUser(req), existing)) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }

    await dao.delete(id);
    res.json({ success: true } satisfies ApiResponse);
  } catch (error) {
    console.error('Failed to delete bearer key:', error);
    res.status(500).json({ success: false, message: 'Failed to delete bearer key' });
  }
};
