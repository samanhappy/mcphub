import { getApiUrl } from '../utils/runtime';
import { getToken } from './authService';

export interface ToolCallRequest {
  toolName: string;
  arguments?: Record<string, any>;
}

export interface ToolCallResult {
  success: boolean;
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  error?: string;
  message?: string;
}

/**
 * Call a MCP tool via the call_tool API
 */
export const callTool = async (
  request: ToolCallRequest,
  server?: string,
): Promise<ToolCallResult> => {
  try {
    const token = getToken();
    if (!token) {
      throw new Error('Authentication token not found. Please log in.');
    }

    // Construct the URL with optional server parameter
    const url = server ? `/tools/call/${server}` : '/tools/call';

    const response = await fetch(getApiUrl(url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token,
        Authorization: `Bearer ${token}`, // Add bearer auth for MCP routing
      },
      body: JSON.stringify({
        toolName: request.toolName,
        arguments: request.arguments,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      return {
        success: false,
        error: data.message || 'Tool call failed',
      };
    }

    return {
      success: true,
      content: data.data.content || [],
    };
  } catch (error) {
    console.error('Error calling tool:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};
