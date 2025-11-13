import OAuth2Server from '@node-oauth/oauth2-server';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { loadSettings } from '../config/index.js';
import { findUserByUsername, verifyPassword } from '../models/User.js';
import {
  findOAuthClientById,
  saveAuthorizationCode,
  getAuthorizationCode,
  revokeAuthorizationCode,
  saveToken,
  getToken,
  revokeToken,
} from '../models/OAuth.js';
import crypto from 'crypto';

const { Request, Response } = OAuth2Server;

// OAuth2Server model implementation
const oauthModel: OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel = {
  /**
   * Get client by client ID
   */
  getClient: async (clientId: string, clientSecret?: string) => {
    const client = findOAuthClientById(clientId);
    if (!client) {
      return false;
    }

    // If client secret is provided, verify it
    if (clientSecret && client.clientSecret) {
      if (client.clientSecret !== clientSecret) {
        return false;
      }
    }

    return {
      id: client.clientId,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUris: client.redirectUris,
      grants: client.grants,
    };
  },

  /**
   * Save authorization code
   */
  saveAuthorizationCode: async (
    code: OAuth2Server.AuthorizationCode,
    client: OAuth2Server.Client,
    user: OAuth2Server.User,
  ) => {
    const settings = loadSettings();
    const oauthConfig = settings.systemConfig?.oauthServer;
    const lifetime = oauthConfig?.authorizationCodeLifetime || 300;

    const scopeString = Array.isArray(code.scope) ? code.scope.join(' ') : code.scope;

    const authCode = saveAuthorizationCode(
      {
        redirectUri: code.redirectUri,
        scope: scopeString,
        clientId: client.id,
        username: user.username,
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
      },
      lifetime,
    );

    return {
      authorizationCode: authCode,
      expiresAt: new Date(Date.now() + lifetime * 1000),
      redirectUri: code.redirectUri,
      scope: code.scope,
      client,
      user: {
        username: user.username,
      },
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
    };
  },

  /**
   * Get authorization code
   */
  getAuthorizationCode: async (authorizationCode: string) => {
    const code = getAuthorizationCode(authorizationCode);
    if (!code) {
      return false;
    }

    const client = findOAuthClientById(code.clientId);
    if (!client) {
      return false;
    }

    const scopeArray = code.scope ? code.scope.split(' ') : undefined;

    return {
      authorizationCode: code.code,
      expiresAt: code.expiresAt,
      redirectUri: code.redirectUri,
      scope: scopeArray,
      client: {
        id: client.clientId,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        redirectUris: client.redirectUris,
        grants: client.grants,
      },
      user: {
        username: code.username,
      },
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
    };
  },

  /**
   * Revoke authorization code
   */
  revokeAuthorizationCode: async (code: OAuth2Server.AuthorizationCode) => {
    revokeAuthorizationCode(code.authorizationCode);
    return true;
  },

  /**
   * Save access token and refresh token
   */
  saveToken: async (
    token: OAuth2Server.Token,
    client: OAuth2Server.Client,
    user: OAuth2Server.User,
  ) => {
    const settings = loadSettings();
    const oauthConfig = settings.systemConfig?.oauthServer;
    const accessTokenLifetime = oauthConfig?.accessTokenLifetime || 3600;
    const refreshTokenLifetime = oauthConfig?.refreshTokenLifetime || 1209600;

    const scopeString = Array.isArray(token.scope) ? token.scope.join(' ') : token.scope;

    const savedToken = saveToken(
      {
        scope: scopeString,
        clientId: client.id,
        username: user.username,
      },
      accessTokenLifetime,
      refreshTokenLifetime,
    );

    const scopeArray = savedToken.scope ? savedToken.scope.split(' ') : undefined;

    return {
      accessToken: savedToken.accessToken,
      accessTokenExpiresAt: savedToken.accessTokenExpiresAt,
      refreshToken: savedToken.refreshToken,
      refreshTokenExpiresAt: savedToken.refreshTokenExpiresAt,
      scope: scopeArray,
      client,
      user: {
        username: user.username,
      },
    };
  },

  /**
   * Get access token
   */
  getAccessToken: async (accessToken: string) => {
    const token = getToken(accessToken);
    if (!token) {
      return false;
    }

    const client = findOAuthClientById(token.clientId);
    if (!client) {
      return false;
    }

    const scopeArray = token.scope ? token.scope.split(' ') : undefined;

    return {
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      scope: scopeArray,
      client: {
        id: client.clientId,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        redirectUris: client.redirectUris,
        grants: client.grants,
      },
      user: {
        username: token.username,
      },
    };
  },

  /**
   * Get refresh token
   */
  getRefreshToken: async (refreshToken: string) => {
    const token = getToken(refreshToken);
    if (!token || token.refreshToken !== refreshToken) {
      return false;
    }

    const client = findOAuthClientById(token.clientId);
    if (!client) {
      return false;
    }

    const scopeArray = token.scope ? token.scope.split(' ') : undefined;

    return {
      refreshToken: token.refreshToken!,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt!,
      scope: scopeArray,
      client: {
        id: client.clientId,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        redirectUris: client.redirectUris,
        grants: client.grants,
      },
      user: {
        username: token.username,
      },
    };
  },

  /**
   * Revoke token
   */
  revokeToken: async (token: OAuth2Server.Token | OAuth2Server.RefreshToken) => {
    const refreshToken = 'refreshToken' in token ? token.refreshToken : undefined;
    if (refreshToken) {
      revokeToken(refreshToken);
    }
    return true;
  },

  /**
   * Verify scope
   */
  verifyScope: async (token: OAuth2Server.Token, scope: string | string[]) => {
    if (!token.scope) {
      return false;
    }

    const requestedScopes = Array.isArray(scope) ? scope : scope.split(' ');
    const tokenScopes = Array.isArray(token.scope) ? token.scope : (token.scope as string).split(' ');

    return requestedScopes.every((s) => tokenScopes.includes(s));
  },

  /**
   * Validate scope
   */
  validateScope: async (user: OAuth2Server.User, client: OAuth2Server.Client, scope?: string[]) => {
    const settings = loadSettings();
    const oauthConfig = settings.systemConfig?.oauthServer;
    const allowedScopes = oauthConfig?.allowedScopes || ['read', 'write'];

    if (!scope || scope.length === 0) {
      return allowedScopes;
    }

    const validScopes = scope.filter((s) => allowedScopes.includes(s));

    return validScopes.length > 0 ? validScopes : false;
  },
};

