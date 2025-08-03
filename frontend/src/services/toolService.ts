import { apiPost, apiPut } from '../utils/fetchInterceptor';

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
    // Construct the URL with optional server parameter
    const url = server ? `/tools/call/${server}` : '/tools/call';

    const response = await apiPost<any>(
      url,
      {
        toolName: request.toolName,
        arguments: request.arguments,
      },
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('mcphub_token')}`, // Add bearer auth for MCP routing
        },
      },
    );

    if (!response.success) {
      return {
        success: false,
        error: response.message || 'Tool call failed',
      };
    }

    return {
      success: true,
      content: response.data?.content || [],
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
    const response = await apiPost<any>(
      `/servers/${serverName}/tools/${toolName}/toggle`,
      { enabled },
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('mcphub_token')}`,
        },
      },
    );

    return {
      success: response.success,
      error: response.success ? undefined : response.message,
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
    const response = await apiPut<any>(
      `/servers/${serverName}/tools/${toolName}/description`,
      { description },
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('mcphub_token')}`,
        },
      },
    );

    return {
      success: response.success,
      error: response.success ? undefined : response.message,
    };
  } catch (error) {
    console.error('Error updating tool description:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};
