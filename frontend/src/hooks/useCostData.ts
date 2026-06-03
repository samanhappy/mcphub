import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../utils/fetchInterceptor';
import type { ApiResponse, ServerCost, GroupCost } from '@/types';

export const useCostData = () => {
  const [serverCosts, setServerCosts] = useState<ServerCost[]>([]);
  const [groupCosts, setGroupCosts] = useState<GroupCost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCosts = useCallback(async () => {
    try {
      setLoading(true);
      const [servers, groups] = await Promise.all([
        apiGet('/cost/servers') as Promise<ApiResponse<ServerCost[]>>,
        apiGet('/cost/groups') as Promise<ApiResponse<GroupCost[]>>,
      ]);
      if (servers?.success && Array.isArray(servers.data)) setServerCosts(servers.data);
      if (groups?.success && Array.isArray(groups.data)) setGroupCosts(groups.data);
    } catch (err) {
      console.error('Error fetching context footprint:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  return { serverCosts, groupCosts, loading, refetch: fetchCosts };
};
