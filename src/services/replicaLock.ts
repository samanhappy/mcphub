import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryRunner } from 'typeorm';
import { getAppDataSource } from '../db/connection.js';
import { databaseTransaction } from '../db/transactionContext.js';
import { isReplicaMode } from '../utils/replicaMode.js';

// Held scopes and the connection holding their advisory lock.
const heldLocks = new AsyncLocalStorage<Map<string, QueryRunner>>();
// Credential work in progress per lock: nested work joins it, the outermost one commits.
const lockWork = new AsyncLocalStorage<Map<string, { commit: boolean }>>();
// Wait budget for a replica lock: the in-process queue and the database lock together.
const LOCK_TIMEOUT_MS = 10_000;

/**
 * Open the lock transaction and take the transaction-level advisory lock. Transaction-level
 * only, so the lock also works through a transaction pooler (PgBouncer in transaction mode):
 * no state outlives a transaction. lock_timeout covers the acquisition only; the credential
 * writes of the transaction keep the default.
 */
const acquire = async (
  runner: QueryRunner,
  scope: string,
  timeoutMs = LOCK_TIMEOUT_MS,
): Promise<void> => {
  await runner.startTransaction();
  try {
    // SET takes no parameters; the value is an integer.
    await runner.query(`SET LOCAL lock_timeout = '${Math.max(1, Math.ceil(timeoutMs))}ms'`);
    await runner.query('SELECT pg_advisory_xact_lock(209, hashtext($1))', [scope]);
    await runner.query('SET LOCAL lock_timeout = DEFAULT');
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  }
};

/**
 * Credential-scoped, reentrant lock across replicas; it never retries the action after a
 * database failure.
 *
 * The action runs in the caller's context (a request transaction included). Callers of this
 * process queue in memory first, without holding a connection; then the lock is a
 * transaction-level advisory lock held by a transaction on a dedicated connection, which also
 * runs the credential work passed to {@link withLockConnection}. Waiting for both fails after
 * 10 seconds.
 */
export const withReplicaLock = async <T>(scope: string, action: () => Promise<T>): Promise<T> => {
  if (!isReplicaMode() || heldLocks.getStore()?.has(scope)) return action();
  // Same-process holders queue here, before the database lock: withLockConnection releases and
  // takes the database lock again after a write, and a request of this process waiting for the
  // in-process lock while holding the database one would block that new acquisition.
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  return withKeyedLock(
    JSON.stringify(['replica-lock', scope]),
    async () => {
      const runner = getAppDataSource().createQueryRunner();
      const held = new Map(heldLocks.getStore());
      try {
        await runner.connect();
        await acquire(runner, scope, deadline - Date.now());
        held.set(scope, runner);
        return await heldLocks.run(held, action);
      } finally {
        held.delete(scope);
        try {
          // Committed credential writes are already durable (withLockConnection).
          if (runner.isTransactionActive) await runner.rollbackTransaction();
        } finally {
          await runner.release();
        }
      }
    },
    LOCK_TIMEOUT_MS,
  );
};

/**
 * Run credential work on the connection holding the replica lock of `scope`, outside any
 * request transaction, in a savepoint of the lock transaction (rolled back if `work` fails).
 * With `commit`, the lock transaction is committed after `work` and the lock taken again.
 *
 * Use it for credential reads and writes that follow irreversible upstream side effects: a
 * refresh rotates the refresh token at the authorization server, so the new grant must be
 * durable at once (a rolled-back dashboard request must not restore the revoked token, and a
 * long locked action, such as a tool call, must not keep the replica revision row locked by
 * the binding write), and reads must see the latest committed state (a REPEATABLE READ
 * snapshot must not hide a rotation made by another request). The lock connection is already
 * held, so this needs no extra pooled connection. Without the lock, or outside replica mode,
 * `work` runs in the caller's context.
 *
 * Nested work joins the enclosing one, and the commit happens when the outermost work ends.
 *
 * Between that commit and the new acquisition, another replica may take the lock: it then
 * reads the committed grant. If it keeps the lock longer than the timeout, the new acquisition
 * fails; the write is committed, and the next credential work of this lock fails with
 * "Replica lock lost". Keep `work` to database operations: it is serialized with the other
 * credential work of the lock, and nothing it starts should outlive it.
 */
export const withLockConnection = <T>(
  scope: string,
  work: () => Promise<T>,
  { commit = false }: { commit?: boolean } = {},
): Promise<T> => {
  const runner = heldLocks.getStore()?.get(scope);
  if (!runner) return work();
  const key = JSON.stringify(['lock-connection', scope]);
  return withKeyedLock(key, async () => {
    if (!runner.isTransactionActive)
      throw new Error('Replica lock lost after a failed acquisition; retry the request');
    const enclosing = lockWork.getStore()?.get(key);
    if (enclosing) enclosing.commit ||= commit;
    const state = enclosing ?? { commit };
    await runner.startTransaction(); // SAVEPOINT
    let result: T;
    try {
      result = await lockWork.run(new Map(lockWork.getStore()).set(key, state), () =>
        databaseTransaction.run(runner, work),
      );
      await runner.commitTransaction(); // RELEASE SAVEPOINT
    } catch (error) {
      await runner.rollbackTransaction(); // ROLLBACK TO SAVEPOINT
      throw error;
    }
    if (!enclosing && state.commit) {
      await runner.commitTransaction();
      await acquire(runner, scope);
    }
    return result;
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

export const withKeyedLock = async <T>(
  key: string,
  action: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> => {
  if (heldKeyedLocks.getStore()?.has(key)) return action();

  const previous = keyedQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => gate);
  keyedQueues.set(key, next);
  const turn = previous.catch(() => undefined);
  if (timeoutMs === undefined) {
    await turn;
  } else {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      turn.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) {
      // Give the turn up: the callers queued behind pass once the current holder is done.
      void turn.then(() => {
        release();
        if (keyedQueues.get(key) === next) keyedQueues.delete(key);
      });
      throw new Error('Timed out waiting for a lock held in this process; retry the request');
    }
  }

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
