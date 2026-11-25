import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryRunner } from 'typeorm';
import { getAppDataSource } from '../db/connection.js';
import { databaseTransaction } from '../db/transactionContext.js';
import { isReplicaMode } from '../utils/replicaMode.js';
import { logger } from '../utils/logger.js';

// Held scopes and the connection holding their advisory lock.
const heldLocks = new AsyncLocalStorage<Map<string, QueryRunner>>();

/** Drop a connection that may still hold a session lock: pg-pool destroys it, not reuse it. */
const discard = async (runner: QueryRunner, error: unknown): Promise<void> => {
  const postgres = runner as QueryRunner & {
    releasePostgresConnection?: (error: unknown) => Promise<void>;
  };
  if (postgres.releasePostgresConnection) await postgres.releasePostgresConnection(error);
  else await runner.release();
};

/**
 * Credential-scoped, reentrant lock across replicas; it never retries the action after a
 * database failure.
 *
 * The action runs in the caller's context (a request transaction included). The lock is a
 * session-level advisory lock on a dedicated connection, with a 10-second timeout on its
 * acquisition only. That connection also runs the credential work passed to
 * {@link withLockConnection}, in short transactions of its own.
 */
export const withReplicaLock = async <T>(scope: string, action: () => Promise<T>): Promise<T> => {
  if (!isReplicaMode() || heldLocks.getStore()?.has(scope)) return action();
  const runner = getAppDataSource().createQueryRunner();
  try {
    await runner.connect();
    // SET LOCAL ends with this transaction: the session lock survives it, the timeout does not.
    await runner.startTransaction();
    await runner.query("SET LOCAL lock_timeout = '10s'");
    await runner.query('SELECT pg_advisory_lock(209, hashtext($1))', [scope]);
    await runner.commitTransaction();
  } catch (error) {
    await discard(runner, error);
    throw error;
  }
  const held = new Map(heldLocks.getStore());
  held.set(scope, runner);
  try {
    return await heldLocks.run(held, action);
  } finally {
    held.delete(scope);
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.query('SELECT pg_advisory_unlock(209, hashtext($1))', [scope]);
      await runner.release();
    } catch (error) {
      logger.error('Failed to release a replica lock; discarding its connection', error);
      await discard(runner, error);
    }
  }
};

/**
 * Run credential work on the connection holding the replica lock of `scope`, in its own
 * transaction committed when `work` returns, outside any request transaction.
 *
 * Use it for credential reads and writes that follow irreversible upstream side effects: a
 * refresh rotates the refresh token at the authorization server, so the new grant must be
 * durable at once (a rolled-back dashboard request must not restore the revoked token) and
 * reads must see the latest committed state (a REPEATABLE READ snapshot must not hide a
 * rotation made by another request). The lock connection is already held, so this needs no
 * extra pooled connection. Without the lock, or outside replica mode, `work` runs in the
 * caller's context.
 *
 * Keep `work` to database operations: it is serialized with the other credential work of
 * the lock, and nothing it starts should outlive it.
 */
export const withLockConnection = <T>(scope: string, work: () => Promise<T>): Promise<T> => {
  const runner = heldLocks.getStore()?.get(scope);
  if (!runner) return work();
  return withKeyedLock(JSON.stringify(['lock-connection', scope]), async () => {
    // Nested credential work joins the enclosing transaction.
    if (runner.isTransactionActive) return databaseTransaction.run(runner, work);
    await runner.startTransaction();
    try {
      const result = await databaseTransaction.run(runner, work);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    }
  });
};

/**
 * In-process, reentrant, per-key promise-chain lock. `withReplicaLock` above
 * is a no-op outside replica mode because there is no cross-process lock to
 * take; this keeps same-key async work serialized within a single process
 * (e.g. a server's OAuth flows) in both modes.
 */
const heldKeyedLocks = new AsyncLocalStorage<Set<string>>();
const keyedQueues = new Map<string, Promise<unknown>>();

export const withKeyedLock = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
  if (heldKeyedLocks.getStore()?.has(key)) return action();

  const previous = keyedQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => gate);
  keyedQueues.set(key, next);
  await previous.catch(() => undefined);

  const held = new Set(heldKeyedLocks.getStore());
  held.add(key);
  try {
    return await heldKeyedLocks.run(held, action);
  } finally {
    held.delete(key);
    release();
    if (keyedQueues.get(key) === next) keyedQueues.delete(key);
  }
};

/**
 * Serialize one server's pending-OAuth writes (state + PKCE verifier) and the
 * callback's token exchange within this process, keyed by server name and
 * credential scope. Concurrent `connect()` calls (e.g. a double
 * enable/disable toggle) otherwise interleave on `pendingAuthorization`, and
 * a callback can exchange a code against a verifier stored for the wrong
 * state (`invalid_grant: Invalid PKCE code_verifier`).
 */
export const withOAuthPendingAuthLock = async <T>(
  serverName: string,
  username: string,
  action: () => Promise<T>,
): Promise<T> =>
  withReplicaLock(JSON.stringify(['oauth', serverName, username]), () =>
    withKeyedLock(JSON.stringify(['oauth-flow', serverName, username]), action),
  );
