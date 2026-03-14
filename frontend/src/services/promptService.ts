import { apiDelete, apiPost, apiPut } from '../utils/fetchInterceptor';

export interface PromptCallRequest {
  promptName: string;
  arguments?: Record<string, any>;
}

export interface PromptCallResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

// GetPrompt result types
export interface GetPromptResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Call a MCP prompt via the call_prompt API
 */
export const callPrompt = async (
  request: PromptCallRequest,
  server?: string,
): Promise<PromptCallResult> => {
  try {
    // Construct the URL with optional server parameter
    const url = server ? `/prompts/call/${server}` : '/prompts/call';
    const response = await apiPost<any>(url, {
      promptName: request.promptName,
      arguments: request.arguments,
    });

    if (!response.success) {
      return {
        success: false,
        error: response.message || 'Prompt call failed',
      };
    }

    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    console.error('Error calling prompt', { promptName: request.promptName, server, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

export const getPrompt = async (
  request: PromptCallRequest,
  server?: string,
): Promise<GetPromptResult> => {
  try {
    // URL-encode server and prompt names to handle slashes (e.g., "com.atlassian/atlassian-mcp-server")
    const response = await apiPost(
      `/mcp/${encodeURIComponent(server || '')}/prompts/${encodeURIComponent(request.promptName)}`,
      {
        name: request.promptName,
        arguments: request.arguments,
      },
    );

    // apiPost already returns parsed data, not a Response object
    if (!response.success) {
      throw new Error(`Failed to get prompt: ${response.message || 'Unknown error'}`);
    }

    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    console.error('Error getting prompt', { promptName: request.promptName, server, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * Toggle a prompt's enabled state for a specific server
 */
export const togglePrompt = async (
  serverName: string,
  promptName: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> => {
  try {
    // URL-encode server and prompt names to handle slashes (e.g., "com.atlassian/atlassian-mcp-server")
    const response = await apiPost<any>(
      `/servers/${encodeURIComponent(serverName)}/prompts/${encodeURIComponent(promptName)}/toggle`,
      {
        enabled,
      },
    );

    return {
      success: response.success,
      error: response.success ? undefined : response.message,
    };
  } catch (error) {
    console.error('Error toggling prompt', { serverName, promptName, enabled, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * Update a prompt's description for a specific server
 */
export const updatePromptDescription = async (
  serverName: string,
  promptName: string,
  description: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    // URL-encode server and prompt names to handle slashes (e.g., "com.atlassian/atlassian-mcp-server")
    const response = await apiPut<any>(
      `/servers/${encodeURIComponent(serverName)}/prompts/${encodeURIComponent(promptName)}/description`,
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
    console.error('Error updating prompt description', { serverName, promptName, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

export const resetPromptDescription = async (
  serverName: string,
  promptName: string,
): Promise<{ success: boolean; error?: string; description?: string }> => {
  try {
    const response = await apiDelete<any>(
      `/servers/${encodeURIComponent(serverName)}/prompts/${encodeURIComponent(promptName)}/description`,
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
    console.error('Error resetting prompt description', { serverName, promptName, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};
