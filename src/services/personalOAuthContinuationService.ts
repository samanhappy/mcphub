import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { getGroupDao, getServerDao } from '../dao/index.js';
import { authorizationService, type RequestPrincipal } from './authorizationService.js';
import { findOAuthClientIncludingCimd } from './cimdClientService.js';
import { hasPersonalOAuth, PERSONAL_OAUTH_FLOW_TTL_MS } from './personalOAuthService.js';
import { normalizeBasePath } from '../utils/basePath.js';
import { parseResourceTarget } from '../utils/oauthConsentResource.js';
import { safeCompare } from '../utils/safeCompare.js';
import type { ServerConfigWithName } from '../dao/ServerDao.js';
import type { IOAuthClient, PendingPersonalOAuthContinuation } from '../types/index.js';

export const PERSONAL_OAUTH_NONCE_COOKIE = 'mcphub_personal_oauth_nonce';

export const hashBrowserNonce = (nonce: string): string =>
  createHash('sha256').update(nonce).digest('hex');

export const createBrowserNonce = (): { nonce: string; hash: string } => {
  const nonce = randomBytes(32).toString('base64url');
  return { nonce, hash: hashBrowserNonce(nonce) };
};

export const readBrowserNonceCookie = (req: Request): string | undefined => {
  const rawHeader = req.headers?.cookie;
  if (typeof rawHeader !== 'string' || !rawHeader) {
    return undefined;
  }
  for (const part of rawHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const name = part.slice(0, eqIndex).trim();
    if (name !== PERSONAL_OAUTH_NONCE_COOKIE) continue;
    const rawValue = part.slice(eqIndex + 1).trim();
    if (!rawValue) return undefined;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return undefined;
};

export const verifyBrowserNonce = (
  req: Request,
  continuation: PendingPersonalOAuthContinuation,
): boolean => {
  const cookieNonce = readBrowserNonceCookie(req);
  if (!cookieNonce || !continuation.browserNonceHash) {
    return false;
  }
  return safeCompare(hashBrowserNonce(cookieNonce), continuation.browserNonceHash);
};

const getOAuthCookiePath = (): string => {
  const basePath = normalizeBasePath(process.env.BASE_PATH);
  return `${basePath}/oauth`;
};

const isSecureCookieRequest = (req: Request): boolean =>
  req.secure === true || req.protocol === 'https';

const appendSetCookieHeader = (res: Response, cookieValue: string): void => {
  if (typeof res.append === 'function') {
    res.append('Set-Cookie', cookieValue);
    return;
  }
  if (typeof res.setHeader === 'function') {
    const existing = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
    if (Array.isArray(existing)) {
      res.setHeader('Set-Cookie', [...existing, cookieValue]);
    } else if (typeof existing === 'string') {
      res.setHeader('Set-Cookie', [existing, cookieValue]);
    } else {
      res.setHeader('Set-Cookie', cookieValue);
    }
  }
};

export const setBrowserNonceCookie = (
  req: Request,
  res: Response,
  nonce: string,
  maxAgeSeconds: number = Math.floor(PERSONAL_OAUTH_FLOW_TTL_MS / 1000),
): void => {
  const attributes = [
    `${PERSONAL_OAUTH_NONCE_COOKIE}=${encodeURIComponent(nonce)}`,
    `Path=${getOAuthCookiePath()}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecureCookieRequest(req)) {
    attributes.push('Secure');
  }
  appendSetCookieHeader(res, attributes.join('; '));
};

export const clearBrowserNonceCookie = (req: Request, res: Response): void => {
  const attributes = [
    `${PERSONAL_OAUTH_NONCE_COOKIE}=`,
    `Path=${getOAuthCookiePath()}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecureCookieRequest(req)) {
    attributes.push('Secure');
  }
  appendSetCookieHeader(res, attributes.join('; '));
};

/**
 * Resolve an explicit single-server `resource` URI to a server that requires
 * personal upstream OAuth and that `user` is permitted to invoke.
 *
 * Groups, aggregate `/mcp`, smart-routing targets, cross-user targets,
 * disabled/shared servers, and unauthorized servers return `undefined`.
 */
export const resolveSingleServerPersonalOAuthTarget = async (
  rawResource: string | undefined,
  user: RequestPrincipal,
): Promise<ServerConfigWithName | undefined> => {
  if (!rawResource || !user?.username || user.credentialEligible === false) {
    return undefined;
  }

  const parsed = parseResourceTarget(rawResource);
  if (parsed.kind !== 'target' || !parsed.name) {
    return undefined;
  }

  if (parsed.user && parsed.user !== user.username) {
    return undefined;
  }

  try {
    const groupDao = typeof getGroupDao === 'function' ? getGroupDao() : undefined;
    const serverDao = typeof getServerDao === 'function' ? getServerDao() : undefined;
    if (!serverDao) {
      return undefined;
    }

    const [group, server] = await Promise.all([
      groupDao ? groupDao.findByName(parsed.name) : Promise.resolve(undefined),
      serverDao.findById(parsed.name),
    ]);

    // First iteration scopes personal OAuth handoff to explicit single-server
    // resources only. When a group matches the same name, MCPHub routes to the
    // group, so do not hijack it as a single server.
    if (group || !server) {
      return undefined;
    }

    if (
      server.enabled === false ||
      !hasPersonalOAuth(server) ||
      !authorizationService.can('server.invoke', server, user)
    ) {
      return undefined;
    }

    return server;
  } catch {
    return undefined;
  }
};

export const validateContinuationClientRedirect = async (
  clientId: string,
  redirectUri: string,
): Promise<IOAuthClient | undefined> => {
  const client = await findOAuthClientIncludingCimd(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return undefined;
  }
  return client;
};

export const buildClientErrorRedirectUrl = (
  redirectUri: string,
  error: string,
  options: {
    errorDescription?: string;
    state?: string;
    issuer?: string;
  } = {},
): string => {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (options.errorDescription) {
    url.searchParams.set('error_description', options.errorDescription);
  }
  if (options.issuer) {
    url.searchParams.set('iss', options.issuer);
  }
  if (options.state) {
    url.searchParams.set('state', options.state);
  }
  return url.toString();
};
