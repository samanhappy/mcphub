import { Request, Response } from 'express';
import { ApiResponse } from '../types/index.js';
import { handleCallToolRequest } from '../services/mcpService.js';

/**
 * Interface for tool call request
 */
export interface ToolCallRequest {
  toolName: string;
  arguments?: Record<string, any>;
}

/**
 * Interface for tool search request
 */
export interface ToolSearchRequest {
  query: string;
  limit?: number;
}

/**
 * Interface for tool call result
 */
interface ToolCallResult {
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
  [key: string]: any;
}

/**
 * Call a specific tool with given arguments
 */
export const callTool = async (req: Request, res: Response): Promise<void> => {
  try {
    const { server } = req.params;
    const { toolName, arguments: toolArgs = {} } = req.body as ToolCallRequest;

    if (!toolName) {
      res.status(400).json({
        success: false,
        message: 'toolName is required',
      });
      return;
    }

    // Create a mock request structure for handleCallToolRequest
    const mockRequest = {
      params: {
        name: 'call_tool',
        arguments: {
          toolName,
          arguments: toolArgs,
        },
      },
    };

    const extra = {
      sessionId: req.headers['x-session-id'] || 'api-session',
      server: server || undefined,
    };

    const result = (await handleCallToolRequest(mockRequest, extra)) as ToolCallResult;

    const response: ApiResponse = {
      success: true,
      data: {
        content: result.content || [],
        toolName,
        arguments: toolArgs,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Error calling tool:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to call tool',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
};
