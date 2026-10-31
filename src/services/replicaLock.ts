import { AsyncLocalStorage } from 'node:async_hooks';
import { getAppDataSource } from '../db/connection.js';
import { isReplicaMode } from '../utils/replicaMode.js';

const heldLocks = new AsyncLocalStorage<Set<string>>();

/** Credential-scoped, reentrant lock; it never retries the action after a database failure. */
export const withReplicaLock = async <T>(scope: string, action: () => Promise<T>): Promise<T> => {
  if (!isReplicaMode() || heldLocks.getStore()?.has(scope)) return action();
  const runner = getAppDataSource().createQueryRunner();
  const held = new Set(heldLocks.getStore());
  try {
    await runner.connect();
    await runner.startTransaction();
    await runner.query("SET LOCAL lock_timeout = '10s'");
    await runner.query('SELECT pg_advisory_xact_lock(209, hashtext($1))', [scope]);
    held.add(scope);
    return await heldLocks.run(held, action);
  } finally {
    held.delete(scope);
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
  }
};
