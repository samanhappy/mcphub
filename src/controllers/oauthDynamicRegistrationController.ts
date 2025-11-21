import { Request, Response } from 'express';
import crypto from 'crypto';
import {
  createOAuthClient,
  findOAuthClientById,
  updateOAuthClient,
  deleteOAuthClient,
} from '../models/OAuth.js';
import { IOAuthClient } from '../types/index.js';
import { loadSettings } from '../config/index.js';

// Store registration access tokens (in production, use database)
const registrationTokens = new Map<string, { clientId: string; createdAt: Date }>();

/**
 * Generate registration access token
 */
const generateRegistrationToken = (clientId: string): string => {
  const token = crypto.randomBytes(32).toString('hex');
  registrationTokens.set(token, {
    clientId,
    createdAt: new Date(),
  });
  return token;
};

/**
 * Verify registration access token
 */
const verifyRegistrationToken = (token: string): string | null => {
  const data = registrationTokens.get(token);
  if (!data) {
    return null;
  }

  // Token expires after 30 days
  const expiresAt = new Date(data.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (new Date() > expiresAt) {
    registrationTokens.delete(token);
    return null;
  }

  return data.clientId;
};

/**
 * POST /oauth/register
 * RFC 7591 Dynamic Client Registration
 * Public endpoint for registering new OAuth clients
 */
export const registerClient = (req: Request, res: Response): void => {
  try {
    const settings = loadSettings();
    const oauthConfig = settings.systemConfig?.oauthServer;

    // Check if dynamic registration is enabled
    if (!oauthConfig?.dynamicRegistration?.enabled) {
      res.status(403).json({
        error: 'invalid_request',
        error_description: 'Dynamic client registration is not enabled',
      });
      return;
    }

    // Validate required fields
    const {
      redirect_uris,
      client_name,
      grant_types,
      response_types,
      scope,
      token_endpoint_auth_method,
      application_type,
      contacts,
      logo_uri,
      client_uri,
      policy_uri,
      tos_uri,
      jwks_uri,
      jwks,
    } = req.body;

    // redirect_uris is required
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required and must be a non-empty array',
      });
      return;
    }

    // Validate redirect URIs
    for (const uri of redirect_uris) {
      try {
        const url = new URL(uri);
        // For security, only allow https (except localhost for development)
        if (
          url.protocol !== 'https:' &&
          !url.hostname.match(/^(localhost|127\.0\.0\.1|\[::1\])$/)
        ) {
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: `Redirect URI must use HTTPS: ${uri}`,
          });
          return;
        }
      } catch (e) {
        res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: `Invalid redirect URI: ${uri}`,
        });
        return;
      }
    }

    // Generate client credentials
    const clientId = crypto.randomBytes(16).toString('hex');

    // Determine if client secret is needed based on token_endpoint_auth_method
    const authMethod = token_endpoint_auth_method || 'client_secret_basic';
    const needsSecret = authMethod !== 'none';
    const clientSecret = needsSecret ? crypto.randomBytes(32).toString('hex') : undefined;

    // Default grant types
    const defaultGrantTypes = ['authorization_code', 'refresh_token'];
    const clientGrantTypes = grant_types || defaultGrantTypes;

    // Validate grant types
    const allowedGrantTypes = oauthConfig.dynamicRegistration.allowedGrantTypes || [
      'authorization_code',
      'refresh_token',
    ];
    for (const grantType of clientGrantTypes) {
      if (!allowedGrantTypes.includes(grantType)) {
        res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: `Grant type not allowed: ${grantType}`,
        });
        return;
      }
    }

    // Validate scopes
    const requestedScopes = scope ? scope.split(' ') : ['read', 'write'];
    const allowedScopes = oauthConfig.allowedScopes || ['read', 'write'];
    for (const requestedScope of requestedScopes) {
      if (!allowedScopes.includes(requestedScope)) {
        res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: `Scope not allowed: ${requestedScope}`,
        });
        return;
      }
    }

    // Generate registration access token
    const registrationAccessToken = generateRegistrationToken(clientId);
    const baseUrl =
      settings.systemConfig?.install?.baseUrl || `${req.protocol}://${req.get('host')}`;
    const registrationClientUri = `${baseUrl}/oauth/register/${clientId}`;

    // Create OAuth client
    const client: IOAuthClient = {
      clientId,
      clientSecret,
      name: client_name || 'Dynamically Registered Client',
      redirectUris: redirect_uris,
      grants: clientGrantTypes,
      scopes: requestedScopes,
      owner: 'dynamic-registration',
      // Store additional metadata
      metadata: {
        application_type: application_type || 'web',
        contacts,
        logo_uri,
        client_uri,
        policy_uri,
        tos_uri,
        jwks_uri,
        jwks,
        token_endpoint_auth_method: authMethod,
        response_types: response_types || ['code'],
      },
    };

    const createdClient = createOAuthClient(client);

    // Build response according to RFC 7591
    const response: any = {
      client_id: createdClient.clientId,
      client_name: createdClient.name,
      redirect_uris: createdClient.redirectUris,
      grant_types: createdClient.grants,
      response_types: client.metadata?.response_types || ['code'],
      scope: (createdClient.scopes || []).join(' '),
      token_endpoint_auth_method: authMethod,
      registration_access_token: registrationAccessToken,
      registration_client_uri: registrationClientUri,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };

    // Include client secret if generated
    if (clientSecret) {
      response.client_secret = clientSecret;
      response.client_secret_expires_at = 0; // 0 means it doesn't expire
    }

    // Include optional metadata
    if (application_type) response.application_type = application_type;
    if (contacts) response.contacts = contacts;
    if (logo_uri) response.logo_uri = logo_uri;
    if (client_uri) response.client_uri = client_uri;
    if (policy_uri) response.policy_uri = policy_uri;
    if (tos_uri) response.tos_uri = tos_uri;
    if (jwks_uri) response.jwks_uri = jwks_uri;
    if (jwks) response.jwks = jwks;

    res.status(201).json(response);
  } catch (error) {
    console.error('Dynamic client registration error:', error);

    if (error instanceof Error && error.message.includes('already exists')) {
      res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'Client with this ID already exists',
      });
    } else {
      res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to register client',
      });
    }
  }
};

