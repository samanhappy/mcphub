import { logger } from './logger.js';

/**
 * Collaborators the bind-failure path needs. They are passed in rather than
 * imported so this module stays free of the upstream-server service, which
 * cannot be loaded without its whole dependency graph.
 */
export interface BindFailureExitOptions {
  /** The `error` event the HTTP listener reported. */
  error: NodeJS.ErrnoException;
  /** Host that was requested, or undefined for all interfaces. */
  host: string | undefined;
  /** Port that was requested. */
  port: number | string;
  /** Starts termination of every upstream server, typically `cleanupAllServers`. */
  cleanupUpstreamServers: () => void;
  /** Waits for those terminations to settle, typically `drainStdioTerminations`. */
  drainUpstreamTerminations: (timeoutMs: number) => Promise<boolean>;
  /** Upper bound on that wait. */
  budgetMs: number;
  /** Overridable for tests; defaults to `process.exit`. */
  exit?: (code: number) => void;
}

/**
 * Handles a fatal HTTP bind failure: report it, stop the upstream servers, wait
 * for that cleanup to settle, then exit with status 1.
 *
 * The wait is the point. Terminating a stdio upstream server is asynchronous -
 * tree-kill signals the process tree from its own child process and a timer
 * escalates to SIGKILL: so calling `process.exit(1)` straight after starting
 * the cleanup cancels it and leaves descendants launched through `npx` running.
 * Repeated restarts would then accumulate orphans. The wait is bounded, so a
 * hung upstream server cannot keep a hub alive that has no listener either.
 *
 * Orphans accumulating across restarts is a native, pm2 or systemd concern: in
 * a container the hub is PID 1 and its namespace goes with it.
 */
export const exitAfterBindFailure = async (options: BindFailureExitOptions): Promise<void> => {
  const {
    error,
    host,
    port,
    cleanupUpstreamServers,
    drainUpstreamTerminations,
    budgetMs,
    exit = (code: number) => process.exit(code),
  } = options;

  // Everything below is inside the try. The caller cannot await this function,
  // so a rejection escaping here would be reported as a recoverable error and
  // leave a hub running with no listener: the state this handler exists to
  // prevent. In production `exit` ends the process; under test it is a spy and
  // execution continues past it, so nothing may be added after the finally.
  try {
    logger.error(
      `[FATAL] Cannot listen on ${host ?? 'all interfaces'}:${port} (${error.code ?? error.message}); exiting`,
    );

    try {
      cleanupUpstreamServers();
    } catch (err) {
      logger.warn('Upstream cleanup failed while handling a bind failure', { err });
    }

    try {
      // The budget is enforced here as well as inside the wait, so a wait that
      // never resolves cannot hold the process in this handler.
      const settled = await withBudget(drainUpstreamTerminations(budgetMs), budgetMs);
      if (!settled) {
        logger.warn(
          `Upstream stdio cleanup did not settle within ${budgetMs} ms; exiting with possible orphans`,
        );
      }
    } catch (err) {
      logger.warn('Waiting for upstream stdio cleanup failed; exiting anyway', { err });
    }
  } finally {
    exit(1);
  }
};

/** Resolves false when `work` has not resolved within `budgetMs`. */
const withBudget = async (work: Promise<boolean>, budgetMs: number): Promise<boolean> => {
  const bounded = Number.isFinite(budgetMs) && budgetMs >= 0 ? budgetMs : 0;
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), bounded);
    timer.unref?.();
  });

  try {
    return await Promise.race([work, expiry]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};
