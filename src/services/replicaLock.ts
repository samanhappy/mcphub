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