/**
 * GET /oauth/register/:clientId
 * RFC 7591 Client Configuration Endpoint
 * Read client configuration
 */
export const getClientConfiguration = (req: Request, res: Response): void => {
  try {
    const { clientId } = req.params;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Registration access token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const tokenClientId = verifyRegistrationToken(token);

    if (!tokenClientId || tokenClientId !== clientId) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Invalid or expired registration access token',
      });
      return;
    }

    const client = findOAuthClientById(clientId);
    if (!client) {
      res.status(404).json({
        error: 'invalid_client',
        error_description: 'Client not found',
      });
      return;
    }

    // Build response
    const response: any = {
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: client.grants,
      response_types: client.metadata?.response_types || ['code'],
      scope: (client.scopes || []).join(' '),
      token_endpoint_auth_method:
        client.metadata?.token_endpoint_auth_method || 'client_secret_basic',
    };

    // Include optional metadata
    if (client.metadata) {
      if (client.metadata.application_type)
        response.application_type = client.metadata.application_type;
      if (client.metadata.contacts) response.contacts = client.metadata.contacts;
      if (client.metadata.logo_uri) response.logo_uri = client.metadata.logo_uri;
      if (client.metadata.client_uri) response.client_uri = client.metadata.client_uri;
      if (client.metadata.policy_uri) response.policy_uri = client.metadata.policy_uri;
      if (client.metadata.tos_uri) response.tos_uri = client.metadata.tos_uri;
      if (client.metadata.jwks_uri) response.jwks_uri = client.metadata.jwks_uri;
      if (client.metadata.jwks) response.jwks = client.metadata.jwks;
    }

    res.json(response);
  } catch (error) {
    console.error('Get client configuration error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to retrieve client configuration',
    });
  }
};

/**
 * PUT /oauth/register/:clientId
 * RFC 7591 Client Update Endpoint
 * Update client configuration
 */
