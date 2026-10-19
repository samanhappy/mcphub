import { ServerConfig } from '../types/index.js';

export const DEFAULT_OAUTH_REDIRECT_URI = 'http://localhost:3000/oauth/callback';

export const sanitizeRedirectUri = (input?: string): string | null => {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input);
    url.searchParams.delete('server');
    const params = url.searchParams.toString();
    url.search = params ? `?${params}` : '';
    return url.toString();
  } catch {
    return null;
  }
};

export const buildRedirectUriFromBase = (baseUrl?: string): string | null => {
  if (!baseUrl) {
    return null;
  }

  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const normalizedBase = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
    const redirect = new URL('oauth/callback', normalizedBase);
    return sanitizeRedirectUri(redirect.toString());
  } catch {
    return null;
  }
};

export const getConfiguredRedirectUris = (serverConfig: ServerConfig): string[] => {
  const explicitRedirectUri = sanitizeRedirectUri(serverConfig.oauth?.redirectUri);
  const metadataRedirectUris =
    serverConfig.oauth?.dynamicRegistration?.metadata?.redirect_uris
      ?.map((uri) => sanitizeRedirectUri(uri))
      .filter((uri): uri is string => Boolean(uri)) || [];

  const redirectUris: string[] = [];

  if (explicitRedirectUri) {
    redirectUris.push(explicitRedirectUri);
  }

  for (const uri of metadataRedirectUris) {
    if (!redirectUris.includes(uri)) {
      redirectUris.push(uri);
    }
  }

  return redirectUris;
};

export const resolvePreferredRedirectUris = (
  serverConfig: ServerConfig,
  systemInstallBaseUrl?: string,
): string[] => {
  const configuredRedirectUris = getConfiguredRedirectUris(serverConfig);
  if (configuredRedirectUris.length > 0) {
    return configuredRedirectUris;
  }

  return [buildRedirectUriFromBase(systemInstallBaseUrl) ?? DEFAULT_OAUTH_REDIRECT_URI];
};
