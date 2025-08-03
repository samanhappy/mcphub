import { useEffect, useState } from 'react';
import { apiGet, apiDelete } from '../utils/fetchInterceptor';
import { getApiUrl } from '../utils/runtime';
import { getToken } from '../utils/interceptors';

export interface LogEntry {
  timestamp: number;
  type: 'info' | 'error' | 'warn' | 'debug';
  source: string;
  message: string;
  processId?: string;
}

// Fetch all logs
export const fetchLogs = async (): Promise<LogEntry[]> => {
  try {
    const response = await apiGet<{ success: boolean; data: LogEntry[]; error?: string }>('/logs');

    if (!response.success) {
      throw new Error(response.error || 'Failed to fetch logs');
    }

    return response.data;
  } catch (error) {
    console.error('Error fetching logs:', error);
    throw error;
  }
};

// Clear all logs
export const clearLogs = async (): Promise<void> => {
  try {
    const response = await apiDelete<{ success: boolean; error?: string }>('/logs');

    if (!response.success) {
      throw new Error(response.error || 'Failed to clear logs');
    }
  } catch (error) {
    console.error('Error clearing logs:', error);
    throw error;
  }
};

// Hook to use logs with SSE streaming
export const useLogs = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let isMounted = true;

    const connectToLogStream = () => {
      try {
        // Close existing connection if any
        if (eventSource) {
          eventSource.close();
        }

        // Get the authentication token
        const token = getToken();
        // Connect to SSE endpoint with auth token in URL
        eventSource = new EventSource(getApiUrl(`/logs/stream?token=${token}`));

        eventSource.onmessage = (event) => {
          if (!isMounted) return;

          try {
            const data = JSON.parse(event.data);

            if (data.type === 'initial') {
              setLogs(data.logs);
              setLoading(false);
            } else if (data.type === 'log') {
              setLogs((prevLogs) => [...prevLogs, data.log]);
            }
          } catch (err) {
            console.error('Error parsing SSE message:', err);
          }
        };

        eventSource.onerror = () => {
          if (!isMounted) return;

          if (eventSource) {
            eventSource.close();
            // Attempt to reconnect after a delay
            setTimeout(connectToLogStream, 5000);
          }

          setError(new Error('Connection to log stream lost, attempting to reconnect...'));
        };
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err : new Error('Failed to connect to log stream'));
        setLoading(false);
      }
    };

    // Initial connection
    connectToLogStream();

    // Cleanup on unmount
    return () => {
      isMounted = false;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const clearAllLogs = async () => {
    try {
      await clearLogs();
      setLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to clear logs'));
    }
  };

  return { logs, loading, error, clearLogs: clearAllLogs };
};
