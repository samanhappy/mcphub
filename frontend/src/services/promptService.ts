import { apiPost, apiPut } from '../utils/fetchInterceptor';

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
    console.error('Error calling prompt:', error);
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
    const response = await apiPost(
      `/mcp/${server}/prompts/${encodeURIComponent(request.promptName)}`,
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
    console.error('Error getting prompt:', error);
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
    const response = await apiPost<any>(`/servers/${serverName}/prompts/${promptName}/toggle`, {
      enabled,
    });

    return {
      success: response.success,
      error: response.success ? undefined : response.message,
    };
  } catch (error) {
    console.error('Error toggling prompt:', error);
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
    const response = await apiPut<any>(
      `/servers/${serverName}/prompts/${promptName}/description`,
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
    console.error('Error updating prompt description:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};
