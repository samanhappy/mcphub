import React, { createContext, useState, useEffect, useRef, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Server, ApiResponse } from '@/types';
import { apiGet, apiPost, apiDelete } from '../utils/fetchInterceptor';
import { useAuth } from './AuthContext';

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

// Context type definition
interface ServerContextType {
  servers: Server[];
  error: string | null;
  setError: (error: string | null) => void;
  isLoading: boolean;
  fetchAttempts: number;
  triggerRefresh: () => void;
  refreshIfNeeded: () => void; // Smart refresh with debounce
  handleServerAdd: () => void;
  handleServerEdit: (server: Server) => Promise<any>;
  handleServerRemove: (serverName: string) => Promise<boolean>;
  handleServerToggle: (server: Server, enabled: boolean) => Promise<boolean>;
}

// Create Context
const ServerContext = createContext<ServerContextType | undefined>(undefined);

// Provider component
export const ServerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [fetchAttempts, setFetchAttempts] = useState(0);

  // Timer reference for polling
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Track current attempt count to avoid dependency cycles
  const attemptsRef = useRef<number>(0);
  // Track last fetch time to implement smart refresh
  const lastFetchTimeRef = useRef<number>(0);
  // Minimum interval between manual refreshes (5 seconds in dev, 3 seconds in prod)
  const MIN_REFRESH_INTERVAL = process.env.NODE_ENV === 'development' ? 5000 : 3000;

  // Clear the timer
  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Start normal polling
  const startNormalPolling = useCallback((options?: { immediate?: boolean }) => {
    const immediate = options?.immediate ?? true;
    // Ensure no other timers are running
    clearTimer();

    const fetchServers = async () => {
      try {
        console.log('[ServerContext] Fetching servers from API...');
        const data = await apiGet('/servers');
        
        // Update last fetch time
        lastFetchTimeRef.current = Date.now();

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

    // Execute immediately unless explicitly skipped
    if (immediate) {
      fetchServers();
    }

    // Set up regular polling
    intervalRef.current = setInterval(fetchServers, CONFIG.normal.pollingInterval);
  }, [t]);

  // Watch for authentication status changes
  useEffect(() => {
    if (auth.isAuthenticated) {
      console.log('[ServerContext] User authenticated, triggering refresh');
      // When user logs in, trigger a refresh to load servers
      setRefreshKey((prevKey) => prevKey + 1);
    } else {
      console.log('[ServerContext] User not authenticated, clearing data and stopping polling');
      // When user logs out, clear data and stop polling
      clearTimer();
      setServers([]);
      setIsInitialLoading(false);
      setError(null);
    }
  }, [auth.isAuthenticated]);

  useEffect(() => {
    // If not authenticated, don't poll
    if (!auth.isAuthenticated) {
      console.log('[ServerContext] User not authenticated, skipping polling setup');
      return;
    }

    // Reset attempt count
    if (refreshKey > 0) {
      attemptsRef.current = 0;
      setFetchAttempts(0);
    }

    // Initialization phase request function
    const fetchInitialData = async () => {
      try {
        console.log('[ServerContext] Initial fetch - attempt', attemptsRef.current + 1);
        const data = await apiGet('/servers');
        
        // Update last fetch time
        lastFetchTimeRef.current = Date.now();

        // Handle API response wrapper object, extract data field
        if (data && data.success && Array.isArray(data.data)) {
          setServers(data.data);
          setIsInitialLoading(false);
          // Initialization successful, start normal polling (skip immediate to avoid duplicate fetch)
          startNormalPolling({ immediate: false });
          return true;
        } else if (data && Array.isArray(data)) {
          // Compatibility handling, if API directly returns array
          setServers(data);
          setIsInitialLoading(false);
          // Initialization successful, start normal polling (skip immediate to avoid duplicate fetch)
          startNormalPolling({ immediate: false });
          return true;
        } else {
          // If data format is not as expected, set to empty array
          console.error('Invalid server data format:', data);
          setServers([]);
          setIsInitialLoading(false);
          // Initialization successful but data is empty, start normal polling (skip immediate)
          startNormalPolling({ immediate: false });
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

  // Manually trigger refresh (always refreshes)
  const triggerRefresh = useCallback(() => {
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
  }, [isInitialLoading]);

  // Smart refresh with debounce (only refresh if enough time has passed)
  const refreshIfNeeded = useCallback(() => {
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimeRef.current;
    
    // Log who is calling this
    console.log('[ServerContext] refreshIfNeeded called, time since last fetch:', timeSinceLastFetch, 'ms');
    
    // Only refresh if enough time has passed since last fetch
    if (timeSinceLastFetch >= MIN_REFRESH_INTERVAL) {
      console.log('[ServerContext] Triggering refresh (exceeded MIN_REFRESH_INTERVAL:', MIN_REFRESH_INTERVAL, 'ms)');
      triggerRefresh();
    } else {
      console.log('[ServerContext] Skipping refresh (MIN_REFRESH_INTERVAL:', MIN_REFRESH_INTERVAL, 'ms, time since last:', timeSinceLastFetch, 'ms)');
    }
  }, [triggerRefresh]);

  // Server related operations
  const handleServerAdd = useCallback(() => {
    setRefreshKey((prevKey) => prevKey + 1);
  }, []);

  const handleServerEdit = useCallback(async (server: Server) => {
    try {
      // Fetch server config from the dedicated server config endpoint
      const serverConfigData: ApiResponse<any> = await apiGet(`/servers/${server.name}`);

      if (serverConfigData && serverConfigData.success && serverConfigData.data) {
        return serverConfigData.data;
      } else {
        console.error('Failed to get server config:', serverConfigData);
        setError(t('server.invalidConfig', { serverName: server.name }));
        return null;
      }
    } catch (err) {
      console.error('Error fetching server config:', err);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [t]);

  const handleServerRemove = useCallback(async (serverName: string) => {
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
  }, [t]);

  const handleServerToggle = useCallback(async (server: Server, enabled: boolean) => {
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
  }, [t]);

  const value: ServerContextType = {
    servers,
    error,
    setError,
    isLoading: isInitialLoading,
    fetchAttempts,
    triggerRefresh,
    refreshIfNeeded,
    handleServerAdd,
    handleServerEdit,
    handleServerRemove,
    handleServerToggle,
  };

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
};

// Custom hook to use the Server context
export const useServerContext = () => {
  const context = useContext(ServerContext);
  if (context === undefined) {
    throw new Error('useServerContext must be used within a ServerProvider');
  }
  return context;
};