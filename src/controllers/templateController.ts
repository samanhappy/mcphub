import { Request, Response } from 'express';
import { ApiResponse, TemplateExportOptions } from '../types/index.js';
import {
  exportTemplate,
  exportGroupTemplate,
  importTemplate,
} from '../services/templateService.js';

// Export full configuration template
export const exportConfigTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, groupIds, includeDisabledServers } = req.body as TemplateExportOptions;

    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Template name is required',
      } as ApiResponse);
      return;
    }

    const template = await exportTemplate({
      name,
      description,
      groupIds,
      includeDisabledServers: includeDisabledServers ?? false,
    });

    res.json({
      success: true,
      data: template,
    } as ApiResponse);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to export configuration template',
    } as ApiResponse);
  }
};

// Export a single group as template
export const exportGroupAsTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.query;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      } as ApiResponse);
      return;
    }

    const template = await exportGroupTemplate(id, name as string | undefined);

    if (!template) {
      res.status(404).json({
        success: false,
        message: 'Group not found',
      } as ApiResponse);
      return;
    }

    res.json({
      success: true,
      data: template,
    } as ApiResponse);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to export group template',
    } as ApiResponse);
  }
};

// Import a configuration template
export const importConfigTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const template = req.body;

    if (!template || typeof template !== 'object') {
      res.status(400).json({
        success: false,
        message: 'Template data is required in request body',
      } as ApiResponse);
      return;
    }

    const currentUser = (req as any).user;
    const owner = currentUser?.username || 'admin';

    const result = await importTemplate(template, owner);

    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json({
      success: result.success,
      data: result,
      message: result.success
        ? `Imported ${result.serversCreated} servers and ${result.groupsCreated} groups`
        : 'Import failed - no items were created',
    } as ApiResponse);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to import configuration template',
    } as ApiResponse);
  }
};
