// This hook now delegates to the ServerContext to avoid duplicate requests
// All components will share the same server data and polling mechanism
import { useServerContext } from '@/contexts/ServerContext';

export const useServerData = () => {
  // Simply return the context values
  // This maintains backward compatibility with existing code
  return useServerContext();
};

// Re-export for convenience
export { useServerDataWithRefresh } from './useServerDataWithRefresh';
