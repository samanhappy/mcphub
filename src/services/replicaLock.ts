import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryRunner } from 'typeorm';
import { getAppDataSource } from '../db/connection.js';
import { databaseTransaction } from '../db/transactionContext.js';
import { isReplicaMode } from '../utils/replicaMode.js';

// Held scopes and their owner: the connection holding the advisory lock, and whether the lock
// is still live. Tasks started under a lock inherit this map and may run after its release.
interface LockOwner {
  runner: QueryRunner;
  live: boolean;
}
const heldLocks = new AsyncLocalStorage<Map<string, LockOwner>>();
const liveOwner = (scope: string): LockOwner | undefined => {
  const owner = heldLocks.getStore()?.get(scope);
  return owner?.live ? owner : undefined;
};
const lockConnectionKey = (scope: string) => JSON.stringify(['lock-connection', scope]);
// Credential work in progress per lock: nested work joins it while it runs, and the outermost
// work commits. Tasks started under it inherit the marker and may run after it ends.
interface LockWork {
  commit: boolean;
  active: boolean;
}
const lockWork = new AsyncLocalStorage<Map<string, LockWork>>();
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
 * 10 seconds. Nested calls reenter while the lock is live; a task started under the lock that
 * calls it after the release queues like any other caller.
 */
export const withReplicaLock = async <T>(scope: string, action: () => Promise<T>): Promise<T> => {
  // Reentrant only while the lock is live: a task started under it may resume after the release.
  if (!isReplicaMode() || liveOwner(scope)) return action();
  // Same-process holders queue here, before the database lock: withLockConnection releases and
  // takes the database lock again after a write, and a request of this process waiting for the
  // in-process lock while holding the database one would block that new acquisition. Not
  // reentrant: an inherited queue marker would let a late task skip the queue.
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  return withKeyedLock(
    JSON.stringify(['replica-lock', scope]),
    async () => {
      const runner = getAppDataSource().createQueryRunner();
      const owner: LockOwner = { runner, live: false };
      try {
        await runner.connect();
        await acquire(runner, scope, deadline - Date.now());
        owner.live = true;
        return await heldLocks.run(new Map(heldLocks.getStore()).set(scope, owner), action);
      } finally {
        owner.live = false;
        // Wait for credential work still running on the connection, such as a task started under
        // the lock: committed writes are durable, the rest is rolled back.
        await withKeyedLock(
          lockConnectionKey(scope),
          async () => {
            try {
              if (runner.isTransactionActive) await runner.rollbackTransaction();
            } finally {
              await runner.release();
            }
          },
          { reentrant: false },
        );
      }
    },
    { timeoutMs: LOCK_TIMEOUT_MS, reentrant: false },
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
 * held, so this needs no extra pooled connection. Without a live lock (outside replica mode,
 * or work that waited past the release of the lock), `work` runs in the caller's context, as
 * credential work did before; the binding compare-and-save still rejects stale writes. The
 * release waits for credential work already running on the lock connection.
 *
 * Nested work joins the enclosing one while it runs, and the commit happens when the outermost
 * work ends.
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
  const owner = liveOwner(scope);
  if (!owner) return work();
  const key = lockConnectionKey(scope);
  const enclosing = lockWork.getStore()?.get(key);
  if (enclosing?.active) {
    // Nested work joins the enclosing work; the outermost one commits.
    enclosing.commit ||= commit;
    return inSavepoint(owner.runner, key, enclosing, work);
  }
  // Not reentrant: an inherited queue marker would let a late task skip the queue.
  return withKeyedLock(
    key,
    async () => {
      // The lock may have been released while this work waited for its turn.
      if (!owner.live) return work();
      const { runner } = owner;
      if (!runner.isTransactionActive)
        throw new Error('Replica lock lost after a failed acquisition; retry the request');
      const state: LockWork = { commit, active: true };
      try {
        const result = await inSavepoint(runner, key, state, work);
        if (state.commit) {
          await runner.commitTransaction();
          await acquire(runner, scope);
        }
        return result;
      } finally {
        state.active = false;
      }
    },
    { reentrant: false },
  );
};

/** Run `work` on the lock connection in a savepoint, rolled back if `work` fails. */
const inSavepoint = async <T>(
  runner: QueryRunner,
  key: string,
  state: LockWork,
  work: () => Promise<T>,
): Promise<T> => {
  await runner.startTransaction(); // SAVEPOINT
  try {
    const result = await lockWork.run(new Map(lockWork.getStore()).set(key, state), () =>
      databaseTransaction.run(runner, work),
    );
    await runner.commitTransaction(); // RELEASE SAVEPOINT
    return result;
  } catch (error) {
    await runner.rollbackTransaction(); // ROLLBACK TO SAVEPOINT
    throw error;
  }
};

/**
 * In-process, per-key promise-chain lock, reentrant unless `reentrant: false`. `withReplicaLock` above
 * is a no-op outside replica mode because there is no cross-process lock to
 * take; this keeps same-key async work serialized within a single process
 * (e.g. a server's OAuth flows) in both modes.
 */
const heldKeyedLocks = new AsyncLocalStorage<Set<string>>();
const keyedQueues = new Map<string, Promise<unknown>>();

export const withKeyedLock = async <T>(
  key: string,
  action: () => Promise<T>,
  {
    timeoutMs,
    reentrant = true,
  }: {
    /** Give the turn up and reject after this delay. */
    timeoutMs?: number;
    /** Let nested calls of the same async context run at once; otherwise they queue too. */
    reentrant?: boolean;
  } = {},
): Promise<T> => {
  if (reentrant && heldKeyedLocks.getStore()?.has(key)) return action();

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

  // A non-reentrant holder leaves no marker for the tasks it starts to inherit.
  const held = reentrant ? new Set(heldKeyedLocks.getStore()).add(key) : undefined;
  try {
    return held ? await heldKeyedLocks.run(held, action) : await action();
  } finally {
    held?.delete(key);
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
