import { BuiltinResource, ApiResponse } from '@/types';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/fetchInterceptor';

/**
 * Get all built-in resources
 */
export const getBuiltinResources = async (): Promise<BuiltinResource[]> => {
  const response: ApiResponse<BuiltinResource[]> = await apiGet('/resources');
  if (!response.success) {
    throw new Error(response.message || 'Failed to fetch built-in resources');
  }
  return response.data || [];
};

/**
 * Get a single built-in resource by ID
 */
export const getBuiltinResourceById = async (id: string): Promise<BuiltinResource> => {
  const response: ApiResponse<BuiltinResource> = await apiGet(`/resources/${id}`);
  if (!response.success) {
    throw new Error(response.message || 'Failed to fetch built-in resource');
  }
  return response.data!;
};

/**
 * Create a new built-in resource
 */
export const createBuiltinResource = async (
  resource: Omit<BuiltinResource, 'id'>,
): Promise<BuiltinResource> => {
  const response: ApiResponse<BuiltinResource> = await apiPost('/resources', resource);
  if (!response.success) {
    throw new Error(response.message || 'Failed to create built-in resource');
  }
  return response.data!;
};

/**
 * Update an existing built-in resource
 */
export const updateBuiltinResource = async (
  id: string,
  resource: Partial<BuiltinResource>,
): Promise<BuiltinResource> => {
  const response: ApiResponse<BuiltinResource> = await apiPut(`/resources/${id}`, resource);
  if (!response.success) {
    throw new Error(response.message || 'Failed to update built-in resource');
  }
  return response.data!;
};

/**
 * Delete a built-in resource
 */
export const deleteBuiltinResource = async (id: string): Promise<void> => {
  const response: ApiResponse = await apiDelete(`/resources/${id}`);
  if (!response.success) {
    throw new Error(response.message || 'Failed to delete built-in resource');
  }
};
