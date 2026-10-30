import type { Request, Response } from 'express';
import { Agent } from 'undici';
import { getUserDao } from '../dao/DaoFactory.js';
import { findPersonalOAuthFlow } from '../services/personalOAuthService.js';

// Only headers are used; never buffer or forward an upstream page or its cookies.
const dispatcher = new Agent({ maxHeaderSize: 16_384 });

export const handleOAuthRelay = async (req: Request, res: Response): Promise<void> => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  const state = req.query.state;
  if (typeof state !== 'string' || state.length > 256) {
    res.status(400).send('Invalid authorization flow');
    return;
  }
  try {
    const context = await findPersonalOAuthFlow(state);
    const config = context?.config;
    const relay = config?.oauth?.authorizationRelay;
    if (!context || !config || !relay || context.serverName !== req.params.name)
      throw new Error('Unavailable flow');
    // File declarations without an owner are operator-controlled. Missing/deprivileged owners fail closed.
    if (config.owner && !(await getUserDao().findByUsername(config.owner))?.isAdmin)
      throw new Error('Untrusted connector');
    const pending = config.oauth!.pendingAuthorization!;
    const endpoint = config.oauth!.authorizationServerMetadata!.authorization_endpoint;
    const target = new URL(pending.authorizationUrl!);
    const declared = new URL(endpoint);
    if (
      target.origin !== declared.origin ||
      target.pathname !== declared.pathname ||
      target.username ||
      target.password ||
      target.hash ||
      target.searchParams.getAll('state').length !== 1 ||
      target.searchParams.get('state') !== state ||
      target.toString().length > 16_384
    )
      throw new Error('Invalid broker destination');
    const request = {
      redirect: 'manual' as const,
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'text/html' },
      dispatcher,
    };
    const response = await fetch(target, request);
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (![302, 303, 307, 308].includes(response.status) || !location || location.length > 8192)
      throw new Error('Broker must return a redirect');
    const destination = new URL(location, target);
    if (
      destination.protocol !== 'https:' ||
      destination.username ||
      destination.password ||
      destination.hash ||
      !relay.allowedRedirectOrigins.includes(destination.origin) ||
      destination.origin === target.origin
    )
      throw new Error('Disallowed broker redirect');
    // Configuration edits, disconnects and callbacks may race the broker request.
    const current = await findPersonalOAuthFlow(state);
    if (!current || current.version !== context.version) throw new Error('Flow changed');
    res.redirect(302, destination.toString());
  } catch {
    // Broker errors and URLs can contain credentials; return no upstream details.
    res.status(400).send('Unable to relay authorization; reconnect in Dashboard');
  }
};
