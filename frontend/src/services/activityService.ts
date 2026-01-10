import { apiGet, apiDelete } from '@/utils/fetchInterceptor';
import {
  Activity,
  ActivityStats,
  ActivityFilter,
  ActivityFilterOptions,
  ApiResponse,
} from '@/types';

/**
 * Check if activity feature is available (database mode only)
 */
export const checkActivityAvailable = async (): Promise<boolean> => {
  try {
    const response = await apiGet('/activities/available');
    return response?.data?.available || false;
  } catch (error) {
    console.error('Error checking activity availability:', error);
    return false;
  }
};

/**
 * Build query string from filter object
 */
const buildQueryString = (page: number, limit: number, filter?: ActivityFilter): string => {
  const params = new URLSearchParams();
  params.append('page', page.toString());
  params.append('limit', limit.toString());

  if (filter?.server) {
    params.append('server', filter.server);
  }
  if (filter?.tool) {
    params.append('tool', filter.tool);
  }
  if (filter?.status) {
    params.append('status', filter.status);
  }
  if (filter?.group) {
    params.append('group', filter.group);
  }
  if (filter?.keyId) {
    params.append('keyId', filter.keyId);
  }
  if (filter?.keyName) {
    params.append('keyName', filter.keyName);
  }
  if (filter?.startDate) {
    params.append('startDate', filter.startDate);
  }
  if (filter?.endDate) {
    params.append('endDate', filter.endDate);
  }

  return params.toString();
};

/**
 * Get paginated list of activities
 */
export const getActivities = async (
  page: number,
  limit: number,
  filter?: ActivityFilter,
): Promise<ApiResponse<Activity[]> & { pagination?: any }> => {
  const queryString = buildQueryString(page, limit, filter);
  return await apiGet(`/activities?${queryString}`);
};

/**
 * Get activity by ID
 */
export const getActivityById = async (id: string): Promise<ApiResponse<Activity>> => {
  return await apiGet(`/activities/${id}`);
};

/**
 * Get activity statistics
 */
export const getActivityStats = async (
  filter?: ActivityFilter,
): Promise<ApiResponse<ActivityStats>> => {
  const params = new URLSearchParams();

  if (filter?.server) {
    params.append('server', filter.server);
  }
  if (filter?.tool) {
    params.append('tool', filter.tool);
  }
  if (filter?.status) {
    params.append('status', filter.status);
  }
  if (filter?.group) {
    params.append('group', filter.group);
  }
  if (filter?.keyId) {
    params.append('keyId', filter.keyId);
  }
  if (filter?.keyName) {
    params.append('keyName', filter.keyName);
  }
  if (filter?.startDate) {
    params.append('startDate', filter.startDate);
  }
  if (filter?.endDate) {
    params.append('endDate', filter.endDate);
  }

  const queryString = params.toString();
  return await apiGet(`/activities/stats${queryString ? `?${queryString}` : ''}`);
};

/**
 * Get filter options (distinct servers, tools, groups)
 */
export const getActivityFilterOptions = async (): Promise<ApiResponse<ActivityFilterOptions>> => {
  return await apiGet('/activities/filters');
};

/**
 * Delete old activities
 */
export const deleteOldActivities = async (
  daysOld: number = 30,
): Promise<ApiResponse<{ deletedCount: number; cutoffDate: string }>> => {
  return await apiDelete(`/activities/cleanup?daysOld=${daysOld}`);
};
