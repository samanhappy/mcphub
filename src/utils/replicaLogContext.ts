import { AsyncLocalStorage } from 'node:async_hooks';

export const replicaLogContext = new AsyncLocalStorage<{
  nodeId: string;
  requestId: string;
  appliedVersion: string | null;
}>();
