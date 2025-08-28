// This hook now delegates to the ServerContext to avoid duplicate requests
// All components will share the same server data and polling mechanism
import { useServerContext } from '@/contexts/ServerContext';
import { useEffect } from 'react';

export const useServerData = (options?: { refreshOnMount?: boolean }) => {
  const context = useServerContext();
  const { refreshIfNeeded } = context;

  // Optionally refresh on mount for pages that need fresh data
  useEffect(() => {
    if (options?.refreshOnMount) {
      refreshIfNeeded();
    }
  }, [options?.refreshOnMount, refreshIfNeeded]);

  return context;
};

