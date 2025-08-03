import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Server, ApiResponse } from '@/types';
import { apiGet, apiPost, apiDelete } from '../utils/fetchInterceptor';

// Configuration options
const CONFIG = {
  // Initialization phase configuration
  startup: {
    maxAttempts: 60, // Maximum number of attempts during initialization
    pollingInterval: 3000, // Polling interval during initialization (3 seconds)
  },
  // Normal operation phase configuration
  normal: {
    pollingInterval: 10000, // Polling interval during normal operation (10 seconds)
  },
};

export const useServerData = () => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [fetchAttempts, setFetchAttempts] = useState(0);

  // Timer reference for polling
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Track current attempt count to avoid dependency cycles
  const attemptsRef = useRef<number>(0);

  // Clear the timer
  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Start normal polling
  const startNormalPolling = useCallback(() => {
    // Ensure no other timers are running
    clearTimer();

    const fetchServers = async () => {
      try {
        const data = await apiGet('/servers');

        if (data && data.success && Array.isArray(data.data)) {
          setServers(data.data);
        } else if (data && Array.isArray(data)) {
          setServers(data);
        } else {
          console.error('Invalid server data format:', data);
          setServers([]);
        }

        // Reset error state
        setError(null);
      } catch (err) {
        console.error('Error fetching servers during normal polling:', err);

        // Use friendly error message
        if (!navigator.onLine) {
          setError(t('errors.network'));
        } else if (
          err instanceof TypeError &&
          (err.message.includes('NetworkError') || err.message.includes('Failed to fetch'))
        ) {
          setError(t('errors.serverConnection'));
        } else {
          setError(t('errors.serverFetch'));
        }
      }
    };

    // Execute immediately
    fetchServers();

    // Set up regular polling
    intervalRef.current = setInterval(fetchServers, CONFIG.normal.pollingInterval);
  }, [t]);

  useEffect(() => {
    // Reset attempt count
    if (refreshKey > 0) {
      attemptsRef.current = 0;
      setFetchAttempts(0);
    }

    // Initialization phase request function
    const fetchInitialData = async () => {
      try {
        const data = await apiGet('/servers');

        // Handle API response wrapper object, extract data field
        if (data && data.success && Array.isArray(data.data)) {
          setServers(data.data);
          setIsInitialLoading(false);
          // Initialization successful, start normal polling
          startNormalPolling();
          return true;
        } else if (data && Array.isArray(data)) {
          // Compatibility handling, if API directly returns array
          setServers(data);
          setIsInitialLoading(false);
          // Initialization successful, start normal polling
          startNormalPolling();
          return true;
        } else {
          // If data format is not as expected, set to empty array
          console.error('Invalid server data format:', data);
          setServers([]);
          setIsInitialLoading(false);
          // Initialization successful but data is empty, start normal polling
          startNormalPolling();
          return true;
        }
      } catch (err) {
        // Increment attempt count, use ref to avoid triggering effect rerun
        attemptsRef.current += 1;
        console.error(`Initial loading attempt ${attemptsRef.current} failed:`, err);

        // Update state for display
        setFetchAttempts(attemptsRef.current);

        // Set appropriate error message
        if (!navigator.onLine) {
          setError(t('errors.network'));
        } else {
          setError(t('errors.initialStartup'));
        }

        // If maximum attempt count is exceeded, give up initialization and switch to normal polling
        if (attemptsRef.current >= CONFIG.startup.maxAttempts) {
          console.log('Maximum startup attempts reached, switching to normal polling');
          setIsInitialLoading(false);
          // Clear initialization polling
          clearTimer();
          // Switch to normal polling mode
          startNormalPolling();
        }

        return false;
      }
    };

    // On component mount, set appropriate polling based on current state
    if (isInitialLoading) {
      // Ensure no other timers are running
      clearTimer();

      // Execute initial request immediately
      fetchInitialData();

      // Set polling interval for initialization phase
      intervalRef.current = setInterval(fetchInitialData, CONFIG.startup.pollingInterval);
      console.log(`Started initial polling with interval: ${CONFIG.startup.pollingInterval}ms`);
    } else {
      // Initialization completed, start normal polling
      startNormalPolling();
    }

    // Cleanup function
    return () => {
      clearTimer();
    };
  }, [refreshKey, t, isInitialLoading, startNormalPolling]);

  // Manually trigger refresh
  const triggerRefresh = () => {
    // Clear current timer
    clearTimer();

    // If in initialization phase, reset initialization state
    if (isInitialLoading) {
      setIsInitialLoading(true);
      attemptsRef.current = 0;
      setFetchAttempts(0);
    }

    // Change in refreshKey will trigger useEffect to run again
    setRefreshKey((prevKey) => prevKey + 1);
  };

  // Server related operations
  const handleServerAdd = () => {
    setRefreshKey((prevKey) => prevKey + 1);
  };

  const handleServerEdit = async (server: Server) => {
    try {
      // Fetch settings to get the full server config before editing
      const settingsData: ApiResponse<{ mcpServers: Record<string, any> }> =
        await apiGet('/settings');

      if (
        settingsData &&
        settingsData.success &&
        settingsData.data &&
        settingsData.data.mcpServers &&
        settingsData.data.mcpServers[server.name]
      ) {
        const serverConfig = settingsData.data.mcpServers[server.name];
        return {
          name: server.name,
          status: server.status,
          tools: server.tools || [],
          config: serverConfig,
        };
      } else {
        console.error('Failed to get server config from settings:', settingsData);
        setError(t('server.invalidConfig', { serverName: server.name }));
        return null;
      }
    } catch (err) {
      console.error('Error fetching server settings:', err);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const handleServerRemove = async (serverName: string) => {
    try {
      const result = await apiDelete(`/servers/${serverName}`);

      if (!result || !result.success) {
        setError(result?.message || t('server.deleteError', { serverName }));
        return false;
      }

      setRefreshKey((prevKey) => prevKey + 1);
      return true;
    } catch (err) {
      setError(t('errors.general') + ': ' + (err instanceof Error ? err.message : String(err)));
      return false;
    }
  };

  const handleServerToggle = async (server: Server, enabled: boolean) => {
    try {
      const result = await apiPost(`/servers/${server.name}/toggle`, { enabled });

      if (!result || !result.success) {
        console.error('Failed to toggle server:', result);
        setError(result?.message || t('server.toggleError', { serverName: server.name }));
        return false;
      }

      // Update the UI immediately to reflect the change
      setRefreshKey((prevKey) => prevKey + 1);
      return true;
    } catch (err) {
      console.error('Error toggling server:', err);
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  return {
    servers,
    error,
    setError,
    isLoading: isInitialLoading,
    fetchAttempts,
    triggerRefresh,
    handleServerAdd,
    handleServerEdit,
    handleServerRemove,
    handleServerToggle,
  };
};