// Create OAuth2 server instance
let oauth: OAuth2Server | null = null;

/**
 * Initialize OAuth server
 */
export const initOAuthServer = (): void => {
  const settings = loadSettings();
  const oauthConfig = settings.systemConfig?.oauthServer;
  const requireState = oauthConfig?.requireState === true;

  if (!oauthConfig || !oauthConfig.enabled) {
    console.log('OAuth authorization server is disabled or not configured');
    return;
  }

  try {
    oauth = new OAuth2Server({
      model: oauthModel,
      accessTokenLifetime: oauthConfig.accessTokenLifetime || 3600,
      refreshTokenLifetime: oauthConfig.refreshTokenLifetime || 1209600,
      authorizationCodeLifetime: oauthConfig.authorizationCodeLifetime || 300,
      allowEmptyState: !requireState,
      allowBearerTokensInQueryString: false,
      // When requireClientSecret is false, allow PKCE without client secret
      requireClientAuthentication: oauthConfig.requireClientSecret
        ? { authorization_code: true, refresh_token: true }
        : { authorization_code: false, refresh_token: false },
    });

    console.log('OAuth authorization server initialized successfully');
  } catch (error) {
    console.error('Failed to initialize OAuth authorization server:', error);
    oauth = null;
  }
};

/**
 * Get OAuth server instance
 */
export const getOAuthServer = (): OAuth2Server | null => {
  return oauth;
};

/**
 * Check if OAuth server is enabled
 */
export const isOAuthServerEnabled = (): boolean => {
  return oauth !== null;
};

/**
 * Authenticate user for OAuth authorization
 */
export const authenticateUser = async (
  username: string,
  password: string,
): Promise<OAuth2Server.User | null> => {
  const user = findUserByUsername(username);
  if (!user) {
    return null;
  }

  const isValid = await verifyPassword(password, user.password);
  if (!isValid) {
    return null;
  }

  return {
    username: user.username,
    isAdmin: user.isAdmin,
  };
};

/**
 * Generate PKCE code verifier
 */
export const generateCodeVerifier = (): string => {
  return crypto.randomBytes(32).toString('base64url');
};

/**
 * Generate PKCE code challenge from verifier
 */
export const generateCodeChallenge = (verifier: string): string => {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
};

/**
 * Verify PKCE code challenge
 */
export const verifyCodeChallenge = (
  verifier: string,
  challenge: string,
  method: string = 'S256',
): boolean => {
  if (method === 'plain') {
    return verifier === challenge;
  }

  if (method === 'S256') {
    const computed = generateCodeChallenge(verifier);
    return computed === challenge;
  }

  return false;
};

/**
 * Handle OAuth authorize request
 */
export const handleAuthorizeRequest = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<OAuth2Server.AuthorizationCode> => {
  if (!oauth) {
    throw new Error('OAuth server not initialized');
  }

  const request = new Request(req);
  const response = new Response(res);

  return await oauth.authorize(request, response);
};

/**
 * Handle OAuth token request
 */
export const handleTokenRequest = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<OAuth2Server.Token> => {
  if (!oauth) {
    throw new Error('OAuth server not initialized');
  }

  const request = new Request(req);
  const response = new Response(res);

  return await oauth.token(request, response);
};

/**
 * Handle OAuth authenticate request (validate access token)
 */
export const handleAuthenticateRequest = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<OAuth2Server.Token> => {
  if (!oauth) {
    throw new Error('OAuth server not initialized');
  }

  const request = new Request(req);
  const response = new Response(res);

  return await oauth.authenticate(request, response);
};
