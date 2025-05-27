/**
 * API utility functions for constructing URLs with proper base path support
 *
 * @deprecated Use functions from utils/runtime.ts instead for runtime configuration support
 */

import { getApiBaseUrl as getRuntimeApiBaseUrl, getApiUrl as getRuntimeApiUrl } from './runtime';

/**
 * Get the API base URL including base path and /api prefix
 * @returns The complete API base URL
 * @deprecated Use getApiBaseUrl from utils/runtime.ts instead
 */
export const getApiBaseUrl = (): string => {
  console.warn('getApiBaseUrl from utils/api.ts is deprecated, use utils/runtime.ts instead');
  return getRuntimeApiBaseUrl();
};

/**
 * Construct a full API URL with the given endpoint
 * @param endpoint - The API endpoint (should start with /, e.g., '/auth/login')
 * @returns The complete API URL
 * @deprecated Use getApiUrl from utils/runtime.ts instead
 */
export const getApiUrl = (endpoint: string): string => {
  console.warn('getApiUrl from utils/api.ts is deprecated, use utils/runtime.ts instead');
  return getRuntimeApiUrl(endpoint);
};
