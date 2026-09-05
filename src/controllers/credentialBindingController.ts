import type { Request, Response } from 'express';
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

export const listMyCredentials = async (req: Request, res: Response): Promise<void> => {
  const user = principal(req);
  if (!user || user.credentialEligible === false) {
    res.status(401).json({ success: false });
    return;
  }
  try {
    const servers = (await getServerDao().findAll()).filter(
      (server) =>
        hasCredentialTemplate(server) && authorizationService.can('server.discover', server, user),
    );
    const data = await Promise.all(
      servers.map(async (server) => ({
        serverName: server.name,
        credentialTemplate: validateCredentialTemplate(server),
        ...(await getCredentialBindingStatus(server.name, user.username, server)),
      })),
    );
    res.json({ success: true, data });
  } catch (error) {
    respondError(res, error);
  }
};

export const updateMyCredential = async (req: Request, res: Response): Promise<void> => {
  const user = principal(req);
  if (!user || user.credentialEligible === false) {
    res.status(401).json({ success: false });
    return;
  }
  try {
    const server = await getServerDao().findById(req.params.name);
    if (!server || !authorizationService.can('server.discover', server, user)) {
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
