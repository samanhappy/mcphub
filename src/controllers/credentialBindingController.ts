import type { Request, Response } from 'express';
import type { ApiResponse, CredentialValues } from '../types/index.js';
import type { RequestPrincipal } from '../services/authorizationService.js';
import {
  CredentialBindingError,
  credentialBindingService,
} from '../services/credentialBindingService.js';

const loadCredentialRuntimeOperations = () => import('../services/mcpService.js');

const getPrincipal = (req: Request): RequestPrincipal | null =>
  ((req as Request & { user?: RequestPrincipal }).user as RequestPrincipal | undefined) ?? null;

const sendError = (res: Response, error: unknown): void => {
  if (error instanceof CredentialBindingError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  res.status(500).json({ success: false, message: 'Credential binding operation failed' });
};

export const getCredentialBindings = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await credentialBindingService.listForPrincipal(getPrincipal(req));
    res.json({ success: true, data } satisfies ApiResponse);
  } catch (error) {
    sendError(res, error);
  }
};

export const upsertCredentialBinding = async (req: Request, res: Response): Promise<void> => {
  const principal = getPrincipal(req);
  try {
    const data = await credentialBindingService.upsertForPrincipal(
      req.params.serverName,
      principal,
      (req.body?.values || {}) as CredentialValues,
    );
    const { invalidateCredentialRuntime, refreshCredentialServerCatalog } =
      await loadCredentialRuntimeOperations();
    invalidateCredentialRuntime(req.params.serverName, principal?.username || '');
    await refreshCredentialServerCatalog(req.params.serverName, principal?.username || '', {
      onlyIfEmpty: true,
    });
    res.json({ success: true, data } satisfies ApiResponse);
  } catch (error) {
    sendError(res, error);
  }
};

export const deleteCredentialBinding = async (req: Request, res: Response): Promise<void> => {
  const principal = getPrincipal(req);
  try {
    const deleted = await credentialBindingService.deleteForPrincipal(
      req.params.serverName,
      principal,
    );
    const { invalidateCredentialRuntime } = await loadCredentialRuntimeOperations();
    invalidateCredentialRuntime(req.params.serverName, principal?.username || '');
    res.json({ success: true, data: { deleted } } satisfies ApiResponse);
  } catch (error) {
    sendError(res, error);
  }
};
