import { IncomingHttpHeaders } from 'node:http';
import { SystemConfig } from '../types/index.js';

type HeaderValue = string | string[] | undefined;

export const DEFAULT_BEARER_AUTH_HEADER_NAME = 'Authorization';
export const DEFAULT_JSON_BODY_LIMIT = '1mb';

export const resolveBearerAuthHeaderName = (systemConfig?: SystemConfig | null): string => {
  const rawHeaderName = systemConfig?.routing?.bearerAuthHeaderName?.trim();
  return rawHeaderName || DEFAULT_BEARER_AUTH_HEADER_NAME;
};

export const resolveJsonBodyLimit = (systemConfig?: SystemConfig | null): string => {
  const rawLimit = systemConfig?.routing?.jsonBodyLimit?.trim();
  return rawLimit || DEFAULT_JSON_BODY_LIMIT;
};

const findHeaderValue = (
  headers: IncomingHttpHeaders | Record<string, HeaderValue>,
  headerName: string,
): HeaderValue => {
  if (!headers) {
    return undefined;
  }

  if (headers[headerName]) {
    return headers[headerName];
  }

  const lowerHeaderName = headerName.toLowerCase();
  if (headers[lowerHeaderName]) {
    return headers[lowerHeaderName];
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerHeaderName) {
      return value;
    }
  }

  return undefined;
};

export const getBearerAuthHeaderValue = (
  headers: IncomingHttpHeaders | Record<string, HeaderValue>,
  systemConfig?: SystemConfig | null,
): string | undefined => {
  const headerValue = findHeaderValue(headers, resolveBearerAuthHeaderName(systemConfig));
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
};

/**
 * Parse an Authorization header value of the form `Bearer <token>`.
 * The auth-scheme is matched case-insensitively (RFC 7235 section 2.1).
 */
export const parseBearerAuthorization = (value: string | undefined | null): string | null => {
  const match = /^bearer[ \t]+(.*)$/i.exec(value ?? '');
  return match?.[1].trim() || null;
};

export const getBearerTokenFromHeaders = (
  headers: IncomingHttpHeaders | Record<string, HeaderValue>,
  systemConfig?: SystemConfig | null,
): string | null => {
  const authHeader = getBearerAuthHeaderValue(headers, systemConfig);

  return parseBearerAuthorization(authHeader);
};