export const updateClientConfiguration = (req: Request, res: Response): void => {
  try {
    const { clientId } = req.params;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Registration access token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const tokenClientId = verifyRegistrationToken(token);

    if (!tokenClientId || tokenClientId !== clientId) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Invalid or expired registration access token',
      });
      return;
    }

    const client = findOAuthClientById(clientId);
    if (!client) {
      res.status(404).json({
        error: 'invalid_client',
        error_description: 'Client not found',
      });
      return;
    }

    const {
      redirect_uris,
      client_name,
      grant_types,
      scope,
      contacts,
      logo_uri,
      client_uri,
      policy_uri,
      tos_uri,
    } = req.body;

    const settings = loadSettings();
    const oauthConfig = settings.systemConfig?.oauthServer;

    // Validate redirect URIs if provided
    if (redirect_uris) {
      if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
        res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: 'redirect_uris must be a non-empty array',
        });
        return;
      }

      for (const uri of redirect_uris) {
        try {
          const url = new URL(uri);
          if (
            url.protocol !== 'https:' &&
            !url.hostname.match(/^(localhost|127\.0\.0\.1|\[::1\])$/)
          ) {
            res.status(400).json({
              error: 'invalid_redirect_uri',
              error_description: `Redirect URI must use HTTPS: ${uri}`,
            });
            return;
          }
        } catch (e) {
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: `Invalid redirect URI: ${uri}`,
          });
          return;
        }
      }
    }

    // Validate grant types if provided
    if (grant_types) {
      const allowedGrantTypes = oauthConfig?.dynamicRegistration?.allowedGrantTypes || [
        'authorization_code',
        'refresh_token',
      ];
      for (const grantType of grant_types) {
        if (!allowedGrantTypes.includes(grantType)) {
          res.status(400).json({
            error: 'invalid_client_metadata',
            error_description: `Grant type not allowed: ${grantType}`,
          });
          return;
        }
      }
    }

    // Validate scopes if provided
    if (scope) {
      const requestedScopes = scope.split(' ');
      const allowedScopes = oauthConfig?.allowedScopes || ['read', 'write'];
      for (const requestedScope of requestedScopes) {
        if (!allowedScopes.includes(requestedScope)) {
          res.status(400).json({
            error: 'invalid_client_metadata',
            error_description: `Scope not allowed: ${requestedScope}`,
          });
          return;
        }
      }
    }

    // Build updates
    const updates: Partial<IOAuthClient> = {};
    if (client_name) updates.name = client_name;
    if (redirect_uris) updates.redirectUris = redirect_uris;
    if (grant_types) updates.grants = grant_types;
    if (scope) updates.scopes = scope.split(' ');

    // Update metadata
    if (client.metadata || contacts || logo_uri || client_uri || policy_uri || tos_uri) {
      updates.metadata = {
        ...client.metadata,
        contacts,
        logo_uri,
        client_uri,
        policy_uri,
        tos_uri,
      };
    }

    const updatedClient = updateOAuthClient(clientId, updates);

    if (!updatedClient) {
      res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to update client',
      });
      return;
    }

    // Build response
    const response: any = {
      client_id: updatedClient.clientId,
      client_name: updatedClient.name,
      redirect_uris: updatedClient.redirectUris,
      grant_types: updatedClient.grants,
      response_types: updatedClient.metadata?.response_types || ['code'],
      scope: (updatedClient.scopes || []).join(' '),
      token_endpoint_auth_method:
        updatedClient.metadata?.token_endpoint_auth_method || 'client_secret_basic',
    };

    // Include optional metadata
    if (updatedClient.metadata) {
      if (updatedClient.metadata.application_type)
        response.application_type = updatedClient.metadata.application_type;
      if (updatedClient.metadata.contacts) response.contacts = updatedClient.metadata.contacts;
      if (updatedClient.metadata.logo_uri) response.logo_uri = updatedClient.metadata.logo_uri;
      if (updatedClient.metadata.client_uri)
        response.client_uri = updatedClient.metadata.client_uri;
      if (updatedClient.metadata.policy_uri)
        response.policy_uri = updatedClient.metadata.policy_uri;
      if (updatedClient.metadata.tos_uri) response.tos_uri = updatedClient.metadata.tos_uri;
      if (updatedClient.metadata.jwks_uri) response.jwks_uri = updatedClient.metadata.jwks_uri;
      if (updatedClient.metadata.jwks) response.jwks = updatedClient.metadata.jwks;
    }

    res.json(response);
  } catch (error) {
    console.error('Update client configuration error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to update client configuration',
    });
  }
};

/**
 * DELETE /oauth/register/:clientId
 * RFC 7591 Client Delete Endpoint
 * Delete client registration
 */
export const deleteClientRegistration = (req: Request, res: Response): void => {
  try {
    const { clientId } = req.params;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Registration access token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const tokenClientId = verifyRegistrationToken(token);

    if (!tokenClientId || tokenClientId !== clientId) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Invalid or expired registration access token',
      });
      return;
    }

    const deleted = deleteOAuthClient(clientId);

    if (!deleted) {
      res.status(404).json({
        error: 'invalid_client',
        error_description: 'Client not found',
      });
      return;
    }

    // Clean up registration token
    registrationTokens.delete(token);

    res.status(204).send();
  } catch (error) {
    console.error('Delete client registration error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to delete client registration',
    });
  }
};
