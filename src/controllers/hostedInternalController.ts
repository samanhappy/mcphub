import { Request, Response } from 'express';
import { applyHostedWebhookEvent } from '../services/hostedAuthService.js';
import type { HubWebhookEvent } from '../services/hostedControlPlaneClient.js';
import { verifyInternalExpressRequest } from '../services/hostedInternalAuth.js';
import { isHostedModeEnabled } from '../services/hostedMode.js';
import { getHostedRuntimeCatalog } from '../services/hostedRuntimeCatalogService.js';

function isHubWebhookEvent(value: unknown): value is HubWebhookEvent {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === 'string' && typeof record.userId === 'string';
}

export const receiveHostedInternalEvent = async (req: Request, res: Response): Promise<void> => {
  if (!isHostedModeEnabled()) {
    res.status(404).json({ success: false, message: 'Hosted mode is not enabled' });
    return;
  }

  const verified = verifyInternalExpressRequest(req, req.body);
  if (!verified.ok) {
    res.status(401).json({
      success: false,
      message: 'Invalid internal signature',
      code: verified.reason,
    });
    return;
  }

  if (!isHubWebhookEvent(req.body)) {
    res.status(400).json({ success: false, message: 'Invalid hosted webhook event' });
    return;
  }

  applyHostedWebhookEvent(req.body);
  res.json({ success: true, data: { accepted: true } });
};

export const getHostedInternalRuntimeCatalog = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!isHostedModeEnabled()) {
    res.status(404).json({ success: false, message: 'Hosted mode is not enabled' });
    return;
  }

  const verified = verifyInternalExpressRequest(req, '');
  if (!verified.ok) {
    res.status(401).json({
      success: false,
      message: 'Invalid internal signature',
      code: verified.reason,
    });
    return;
  }

  try {
    const catalog = await getHostedRuntimeCatalog();
    res.json({ success: true, data: catalog });
  } catch (error) {
    console.warn('[hosted] failed to build runtime catalog', error);
    res.status(500).json({ success: false, message: 'Failed to build hosted runtime catalog' });
  }
};
