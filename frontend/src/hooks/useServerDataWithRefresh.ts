import { useEffect } from 'react';
import { useServerData } from './useServerData';

/**
 * Enhanced hook that automatically refreshes server data when component mounts
 * This is useful for pages that need fresh data when user navigates to them
 */
export const useServerDataWithRefresh = () => {
  const serverData = useServerData();
  const { refreshIfNeeded } = serverData;

  // Refresh data when component mounts (page is entered)
  useEffect(() => {
    refreshIfNeeded();
  }, [refreshIfNeeded]);

  return serverData;
};