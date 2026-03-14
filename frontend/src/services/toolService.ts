import { apiDelete, apiPost, apiPut } from '../utils/fetchInterceptor';

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
    // URL-encode server and tool names to handle slashes in names (e.g., "com.atlassian/atlassian-mcp-server")
    const url = server
      ? `/tools/${encodeURIComponent(server)}/${encodeURIComponent(request.toolName)}`
      : '/tools/call';

    const response = await apiPost<any>(url, request.arguments, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('mcphub_token')}`, // Add bearer auth for MCP routing
      },
    });

    if (response.success === false) {
      return {
        success: false,
        error: response.message || 'Tool call failed',
      };
    }

    return {
      success: true,
      content: response?.content || [],
    };
  } catch (error) {
    console.error('Error calling tool', { toolName: request.toolName, server, error });
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
    // URL-encode server and tool names to handle slashes (e.g., "com.atlassian/atlassian-mcp-server")
    const response = await apiPost<any>(
      `/servers/${encodeURIComponent(serverName)}/tools/${encodeURIComponent(toolName)}/toggle`,
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
    console.error('Error toggling tool', { serverName, toolName, enabled, error });
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
    // URL-encode server and tool names to handle slashes (e.g., "com.atlassian/atlassian-mcp-server")
    const response = await apiPut<any>(
      `/servers/${encodeURIComponent(serverName)}/tools/${encodeURIComponent(toolName)}/description`,
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
    console.error('Error updating tool description', { serverName, toolName, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * Reset a tool's description override for a specific server
 */
export const resetToolDescription = async (
  serverName: string,
  toolName: string,
): Promise<{ success: boolean; error?: string; description?: string }> => {
  try {
    const response = await apiDelete<any>(
      `/servers/${encodeURIComponent(serverName)}/tools/${encodeURIComponent(toolName)}/description`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('mcphub_token')}`,
        },
      },
    );

    return {
      success: response.success,
      error: response.success ? undefined : response.message,
      description: response.data?.description,
    };
  } catch (error) {
    console.error('Error resetting tool description', { serverName, toolName, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};
