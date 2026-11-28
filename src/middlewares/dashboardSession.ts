import { CompactEncrypt, compactDecrypt } from 'jose';
import { JWT_SECRET } from '../config/jwt.js';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SystemConfig } from '../types/index.js';
import config from '../config/index.js';
import { getSystemConfigDao } from '../dao/index.js';
import { getPublicInstallBaseUrl } from '../utils/protectedResource.js';
import { logger } from '../utils/logger.js';

const cookieName = `mcphub_session_${createHash('sha256')
  .update(config.basePath || '')
  .digest('hex')
  .slice(0, 8)}`;
const sessionKey = createHash('sha256')
  .update('mcphub dashboard cookie\0')
  .update(JWT_SECRET)
  .digest();
const sessionTokens = new WeakMap<Request, string>();
const sessionOrigins = new WeakMap<Request, URL>();

export const extractDashboardSession = (req: Request, _res: Response, next: NextFunction) => {
  const cookies = req.headers.cookie?.split(';').map((cookie) => cookie.trimStart());
  const prefix = `${cookieName}=`;
  const sessionCookies = cookies?.filter((cookie) => cookie.startsWith(prefix));
  if (sessionCookies?.length === 1) {
    sessionTokens.set(req, sessionCookies[0].slice(prefix.length));
  }
  if (cookies?.some((cookie) => cookie.startsWith('mcphub_session_'))) {
    // The dashboard session must never be available to upstream header passthrough.
    const remaining = cookies.filter((cookie) => !cookie.startsWith('mcphub_session_')).join('; ');
    if (remaining) req.headers.cookie = remaining;
    else delete req.headers.cookie;
  }
  next();
};

export const getDashboardSession = async (req: Request) => {
  const cookie = sessionTokens.get(req);
  if (!cookie) return undefined;
  try {
    const { plaintext } = await compactDecrypt(cookie, sessionKey, {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    return Buffer.from(plaintext).toString('utf8');
  } catch {
    return undefined;
  }
};

export const hasDashboardSession = (req: Request) => sessionTokens.has(req);

export const getLegacyQueryToken = (req: Request) => {
  if (typeof req.query.token !== 'string' || !req.query.token) return undefined;
  logger.warn(
    'Query parameter authentication via token is deprecated. Use a supported credential header.',
  );
  return req.query.token;
};

export const requireDashboardOrigin = async (
  req: Request,
  res: Response,
  systemConfig?: SystemConfig | null,
) => {
  const settings = systemConfig === undefined ? await getSystemConfigDao().get() : systemConfig;
  const publicUrl = getPublicInstallBaseUrl(req, settings);
  const url = publicUrl ? new URL(publicUrl) : undefined;
  if (!url || req.header('Origin') !== url.origin) {
    res.status(403).json({ success: false, message: 'Untrusted dashboard origin' });
    return false;
  }
  sessionOrigins.set(req, url);
  return true;
};

const isBrowserSessionRequest = (req: Request) => req.header('X-MCPHub-Session') === 'cookie';

export const validateBrowserSignIn = (req: Request, res: Response, next: NextFunction) => {
  if (!isBrowserSessionRequest(req)) {
    next();
    return;
  }
  requireDashboardOrigin(req, res).then((allowed) => {
    if (allowed) next();
  }, next);
};

const cookieOptions = (req: Request) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: sessionOrigins.get(req)?.protocol === 'https:',
});

export const dashboardSignInToken = async (
  req: Request,
  res: Response,
  token: string | undefined,
) => {
  if (!sessionOrigins.has(req)) return { token };
  if (token) {
    const cookie = await new CompactEncrypt(Buffer.from(token))
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(sessionKey);
    res.cookie(cookieName, cookie, { ...cookieOptions(req), maxAge: 24 * 60 * 60 * 1000 });
  }
  return {};
};

export const dashboardLogout = (req: Request, res: Response, next: NextFunction) => {
  requireDashboardOrigin(req, res).then((allowed) => {
    if (!allowed) return;
    res.clearCookie(cookieName, cookieOptions(req));
    res.json({ success: true });
  }, next);
};
