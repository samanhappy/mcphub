import { useEffect } from 'react';
import { useGroupContext } from '@/contexts/GroupContext';

export const useGroupData = (options?: { refreshOnMount?: boolean }) => {
  const context = useGroupContext();
  const { triggerRefresh } = context;

  // Optionally refresh on mount for pages that need the latest server-side group references.
  useEffect(() => {
    if (options?.refreshOnMount) {
      triggerRefresh();
    }
  }, [options?.refreshOnMount, triggerRefresh]);

  return context;
};
