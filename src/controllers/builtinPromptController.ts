import { Request, Response } from 'express';
import { ApiResponse, BuiltinPrompt } from '../types/index.js';
import { getBuiltinPromptDao } from '../dao/index.js';

/**
 * List all built-in prompts
 */
export const listBuiltinPrompts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prompts = await getBuiltinPromptDao().findAll();
    const response: ApiResponse<BuiltinPrompt[]> = {
      success: true,
      data: prompts,
    };
    res.json(response);
  } catch (error) {
    console.error('Error listing built-in prompts:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to list built-in prompts',
    });
  }
};

/**
 * Get a single built-in prompt by ID
 */
export const getBuiltinPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const prompt = await getBuiltinPromptDao().findById(id);
    if (!prompt) {
      res.status(404).json({ success: false, message: 'Built-in prompt not found' });
      return;
    }
    const response: ApiResponse<BuiltinPrompt> = { success: true, data: prompt };
    res.json(response);
  } catch (error) {
    console.error('Error getting built-in prompt:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get built-in prompt',
    });
  }
};

/**
 * Create a new built-in prompt
 */
export const createBuiltinPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, title, description, template, arguments: args, enabled } = req.body;
    if (!name || !template) {
      res.status(400).json({ success: false, message: 'name and template are required' });
      return;
    }
    const prompt = await getBuiltinPromptDao().create({
      name,
      title,
      description,
      template,
      arguments: args,
      enabled: enabled !== false,
    });
    const response: ApiResponse<BuiltinPrompt> = { success: true, data: prompt };
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating built-in prompt:', error);
    const status = error instanceof Error && error.message.includes('already exists') ? 409 : 500;
    res.status(status).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create built-in prompt',
    });
  }
};

/**
 * Update an existing built-in prompt
 */
export const updateBuiltinPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const prompt = await getBuiltinPromptDao().update(id, updates);
    if (!prompt) {
      res.status(404).json({ success: false, message: 'Built-in prompt not found' });
      return;
    }
    const response: ApiResponse<BuiltinPrompt> = { success: true, data: prompt };
    res.json(response);
  } catch (error) {
    console.error('Error updating built-in prompt:', error);
    const status = error instanceof Error && error.message.includes('already exists') ? 409 : 500;
    res.status(status).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update built-in prompt',
    });
  }
};

/**
 * Delete a built-in prompt
 */
export const deleteBuiltinPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await getBuiltinPromptDao().delete(id);
    if (!deleted) {
      res.status(404).json({ success: false, message: 'Built-in prompt not found' });
      return;
    }
    res.json({ success: true, message: 'Built-in prompt deleted' });
  } catch (error) {
    console.error('Error deleting built-in prompt:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to delete built-in prompt',
    });
  }
};
