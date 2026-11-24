import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ApiResponse, Group, IGroupServerConfig } from '@/types';
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/fetchInterceptor';
import {
  getServerNamesFingerprint,
  shouldRefreshGroupsForServerNames,
} from '../utils/groupCache';
import { useAuth } from './AuthContext';
import { useServerContext } from './ServerContext';

export interface GroupContextType {
  groups: Group[];
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  triggerRefresh: () => void;
  createGroup: (
    name: string,
    description?: string,
    servers?: string[] | IGroupServerConfig[],
    access?: Pick<
      Group,
      'visibility' | 'sharedWithUserGroups' | 'sharedWithUsers' | 'instructions'
    >,
  ) => Promise<ApiResponse<Group> | null>;
  updateGroup: (
    id: string,
    data: Partial<
      Pick<
        Group,
        | 'name'
        | 'description'
        | 'instructions'
        | 'servers'
        | 'visibility'
        | 'sharedWithUserGroups'
        | 'sharedWithUsers'
      >
    >,
  ) => Promise<ApiResponse<Group> | null>;
  updateGroupServers: (
    groupId: string,
    servers: string[] | IGroupServerConfig[],
  ) => Promise<Group | null>;
  deleteGroup: (id: string) => Promise<ApiResponse | null>;
  addServerToGroup: (groupId: string, serverName: string) => Promise<Group | null>;
  removeServerFromGroup: (groupId: string, serverName: string) => Promise<Group | null>;
}

const GroupContext = createContext<GroupContextType | undefined>(undefined);

export const GroupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const { allServers, hasLoadedServers } = useServerContext();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);
  const previousServerNamesRef = useRef<string | null>(null);

  const serverNamesFingerprint = useMemo(
    () => getServerNamesFingerprint(allServers),
    [allServers],
  );

  const triggerRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  // Invalidate cached groups whenever the set of server names changes (e.g. server rename/removal).
  useEffect(() => {
    if (!auth.isAuthenticated || !hasLoadedServers) {
      previousServerNamesRef.current = null;
      return;
    }

    const previousFingerprint = previousServerNamesRef.current;
    previousServerNamesRef.current = serverNamesFingerprint;
    if (shouldRefreshGroupsForServerNames(previousFingerprint, serverNamesFingerprint)) {
      triggerRefresh();
    }
  }, [auth.isAuthenticated, hasLoadedServers, serverNamesFingerprint, triggerRefresh]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      hasLoadedRef.current = false;
      setGroups([]);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    const controller = new AbortController();

    const fetchGroups = async () => {
      try {
        if (!hasLoadedRef.current) {
          setLoading(true);
        }
        const data: ApiResponse<Group[]> = await apiGet('/groups', {
          signal: controller.signal,
        });
        if (!active) return;

        if (data && data.success && Array.isArray(data.data)) {
          setGroups(data.data);
          setError(null);
        } else {
          console.error('Invalid group data format:', data);
          setGroups([]);
        }
      } catch (err) {
        if (!active) return;
        console.error('Error fetching groups:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch groups');
        setGroups([]);
      } finally {
        if (active) {
          hasLoadedRef.current = true;
          setLoading(false);
        }
      }
    };

    void fetchGroups();
    return () => {
      active = false;
      controller.abort();
    };
  }, [auth.isAuthenticated, auth.user?.username, refreshKey]);

  const createGroup: GroupContextType['createGroup'] = useCallback(
    async (name, description, servers = [], access = {}) => {
      try {
        const result: ApiResponse<Group> = await apiPost('/groups', {
          name,
          description,
          servers,
          ...access,
        });

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
    },
    [t, triggerRefresh],
  );

  const updateGroup: GroupContextType['updateGroup'] = useCallback(
    async (id, data) => {
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
    },
    [t, triggerRefresh],
  );

  const updateGroupServers: GroupContextType['updateGroupServers'] = useCallback(
    async (groupId, servers) => {
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
    },
    [t, triggerRefresh],
  );

  const deleteGroup: GroupContextType['deleteGroup'] = useCallback(
    async (id) => {
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
    },
    [t, triggerRefresh],
  );

  const addServerToGroup: GroupContextType['addServerToGroup'] = useCallback(
    async (groupId, serverName) => {
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
    },
    [t, triggerRefresh],
  );

  const removeServerFromGroup: GroupContextType['removeServerFromGroup'] = useCallback(
    async (groupId, serverName) => {
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
    },
    [t, triggerRefresh],
  );

  return (
    <GroupContext.Provider
      value={{
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
      }}
    >
      {children}
    </GroupContext.Provider>
  );
};

export const useGroupContext = (): GroupContextType => {
  const context = useContext(GroupContext);
  if (!context) {
    throw new Error('useGroupContext must be used within a GroupProvider');
  }
  return context;
};
