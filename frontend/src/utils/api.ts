/**
 * API utility functions for constructing URLs with proper base path support
 */

/**
 * Get the API base URL including base path and /api prefix
 * @returns The complete API base URL
 */
export const getApiBaseUrl = (): string => {
  const basePath = import.meta.env.BASE_PATH || '';
  // Ensure the path starts with / if it's not empty and doesn't already start with /
  const normalizedBasePath = basePath && !basePath.startsWith('/') ? '/' + basePath : basePath;
  // Always append /api to the base path for API endpoints
  return normalizedBasePath + '/api';
};

/**
 * Construct a full API URL with the given endpoint
 * @param endpoint - The API endpoint (should start with /, e.g., '/auth/login')
 * @returns The complete API URL
 */
export const getApiUrl = (endpoint: string): string => {
  const baseUrl = getApiBaseUrl();
  // Ensure endpoint starts with /
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  return baseUrl + normalizedEndpoint;
};
