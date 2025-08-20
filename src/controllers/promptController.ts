import { Request, Response } from 'express';
import { ApiResponse } from '../types/index.js';
import { handleGetPromptRequest } from '../services/mcpService.js';

/**
 * Get a specific prompt by server and prompt name
 */
export const getPrompt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { serverName, promptName } = req.params;
    if (!serverName || !promptName) {
      res.status(400).json({
        success: false,
        message: 'serverName and promptName are required',
      });
      return;
    }

    const promptArgs = {
      params: req.body as { [key: string]: any }
    };
    const result = await handleGetPromptRequest(promptArgs, serverName);
    if (result.isError) {
      res.status(500).json({
        success: false,
        message: 'Failed to get prompt',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: result,
    };

    res.json(response);
  } catch (error) {
    console.error('Error getting prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get prompt',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
};
