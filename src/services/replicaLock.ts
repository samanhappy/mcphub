import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryRunner } from 'typeorm';
import { getAppDataSource } from '../db/connection.js';
import { databaseTransaction } from '../db/transactionContext.js';
import { isReplicaMode } from '../utils/replicaMode.js';
import { logger } from '../utils/logger.js';

// Held scopes and the connection holding their advisory lock.
const heldLocks = new AsyncLocalStorage<Map<string, QueryRunner>>();

/**
 * Credential-scoped, reentrant lock; it never retries the action after a database failure.
 *
 * The action runs in the caller's context (a request transaction included). Only the work
 * passed to {@link withLockConnection} runs on the lock connection; that work is committed
 * when the lock is released, even if the action fails.
 */
export const withReplicaLock = async <T>(scope: string, action: () => Promise<T>): Promise<T> => {
  if (!isReplicaMode() || heldLocks.getStore()?.has(scope)) return action();
  const runner = getAppDataSource().createQueryRunner();
  const held = new Map(heldLocks.getStore());
  try {
    await runner.connect();
    await runner.startTransaction();
    await runner.query("SET LOCAL lock_timeout = '10s'");
    await runner.query('SELECT pg_advisory_xact_lock(209, hashtext($1))', [scope]);
    held.set(scope, runner);
    let result: T;
    try {
      result = await heldLocks.run(held, action);
    } catch (error) {
      await runner
        .commitTransaction()
        .catch((commitError) =>
          logger.error('Failed to commit credential changes after a failed action', commitError),
        );
      throw error;
    }
    await runner.commitTransaction();
    return result;
  } finally {
    held.delete(scope);
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
  }
};

/**
 * Run `work` on the connection holding the replica lock of `scope`, outside any request
 * transaction: it reads the latest committed state, and its writes are committed when the
 * lock is released, whatever the outcome of the request or of the locked action.
 *
 * Use it for credential state that follows irreversible upstream side effects: a refresh
 * rotates the refresh token at the authorization server, so a rolled-back dashboard request
 * must not restore the revoked token, and a REPEATABLE READ snapshot must not hide a
 * rotation made by another request. It reuses the lock connection, so it needs no extra
 * pooled connection. Outside replica mode, or without the lock, `work` runs as is.
 */
export const withLockConnection = <T>(scope: string, work: () => Promise<T>): Promise<T> => {
  const runner = heldLocks.getStore()?.get(scope);
  return runner ? databaseTransaction.run(runner, work) : work();
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
