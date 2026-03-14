import { apiDelete, apiPost, apiPut } from '../utils/fetchInterceptor';

/**
 * Toggle a resource's enabled state for a specific server
 */
export const toggleResource = async (
  serverName: string,
  resourceUri: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await apiPost<any>(
      `/servers/${encodeURIComponent(serverName)}/resources/${encodeURIComponent(resourceUri)}/toggle`,
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
    console.error('Error toggling resource', { serverName, resourceUri, enabled, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * Update a resource's description for a specific server
 */
export const updateResourceDescription = async (
  serverName: string,
  resourceUri: string,
  description: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await apiPut<any>(
      `/servers/${encodeURIComponent(serverName)}/resources/${encodeURIComponent(resourceUri)}/description`,
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
    console.error('Error updating resource description', { serverName, resourceUri, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

export const resetResourceDescription = async (
  serverName: string,
  resourceUri: string,
): Promise<{ success: boolean; error?: string; description?: string }> => {
  try {
    const response = await apiDelete<any>(
      `/servers/${encodeURIComponent(serverName)}/resources/${encodeURIComponent(resourceUri)}/description`,
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
    console.error('Error resetting resource description', { serverName, resourceUri, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};
