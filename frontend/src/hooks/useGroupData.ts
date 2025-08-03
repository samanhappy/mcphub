import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, ApiResponse, IGroupServerConfig } from '@/types';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/fetchInterceptor';

export const useGroupData = () => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const data: ApiResponse<Group[]> = await apiGet('/groups');

      if (data && data.success && Array.isArray(data.data)) {
        setGroups(data.data);
      } else {
        console.error('Invalid group data format:', data);
        setGroups([]);
      }

      setError(null);
    } catch (err) {
      console.error('Error fetching groups:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch groups');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Trigger a refresh of the groups data
  const triggerRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  // Create a new group with server associations
  const createGroup = async (
    name: string,
    description?: string,
    servers: string[] | IGroupServerConfig[] = [],
  ) => {
    try {
      const result: ApiResponse<Group> = await apiPost('/groups', { name, description, servers });
      console.log('Group created successfully:', result);

      if (!result || !result.success) {
        setError(result?.message || t('groups.createError'));
        return result;
      }

      triggerRefresh();
      return result || null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
      return null;
    }
  };

  // Update an existing group with server associations
  const updateGroup = async (
    id: string,
    data: { name?: string; description?: string; servers?: string[] | IGroupServerConfig[] },
  ) => {
    try {
      const result: ApiResponse<Group> = await apiPut(`/groups/${id}`, data);
      if (!result || !result.success) {
        setError(result?.message || t('groups.updateError'));
        return result;
      }

      triggerRefresh();
      return result || null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group');
      return null;
    }
  };

  // Update servers in a group (for batch updates)
  const updateGroupServers = async (groupId: string, servers: string[] | IGroupServerConfig[]) => {
    try {
      const result: ApiResponse<Group> = await apiPut(`/groups/${groupId}/servers/batch`, {
        servers,
      });

      if (!result || !result.success) {
        setError(result?.message || t('groups.updateError'));
        return null;
      }

      triggerRefresh();
      return result.data || null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group servers');
      return null;
    }
  };

  // Delete a group
  const deleteGroup = async (id: string) => {
    try {
      const result = await apiDelete(`/groups/${id}`);
      if (!result || !result.success) {
        setError(result?.message || t('groups.deleteError'));
        return result;
      }

      triggerRefresh();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
      return null;
    }
  };

  // Add server to a group
  const addServerToGroup = async (groupId: string, serverName: string) => {
    try {
      const result: ApiResponse<Group> = await apiPost(`/groups/${groupId}/servers`, {
        serverName,
      });

      if (!result || !result.success) {
        setError(result?.message || t('groups.serverAddError'));
        return null;
      }

      triggerRefresh();
      return result.data || null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add server to group');
      return null;
    }
  };

  // Remove server from group
  const removeServerFromGroup = async (groupId: string, serverName: string) => {
    try {
      const result: ApiResponse<Group> = await apiDelete(
        `/groups/${groupId}/servers/${serverName}`,
      );

      if (!result || !result.success) {
        setError(result?.message || t('groups.serverRemoveError'));
        return null;
      }

      triggerRefresh();
      return result.data || null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove server from group');
      return null;
    }
  };

  // Fetch groups when the component mounts or refreshKey changes
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups, refreshKey]);

  return {
    groups,
    loading,
    error,
    setError,
    triggerRefresh,
    createGroup,
    updateGroup,
    updateGroupServers,
    deleteGroup,
    addServerToGroup,
    removeServerFromGroup,
  };
};
