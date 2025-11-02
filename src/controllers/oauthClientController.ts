import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import crypto from 'crypto';
import {
  getOAuthClients,
  findOAuthClientById,
  createOAuthClient,
  updateOAuthClient,
  deleteOAuthClient,
} from '../models/OAuth.js';
import { IOAuthClient } from '../types/index.js';

/**
 * GET /api/oauth/clients
 * Get all OAuth clients
 */
export const getAllClients = (req: Request, res: Response): void => {
  try {
    const clients = getOAuthClients();
    
    // Don't expose client secrets in the list
    const sanitizedClients = clients.map((client) => ({
      clientId: client.clientId,
      name: client.name,
      redirectUris: client.redirectUris,
      grants: client.grants,
      scopes: client.scopes,
      owner: client.owner,
    }));

    res.json({
      success: true,
      clients: sanitizedClients,
    });
  } catch (error) {
    console.error('Get OAuth clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve OAuth clients',
    });
  }
};

/**
 * GET /api/oauth/clients/:clientId
 * Get a specific OAuth client
 */
export const getClient = (req: Request, res: Response): void => {
  try {
    const { clientId } = req.params;
    const client = findOAuthClientById(clientId);

    if (!client) {
      res.status(404).json({
        success: false,
        message: 'OAuth client not found',
      });
      return;
    }

    // Don't expose client secret
    const sanitizedClient = {
      clientId: client.clientId,
      name: client.name,
      redirectUris: client.redirectUris,
      grants: client.grants,
      scopes: client.scopes,
      owner: client.owner,
    };

    res.json({
      success: true,
      client: sanitizedClient,
    });
  } catch (error) {
    console.error('Get OAuth client error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve OAuth client',
    });
  }
};

/**
 * POST /api/oauth/clients
 * Create a new OAuth client
 */
export const createClient = (req: Request, res: Response): void => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
      return;
    }

    const { name, redirectUris, grants, scopes, requireSecret } = req.body;
    const user = (req as any).user;

    // Generate client ID
    const clientId = crypto.randomBytes(16).toString('hex');

    // Generate client secret if required
    const clientSecret = requireSecret !== false ? crypto.randomBytes(32).toString('hex') : undefined;

    // Create client
    const client: IOAuthClient = {
      clientId,
      clientSecret,
      name,
      redirectUris: Array.isArray(redirectUris) ? redirectUris : [redirectUris],
      grants: grants || ['authorization_code', 'refresh_token'],
      scopes: scopes || ['read', 'write'],
      owner: user?.username || 'admin',
    };

    const createdClient = createOAuthClient(client);

    // Return client with secret (only shown once)
    res.status(201).json({
      success: true,
      message: 'OAuth client created successfully',
      client: {
        clientId: createdClient.clientId,
        clientSecret: createdClient.clientSecret,
        name: createdClient.name,
        redirectUris: createdClient.redirectUris,
        grants: createdClient.grants,
        scopes: createdClient.scopes,
        owner: createdClient.owner,
      },
      warning: clientSecret
        ? 'Client secret is only shown once. Please save it securely.'
        : undefined,
    });
  } catch (error) {
    console.error('Create OAuth client error:', error);
    
    if (error instanceof Error && error.message.includes('already exists')) {
      res.status(409).json({
        success: false,
        message: error.message,
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to create OAuth client',
      });
    }
  }
};

/**
 * PUT /api/oauth/clients/:clientId
 * Update an OAuth client
 */
export const updateClient = (req: Request, res: Response): void => {
  try {
    const { clientId } = req.params;
    const { name, redirectUris, grants, scopes } = req.body;

    const updates: Partial<IOAuthClient> = {};
    if (name) updates.name = name;
    if (redirectUris) updates.redirectUris = Array.isArray(redirectUris) ? redirectUris : [redirectUris];
    if (grants) updates.grants = grants;
    if (scopes) updates.scopes = scopes;

    const updatedClient = updateOAuthClient(clientId, updates);

    if (!updatedClient) {
      res.status(404).json({
        success: false,
        message: 'OAuth client not found',
      });
      return;
    }

    // Don't expose client secret
    res.json({
      success: true,
      message: 'OAuth client updated successfully',
      client: {
        clientId: updatedClient.clientId,
        name: updatedClient.name,
        redirectUris: updatedClient.redirectUris,
        grants: updatedClient.grants,
        scopes: updatedClient.scopes,
        owner: updatedClient.owner,
      },
    });
  } catch (error) {
    console.error('Update OAuth client error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update OAuth client',
    });
  }
};

/**
 * DELETE /api/oauth/clients/:clientId
 * Delete an OAuth client
 */
export const deleteClient = (req: Request, res: Response): void => {
  try {
    const { clientId } = req.params;
    const deleted = deleteOAuthClient(clientId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'OAuth client not found',
      });
      return;
    }

    res.json({
      success: true,
      message: 'OAuth client deleted successfully',
    });
  } catch (error) {
    console.error('Delete OAuth client error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete OAuth client',
    });
  }
};

/**
 * POST /api/oauth/clients/:clientId/regenerate-secret
 * Regenerate client secret
 */
export const regenerateSecret = (req: Request, res: Response): void => {
  try {
    const { clientId } = req.params;
    const client = findOAuthClientById(clientId);

    if (!client) {
      res.status(404).json({
        success: false,
        message: 'OAuth client not found',
      });
      return;
    }

    // Generate new secret
    const newSecret = crypto.randomBytes(32).toString('hex');
    const updatedClient = updateOAuthClient(clientId, { clientSecret: newSecret });

    if (!updatedClient) {
      res.status(500).json({
        success: false,
        message: 'Failed to regenerate client secret',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Client secret regenerated successfully',
      clientSecret: newSecret,
      warning: 'Client secret is only shown once. Please save it securely.',
    });
  } catch (error) {
    console.error('Regenerate secret error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate client secret',
    });
  }
};
