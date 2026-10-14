import type { Request } from 'express';
import type { SystemConfig } from '../types/index.js';
import config from '../config/index.js';
import { resolveInstallBaseUrl } from './installBaseUrl.js';

export const getPublicInstallBaseUrl = (
  req: Request,
  systemConfig?: SystemConfig | null,
): string | undefined => {
  const protocol =
    (req.headers?.['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() ||
    req.protocol ||
    'http';
  const host =
    (req.headers?.['x-forwarded-host'] as string | undefined)?.split(',')[0].trim() ||
    req.headers?.host ||
    (typeof req.get === 'function' ? req.get('host') : undefined) ||
    (req.headers?.[':authority'] as string | undefined);
  return resolveInstallBaseUrl(systemConfig, host ? `${protocol}://${host}` : undefined);
};

export const getPublicResourceUrl = (req: Request, systemConfig?: SystemConfig | null): string => {
  const baseUrl = getPublicInstallBaseUrl(req, systemConfig)!;
  const path = (req.originalUrl || req.path || '/').split('?')[0];
  const basePath = (config.basePath || '').replace(/\/+$/, '');
  const resourcePath =
    basePath && path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
  const publicBase = new URL(baseUrl);
  // Without a configured public URL, the request already contains the deployment prefix.
  const prefix =
    systemConfig?.install?.baseUrl?.trim() || process.env.INSTALL_BASE_URL?.trim()
      ? publicBase.pathname.replace(/\/+$/, '')
      : basePath;
  return `${publicBase.origin}${prefix}${resourcePath}`;
};

export const getResourceMetadataUrl = (resource: string): string => {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}${url.search}`;
};
