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
    // Construct the URL with optional server parameter
    const url = server ? `/tools/call/${server}` : '/tools/call';

    const response = await fetch(getApiUrl(url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token || '', // Include token for authentication
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

/**
 * Toggle a tool's enabled state for a specific server
 */
export const toggleTool = async (
  serverName: string,
  toolName: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const token = getToken();
    const response = await fetch(getApiUrl(`/servers/${serverName}/tools/${toolName}/toggle`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token || '',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      success: data.success,
      error: data.success ? undefined : data.message,
    };
  } catch (error) {
    console.error('Error toggling tool:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * Update a tool's description for a specific server
 */
export const updateToolDescription = async (
  serverName: string,
  toolName: string,
  description: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const token = getToken();
    const response = await fetch(
      getApiUrl(`/servers/${serverName}/tools/${toolName}/description`),
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || '',
          Authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ description }),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      success: data.success,
      error: data.success ? undefined : data.message,
    };
  } catch (error) {
    console.error('Error updating tool description:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};
