import type { Request, Response } from 'express';
import { getUserByUsername } from '../services/userService.js';
import type { BearerKey } from '../types/index.js';
import { getServerDao } from '../dao/DaoFactory.js';
import { authorizationService, type RequestPrincipal } from '../services/authorizationService.js';
import {
  deleteCredentialBindings,
  getCredentialBindingStatus,
  saveCredentialBinding,
} from '../services/credentialBindingService.js';
import {
  CredentialBindingError,
  hasCredentialTemplate,
  validateCredentialTemplate,
} from '../utils/credentialTemplate.js';

// Principal is supplied exclusively by dashboard authentication, never the URL/body.
const principal = (req: Request) => (req as Request & { user?: RequestPrincipal }).user;
const respondError = (res: Response, error: unknown) => {
  res.status(error instanceof CredentialBindingError ? 400 : 500).json({
    success: false,
    message:
      error instanceof CredentialBindingError
        ? error.message
        : 'Unable to manage personal credentials',
  });
};

// Management credentials authorize the actor; visibility and encryption use the target user.
const resolveUser = async (req: Request, res: Response, managed: boolean) => {
  const actor = principal(req);
  if (!managed) {
    if (!actor || actor.credentialEligible === false) {
      res.status(401).json({ success: false });
      return;
    }
    return actor;
  }
  const key = (req as Request & { bearerKey?: BearerKey }).bearerKey;
  const systemKey = key && key.kind !== 'user' && key.accessType === 'all';
  if (!actor?.isAdmin || (actor.credentialEligible === false && !systemKey)) {
    res.status(403).json({ success: false, message: 'Authenticated admin privileges required' });
    return;
  }
  const user = await getUserByUsername(req.params.username);
  if (!user) res.status(404).json({ success: false, message: 'User not found' });
  return user;
};

const listCredentials = async (req: Request, res: Response, managed: boolean): Promise<void> => {
  try {
    const user = await resolveUser(req, res, managed);
    if (!user) return;
    const servers = (await getServerDao().findAll()).filter(
      (server) =>
        hasCredentialTemplate(server) && authorizationService.can('server.discover', server, user),
    );
    const data = await Promise.all(
      servers.map(async (server) => ({
        serverName: server.name,
        credentialTemplate: validateCredentialTemplate(server),
        ...(await getCredentialBindingStatus(server.name, user.username, server, !managed)),
      })),
    );
    res.json({ success: true, data });
  } catch (error) {
    respondError(res, error);
  }
};

const updateCredential = async (req: Request, res: Response, managed: boolean): Promise<void> => {
  try {
    const user = await resolveUser(req, res, managed);
    if (!user) return;
    const server = await getServerDao().findById(req.params.name);
    if (
      !server ||
      (managed && !hasCredentialTemplate(server)) ||
      !authorizationService.can('server.discover', server, user)
    ) {
      res.status(404).json({ success: false, message: 'Server not available' });
      return;
    }
    if (req.method === 'DELETE')
      await deleteCredentialBindings({ serverName: server.name, username: user.username });
    else await saveCredentialBinding(server.name, user.username, server, req.body?.values);
    res.json({ success: true });
  } catch (error) {
    respondError(res, error);
  }
};

export const listMyCredentials = (req: Request, res: Response) => listCredentials(req, res, false);
export const updateMyCredential = (req: Request, res: Response) =>
  updateCredential(req, res, false);
export const listUserCredentials = (req: Request, res: Response) => listCredentials(req, res, true);
export const updateUserCredential = (req: Request, res: Response) =>
  updateCredential(req, res, true);
