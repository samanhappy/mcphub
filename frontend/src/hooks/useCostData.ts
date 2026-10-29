import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../utils/fetchInterceptor';
import type { ApiResponse, ServerCost, GroupCost } from '@/types';

export const useCostData = (revision = '') => {
  const [serverCosts, setServerCosts] = useState<ServerCost[]>([]);
  const [groupCosts, setGroupCosts] = useState<GroupCost[]>([]);
  const [loading, setLoading] = useState(true);

  const inFlight = useRef<Promise<void> | null>(null);

  const loadCosts = useCallback(async () => {
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

  const fetchCosts = useCallback(() => {
    if (!inFlight.current) {
      inFlight.current = loadCosts().finally(() => {
        inFlight.current = null;
      });
    }
    return inFlight.current;
  }, [loadCosts]);

  useEffect(() => {
    // A revision change during an active request must still fetch the new state.
    let active = true;
    const previous = inFlight.current;
    void (async () => {
      if (previous) await previous;
      if (active) await fetchCosts();
    })();
    return () => {
      active = false;
    };
  }, [fetchCosts, revision]);

  return { serverCosts, groupCosts, loading, refetch: fetchCosts };
};
