import { OAuthServerConfig } from '../types/index.js';

export const DEFAULT_OAUTH_SERVER_CONFIG: OAuthServerConfig = {
  enabled: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 1209600,
  authorizationCodeLifetime: 300,
  requireClientSecret: false,
  allowedScopes: ['read', 'write'],
  requireState: false,
  dynamicRegistration: {
    enabled: true,
    allowedGrantTypes: ['authorization_code', 'refresh_token'],
    requiresAuthentication: false,
  },
};

export const cloneDefaultOAuthServerConfig = (): OAuthServerConfig => {
  const allowedScopes = DEFAULT_OAUTH_SERVER_CONFIG.allowedScopes
    ? [...DEFAULT_OAUTH_SERVER_CONFIG.allowedScopes]
    : [];

  const baseDynamicRegistration =
    DEFAULT_OAUTH_SERVER_CONFIG.dynamicRegistration ?? {
      enabled: false,
      allowedGrantTypes: [],
      requiresAuthentication: false,
    };

  const dynamicRegistration = {
    ...baseDynamicRegistration,
    allowedGrantTypes: baseDynamicRegistration.allowedGrantTypes
      ? [...baseDynamicRegistration.allowedGrantTypes]
      : [],
  };

  return {
    ...DEFAULT_OAUTH_SERVER_CONFIG,
    allowedScopes,
    dynamicRegistration,
  };
};
