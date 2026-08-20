import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { logStreamManager } from '@/services/logService';

interface EmbeddingSyncProgressState {
  serverName: string;
  current: number;
  total: number;
  status: 'started' | 'in_progress' | 'completed';
}

interface EmbeddingSyncContextValue {
  activeSyncs: EmbeddingSyncProgressState[];
}

interface EmbeddingSyncStreamEvent {
  type: 'embedding-sync-progress';
  progress?: {
    serverName?: unknown;
    current?: unknown;
    total?: unknown;
    status?: unknown;
  };
}

const COMPLETION_VISIBILITY_MS = 5000;

const EmbeddingSyncContext = createContext<EmbeddingSyncContextValue | undefined>(undefined);

const isValidProgressState = (
  progress: EmbeddingSyncStreamEvent['progress'],
): progress is {
  serverName: string;
  current: number;
  total: number;
  status: 'started' | 'in_progress' | 'completed' | 'error';
} => {
  return (
    !!progress &&
    typeof progress.serverName === 'string' &&
    typeof progress.current === 'number' &&
    typeof progress.total === 'number' &&
    progress.total > 0 &&
    progress.current >= 0 &&
    progress.current <= progress.total &&
    ['started', 'in_progress', 'completed', 'error'].includes(String(progress.status))
  );
};

export const EmbeddingSyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeSyncs, setActiveSyncs] = useState<EmbeddingSyncProgressState[]>([]);
  const hideTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const clearHideTimer = (serverName: string) => {
      const timer = hideTimersRef.current.get(serverName);
      if (timer) {
        clearTimeout(timer);
        hideTimersRef.current.delete(serverName);
      }
    };

    const clearAllHideTimers = () => {
      hideTimersRef.current.forEach((timer) => clearTimeout(timer));
      hideTimersRef.current.clear();
    };

    const upsertSync = (nextState: EmbeddingSyncProgressState) => {
      setActiveSyncs((currentSyncs) => {
        const existingIndex = currentSyncs.findIndex(
          (currentSync) => currentSync.serverName === nextState.serverName,
        );

        if (existingIndex === -1) {
          return [...currentSyncs, nextState];
        }

        const updatedSyncs = [...currentSyncs];
        updatedSyncs[existingIndex] = nextState;
        return updatedSyncs;
      });
    };

    const removeSync = (serverName: string) => {
      setActiveSyncs((currentSyncs) =>
        currentSyncs.filter((currentSync) => currentSync.serverName !== serverName),
      );
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as EmbeddingSyncStreamEvent;
        if (data?.type !== 'embedding-sync-progress' || !isValidProgressState(data.progress)) {
          return;
        }

        // Hold the narrowed reference: type-guard narrowing of a property access
        // is not preserved inside the setTimeout closure below, so dereference
        // once into a const and use that everywhere.
        const progress = data.progress;

        clearHideTimer(progress.serverName);

        if (progress.status === 'error') {
          removeSync(progress.serverName);
          return;
        }

        const nextState: EmbeddingSyncProgressState = {
          serverName: progress.serverName,
          current: progress.current,
          total: progress.total,
          status: progress.status,
        };

        upsertSync(nextState);

        if (progress.status === 'completed') {
          const timer = setTimeout(() => {
            removeSync(progress.serverName);
            hideTimersRef.current.delete(progress.serverName);
          }, COMPLETION_VISIBILITY_MS);

          hideTimersRef.current.set(progress.serverName, timer);
        }
      } catch {
        // Ignore malformed stream messages.
      }
    };

    const unsubscribe = logStreamManager.subscribe(handleMessage);

    return () => {
      clearAllHideTimers();
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      activeSyncs,
    }),
    [activeSyncs],
  );

  return <EmbeddingSyncContext.Provider value={value}>{children}</EmbeddingSyncContext.Provider>;
};

export const useEmbeddingSync = (): EmbeddingSyncContextValue => {
  const context = useContext(EmbeddingSyncContext);
  if (!context) {
    throw new Error('useEmbeddingSync must be used within an EmbeddingSyncProvider');
  }

  return context;
};