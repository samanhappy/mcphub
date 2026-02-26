import { Request, Response } from 'express';
import { ApiResponse, BuiltinResource } from '../types/index.js';
import { getBuiltinResourceDao } from '../dao/index.js';
import { handleReadResourceRequest } from '../services/mcpService.js';

/**
 * List all built-in resources
 */
export const listBuiltinResources = async (_req: Request, res: Response): Promise<void> => {
  try {
    const resources = await getBuiltinResourceDao().findAll();
    const response: ApiResponse<BuiltinResource[]> = {
      success: true,
      data: resources,
    };
    res.json(response);
  } catch (error) {
    console.error('Error listing built-in resources:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to list built-in resources',
    });
  }
};

/**
 * Get a single built-in resource by ID
 */
export const getBuiltinResource = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const resource = await getBuiltinResourceDao().findById(id);
    if (!resource) {
      res.status(404).json({ success: false, message: 'Built-in resource not found' });
      return;
    }
    const response: ApiResponse<BuiltinResource> = { success: true, data: resource };
    res.json(response);
  } catch (error) {
    console.error('Error getting built-in resource:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get built-in resource',
    });
  }
};

/**
 * Create a new built-in resource
 */
export const createBuiltinResource = async (req: Request, res: Response): Promise<void> => {
  try {
    const { uri, name, description, mimeType, content, enabled } = req.body;
    if (!uri || !content) {
      res.status(400).json({ success: false, message: 'uri and content are required' });
      return;
    }
    const resource = await getBuiltinResourceDao().create({
      uri,
      name,
      description,
      mimeType: mimeType || 'text/plain',
      content,
      enabled: enabled !== false,
    });
    const response: ApiResponse<BuiltinResource> = { success: true, data: resource };
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating built-in resource:', error);
    const status = error instanceof Error && error.message.includes('already exists') ? 409 : 500;
    res.status(status).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create built-in resource',
    });
  }
};

/**
 * Update an existing built-in resource
 */
export const updateBuiltinResource = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const resource = await getBuiltinResourceDao().update(id, updates);
    if (!resource) {
      res.status(404).json({ success: false, message: 'Built-in resource not found' });
      return;
    }
    const response: ApiResponse<BuiltinResource> = { success: true, data: resource };
    res.json(response);
  } catch (error) {
    console.error('Error updating built-in resource:', error);
    const status = error instanceof Error && error.message.includes('already exists') ? 409 : 500;
    res.status(status).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update built-in resource',
    });
  }
};

/**
 * Delete a built-in resource
 */
export const deleteBuiltinResource = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await getBuiltinResourceDao().delete(id);
    if (!deleted) {
      res.status(404).json({ success: false, message: 'Built-in resource not found' });
      return;
    }
    res.json({ success: true, message: 'Built-in resource deleted' });
  } catch (error) {
    console.error('Error deleting built-in resource:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to delete built-in resource',
    });
  }
};

/**
 * Read a resource by URI (built-in or from a connected MCP server)
 */
export const readResource = async (req: Request, res: Response): Promise<void> => {
  try {
    const { uri } = req.body;
    if (!uri) {
      res.status(400).json({ success: false, message: 'uri is required' });
      return;
    }
    const result = await handleReadResourceRequest({ params: { uri } }, {});
    const response: ApiResponse = { success: true, data: result };
    res.json(response);
  } catch (error) {
    console.error('Error reading resource:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to read resource',
    });
  }
};
