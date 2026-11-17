import treeKill from 'tree-kill';
import {
  captureProcessTreeSync,
  isProcessTreeKillAvailable,
  readProcessStartTimesSync,
  UNKNOWN_START_TIME,
  type ProcessSnapshotEntry,
  type ProcessTreeSnapshot,
} from '../utils/processTree.js';
import { logger } from '../utils/logger.js';

// Takes the pre-close snapshot without being able to fail. captureProcessTreeSync
// wraps its own I/O and is total today, but this is a synchronous call at the top
// of the only shutdown path: were it ever to throw, cleanupAllServers would abort
// mid-loop, every server after this one would stay open, and the caller's catch
// would skip drainStdioTerminations entirely, so every termination already
// started is abandoned by the process.exit() that follows. That is the orphan
// class this code exists to prevent, and it must not rest on the capture
// staying total.
//
// A pid that cannot be signalled is reported rather than passed on, because an
// unusable pid otherwise means cleanup silently does not happen, which in the
// log is indistinguishable from cleanup that worked.
// Reads the pid as well as taking the snapshot, because `transport.pid` is a
// getter on an object this code does not own: the SDK's cannot throw, but a
// replica or a disposed custom transport is duck-typed in here, and a throw
// while reading it would abort the shutdown loop exactly as a throwing capture
// would. Returns the pid it managed to read, so the caller never reads it twice.
export const captureStdioTreeSafely = (
  serverName: string,
  readPid: () => unknown,
): { pid: number | null; captured: ProcessTreeSnapshot } => {
  const none = { pid: null, captured: { descendants: [] } };
  let raw: unknown;
  try {
    raw = readPid();
  } catch (err) {
    logger.warn('Could not read the pid of an stdio transport, skipping process-tree cleanup', {
      serverName,
      err,
    });
    return none;
  }
  if (raw === null || raw === undefined) {
    // An http or sse transport, or a stdio one that never started. Nothing to
    // clean up and nothing worth saying.
    return none;
  }
  if (typeof raw !== 'number' || !isSignallableTarget(raw)) {
    // A number that must never be signalled, or not a number at all. Either
    // way cleanup cannot happen, and silence here is indistinguishable in the
    // log from cleanup that worked.
    logger.warn('Not cleaning up an stdio process tree: unusable pid', {
      serverName,
      pid: raw,
      type: typeof raw,
    });
    return none;
  }
  try {
    return { pid: raw, captured: captureProcessTreeSync(raw) };
  } catch (err) {
    logger.warn('Could not capture the stdio process tree, watching the root pid alone', {
      serverName,
      pid: raw,
      err,
    });
    return { pid: raw, captured: { descendants: [] } };
  }
};

// Grace period after sending SIGTERM to a stdio process tree before falling back
// to SIGKILL. Long enough to let well-behaved servers shut down cleanly, short
// enough that a hung child does not block the container indefinitely.
const STDIO_KILL_GRACE_PERIOD_MS = 2000;

// Default bound a caller should allow when waiting for stdio terminations
// before it exits the process. It is a bound, not a pause: the wait ends as
// soon as the processes are gone, and this only decides how long a caller is
// willing to hang on for a server that will not die.
export const STDIO_TERMINATION_DRAIN_BUDGET_MS = STDIO_KILL_GRACE_PERIOD_MS + 3000;

// Interval between liveness probes while waiting for a signalled process tree
// to exit. The probe is what ends the wait, so a server that honours SIGTERM
// does not cost a caller the whole grace period, and a slow host only costs
// what it actually needs.
const STDIO_KILL_POLL_INTERVAL_MS = 50;

// How long a single termination may stay on the pending list. Nothing should
// reach it: it exists so a tree-kill callback that never fires, or a process
// that cannot be signalled at all, eventually leaves the list instead of
// pinning it for the lifetime of the hub.
const STDIO_TERMINATION_CAP_MS = STDIO_KILL_GRACE_PERIOD_MS + 60_000;

// Terminations started by killStdioProcessTree that are not finished yet. Both
// halves of a termination are asynchronous: tree-kill signals the tree from its
// own child process, and the SIGKILL fallback runs on a timer. process.exit()
// cancels both, so a caller that is about to exit drains this set first (see
// drainStdioTerminations) rather than orphaning an `npx` wrapper's descendants.
//
// An outcome of 'gone' means the pid was observed to disappear. 'unconfirmed'
// means it was not, and the caller is told which pids those were, because a
// kill that was merely sent is not a process that has stopped.
type StdioTerminationOutcome = 'gone' | 'unconfirmed';

interface PendingStdioTermination {
  serverName: string;
  pid: number;
  // Every pid this termination is waiting on: the transport's own child first,
  // then the descendants captured before it was signalled. Mutated in place by
  // killStdioProcessTree as it drops pids it has stopped watching.
  pids: number[];
  outcome: Promise<StdioTerminationOutcome>;
  // Set as the outcome settles, so a drain that gives up on its budget can
  // still tell which entries had finished and which had not. Reading the
  // outcomes alone cannot: on the timeout path there is nothing to read.
  settledOutcome?: StdioTerminationOutcome;
  // Cancels this termination's liveness probes. Called when the outcome is
  // known, and by the test-only reset helper.
  stopWatching: () => void;
}

const pendingStdioTerminations = new Set<PendingStdioTermination>();

// Resolves with `value` after `ms`, without holding the event loop open, and
// hands back a way to cancel the timer once nobody is waiting for it.
const afterDelay = <T>(ms: number, value: T): { promise: Promise<T>; cancel: () => void } => {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(value), ms);
    timer.unref?.();
  });
  return {
    promise,
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
};

const trackStdioTermination = (
  serverName: string,
  pid: number,
  work: Promise<StdioTerminationOutcome>,
  options: { pids?: number[]; stopWatching?: () => void } = {},
): void => {
  const cap = afterDelay(STDIO_TERMINATION_CAP_MS, 'unconfirmed' as const);
  const outcome = Promise.race([work.catch(() => 'unconfirmed' as const), cap.promise]);
  const entry: PendingStdioTermination = {
    serverName,
    pid,
    pids: options.pids ?? [pid],
    outcome,
    stopWatching: options.stopWatching ?? ((): void => {}),
  };
  pendingStdioTerminations.add(entry);
  void outcome.then((settled) => {
    entry.settledOutcome = settled;
    pendingStdioTerminations.delete(entry);
    cap.cancel();
    // Whichever side of the race won, nothing reads the probes any more. The
    // cap in particular has to take the poll loop with it: a pid that cannot
    // be signalled at all (EPERM) keeps answering the liveness probe forever,
    // and one leaked loop per disable/reconnect runs for the hub's lifetime.
    entry.stopWatching();
  });
};

/**
 * Waits until every pending stdio process tree has been observed to go away,
 * giving up after `timeoutMs`. Resolves true only when all of them were seen to
 * disappear, so a caller about to exit knows the difference between "they are
 * gone" and "the signals were sent". Terminations started after the call are
 * not awaited.
 *
 * The timeout is a ceiling, not a delay: on an idle host this returns in
 * milliseconds, and a slow or loaded host only pays for what it needs.
 */
export const drainStdioTerminations = async (
  timeoutMs: number = STDIO_TERMINATION_DRAIN_BUDGET_MS,
): Promise<boolean> => {
  // A non-finite or negative budget would otherwise become "give up at once",
  // reported as if the wait had been honoured.
  const budgetMs =
    Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : STDIO_TERMINATION_DRAIN_BUDGET_MS;
  const pending = [...pendingStdioTerminations];
  if (pending.length === 0) {
    // Said out loud: "nothing was pending" and "everything is gone" are both
    // reported as true, and an operator has to be able to tell them apart.
    logger.log('No upstream stdio terminations were pending');
    return true;
  }

  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), budgetMs);
  });

  try {
    const result = await Promise.race([Promise.all(pending.map((entry) => entry.outcome)), expiry]);

    if (result !== 'timeout' && result.every((outcome) => outcome === 'gone')) {
      logger.log('Upstream stdio process trees are gone', {
        count: pending.length,
        // Only the terminations that were pending when this call started. A
        // close that happens during the drain is neither counted nor waited
        // for, and "are gone" on its own reads as a claim about everything.
        startedSinceThisCall: pendingStdioTerminations.size,
      });
      return true;
    }

    // Name the survivors: this line is how anyone finds the orphans later. The
    // outcomes decide which ones those are, NOT membership of
    // pendingStdioTerminations: an entry removes itself from that set as soon
    // as its outcome settles, and it settles before this code runs, so asking
    // the set produced an empty list on every path but a timeout — exactly the
    // path where naming the orphan matters most.
    const outcomes = result === 'timeout' ? null : result;
    logger.warn('Upstream stdio process trees were not confirmed gone', {
      budgetMs,
      timedOut: result === 'timeout',
      pending: pending
        .filter((entry, index) =>
          // On the timeout path there are no outcomes to read, so each entry
          // answers for itself: one that settled 'gone' before the budget ran
          // out is not a survivor and naming it sends whoever reads this after
          // a process that stopped on its own.
          outcomes === null ? entry.settledOutcome !== 'gone' : outcomes[index] !== 'gone',
        )
        .map((entry) => ({ serverName: entry.serverName, pid: entry.pid, pids: [...entry.pids] })),
    });
    return false;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

// Test-only helper to forget pending terminations, so one test's unconfirmed
// pid cannot change the answer a later test gets. Not for production use.
export const resetStdioTerminationsForTest = (): void => {
  for (const entry of pendingStdioTerminations) {
    // Forgetting the entry is not enough: its probes would keep running and
    // keep answering for a pid the next test reuses.
    entry.stopWatching();
  }
  pendingStdioTerminations.clear();
};

// Kill the entire process tree of a stdio transport's child process.
//
// transport.close() only sends SIGTERM to the direct child. When the server is
// launched through a wrapper like `npx` / `npm exec`, the wrapper does not
// forward signals to its descendants, so the real server process is left
// running as an orphan. Walk the whole tree and force-kill it.
//
// When the process-lister tool tree-kill needs (`ps` on Linux) is missing —
// e.g. slim Docker images without procps — tree-kill's internal spawn fails
// with an unhandled 'error' event that would crash MCPHub. Fall back to
// signaling just the direct child instead (issue #1072).
// process.kill() takes a negative pid as "the whole process group", and in a
// container pid 1 is MCPHub itself. Neither is ever the intended target, and the
// hub's own pid never is either. Every path that names a pid to the kernel goes
// through this, the liveness probe included, rather than trusting its caller: a
// caller that checks the pid for truthiness alone lets pid 1 through, and
// probing pid 0 asks about the hub's own process group, which answers "alive"
// for as long as the hub runs.
const isSignallableTarget = (target: number): boolean =>
  Number.isInteger(target) && target > 1 && target !== process.pid;

export function killStdioProcessTree(
  name: string,
  pid: number,
  captured: ProcessTreeSnapshot = { descendants: [] },
): void {
  const safeDirectKillPid = (target: number, signal: 'SIGTERM' | 'SIGKILL'): void => {
    if (!isSignallableTarget(target)) {
      logger.warn('Refusing to signal pid', { serverName: name, pid: target, signal });
      return;
    }
    try {
      process.kill(target, signal);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') {
        logger.warn('Failed to send signal to process', {
          serverName: name,
          pid: target,
          signal,
          err,
        });
      }
    }
  };

  const safeDirectKill = (signal: 'SIGTERM' | 'SIGKILL'): void => safeDirectKillPid(pid, signal);

  // Resolves once tree-kill's own child process has finished signalling the
  // tree. Callers that exit the process must wait for that, or the kill never
  // reaches the descendants.
  const safeTreeKill = (signal: 'SIGTERM' | 'SIGKILL'): Promise<void> =>
    new Promise((resolve) => {
      // The same guard safeDirectKillPid applies, for the same reason. tree-kill
      // signals a whole tree, so reaching it with pid 1, a negative pid or the
      // hub's own pid is worse than a stray single signal, and a caller that
      // only checked the pid for truthiness lets pid 1 through.
      if (!isSignallableTarget(pid)) {
        logger.warn('Refusing to signal process tree', { serverName: name, pid, signal });
        resolve();
        return;
      }
      try {
        treeKill(pid, signal, (err) => {
          if (err) {
            // ESRCH (no such process) is expected when the process already
            // exited: treat that as success. Anything else is worth a warning.
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== 'ESRCH') {
              // Pass the user-controlled `name` as a separate argument so a
              // server named e.g. "%s" cannot inject format specifiers into the
              // log line (CodeQL: use-of-externally-controlled-format-string).
              logger.warn('Failed to send signal to process tree', {
                serverName: name,
                pid,
                signal,
                err,
              });
            }
          }
          resolve();
        });
      } catch (err) {
        logger.warn('Failed to send signal to process tree', {
          serverName: name,
          pid,
          signal,
          err,
        });
        resolve();
      }
    });

  const safeKill = isProcessTreeKillAvailable()
    ? safeTreeKill
    : (signal: 'SIGTERM' | 'SIGKILL'): Promise<void> => {
        logger.warn('Process lister unavailable, killing only the direct child process', {
          serverName: name,
          pid,
          signal,
        });
        safeDirectKill(signal);
        return Promise.resolve();
      };

  // Descendants captured before anything signalled this tree (see
  // captureProcessTreeSync). Watched by pid from here on: once an `npx`
  // wrapper exits, its children are reparented and tree-kill's `ps --ppid`
  // walk returns nothing, so the root going away says nothing about them.
  const watched: ProcessSnapshotEntry[] = captured.descendants.filter((entry) => entry.pid !== pid);
  const rootStartedAt = captured.rootStartedAt;
  const watchedPids = [pid, ...watched.map((entry) => entry.pid)];

  // Set once the root pid is known to belong to something else. The process
  // that was captured must have exited for its pid to be reusable, so from then
  // on the root is neither signalled nor waited for. Without this the stranger
  // keeps answering the liveness probe and the wait runs to its cap, reporting
  // a process that did stop as unconfirmed.
  let rootForgotten = false;

  const forgetRoot = (): void => {
    if (rootForgotten) {
      return;
    }
    rootForgotten = true;
    const index = watchedPids.indexOf(pid);
    if (index >= 0) {
      watchedPids.splice(index, 1);
    }
  };

  const isAnyoneAlive = (): boolean =>
    (!rootForgotten && isProcessAlive(pid)) || watched.some((entry) => isProcessAlive(entry.pid));

  // True when the root pid still looks like the process whose tree was
  // captured. Without a captured start time (win32, or a host whose process
  // table could not be read) there is nothing to compare, and the answer is
  // the behaviour this had before: go ahead.
  let saidUnchecked = false;
  const rootIsStillOurs = (): boolean => {
    if (rootForgotten) {
      return false;
    }
    if (rootStartedAt === undefined) {
      // No token, so the pid is signalled on trust. On win32 and on a host
      // whose table cannot be read that is the documented fallback and saying
      // so every close would be noise. A table that WAS read and did not list
      // the root is a different thing, and silence there reads as a check that
      // passed.
      if (captured.rootUnknown && !saidUnchecked) {
        saidUnchecked = true;
        logger.warn('Signalling an stdio process tree without checking its identity', {
          serverName: name,
          pid,
          reason: 'the process table did not list the root pid',
        });
      }
      return true;
    }
    const current = readProcessStartTimesSync([pid]);
    if (current === null) {
      // A token was captured for this root and the lookup that would check it
      // failed, so this is "could not verify", not "verified". Treating it as
      // confirmation is how a reused pid gets its tree signalled: capture pid
      // X, the wrapper exits, X is reused, the lookup times out, and SIGTERM
      // then SIGKILL reach the new owner and everything under it. Not signalled
      // and not forgotten: unknown is not gone either, so the wait stands and
      // reports unconfirmed rather than claiming a process stopped.
      logger.warn('Could not verify the identity of an stdio root pid, not signalling its tree', {
        serverName: name,
        pid,
      });
      return false;
    }
    const startedAt = current.get(pid);
    if (startedAt === rootStartedAt) {
      return true;
    }
    if (startedAt === UNKNOWN_START_TIME) {
      // The pid exists and the kernel would not describe it. Not a stranger,
      // not ours either, so do not signal its tree and do not drop it from the
      // wait: dropping it would report a process that may still be running as
      // gone.
      logger.warn('Cannot confirm the identity of an stdio root pid, not signalling its tree', {
        serverName: name,
        pid,
      });
      return false;
    }
    // Absent from the map is "the kernel says this pid is gone". Signalling a
    // gone pid is harmless (ESRCH), and NOT signalling it is harmless too, so
    // the safe reading wins: with /proc mounted hidepid=2 or subset=pid, a live
    // process owned by another user also reads as absent, and a hub running as
    // root would tree-kill it rather than failing EPERM.
    logger.warn('Not signalling the tree of a pid that is no longer the upstream process', {
      serverName: name,
      pid,
      reason: startedAt === undefined ? 'not listed' : 'start time differs',
    });
    forgetRoot();
    return false;
  };

  // The first SIGTERM is checked too. The transport's own close() has already
  // sent one by the time this runs, so the wrapper may have exited and its pid
  // been reused in between — and tree-kill would then walk a stranger's
  // children, not ours. Captured descendants are unaffected: they are signalled
  // on their own identities during escalation.
  const termination = rootIsStillOurs() ? safeKill('SIGTERM') : Promise.resolve();

  // Three invariants for whoever edits this next. Every branch must resolve, or
  // the entry stays on pendingStdioTerminations until its cap and spoils the
  // answer every later drain gives. The root's SIGKILL is issued inside the
  // timer callback, synchronously, so the escalation keeps the instant it fired
  // at before it became observable; the captured descendants are signalled
  // after it, once tree-kill's own child has finished. And every exit path goes
  // through stopWatching, so no probe outlives the wait that reads it.
  let stopWatching = (): void => {};

  const gone = new Promise<StdioTerminationOutcome>((resolve) => {
    let pollTimer: NodeJS.Timeout | undefined;
    let escalationTimer: NodeJS.Timeout | undefined;
    let settled = false;

    const clearProbes = (): void => {
      settled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      if (escalationTimer) {
        clearTimeout(escalationTimer);
        escalationTimer = undefined;
      }
    };

    // Called when the outcome is already known, including by the cap and by
    // the test reset helper. It resolves as well as clearing, so the promise
    // chain reading it is released instead of being retained for the lifetime
    // of the hub.
    stopWatching = (): void => {
      const alreadySettled = settled;
      clearProbes();
      if (!alreadySettled) {
        resolve('unconfirmed');
      }
    };

    const finish = (outcome: StdioTerminationOutcome): void => {
      if (settled) {
        return;
      }
      clearProbes();
      resolve(outcome);
    };

    // Stop watching a pid that has been recycled: it belongs to someone else
    // now, so neither signalling it nor waiting for it means anything.
    const forget = (target: number): void => {
      const index = watched.findIndex((entry) => entry.pid === target);
      if (index >= 0) {
        watched.splice(index, 1);
      }
      const trackedIndex = watchedPids.indexOf(target);
      if (trackedIndex >= 0) {
        watchedPids.splice(trackedIndex, 1);
      }
    };

    // The probe decides when this is over, not a timer: it watches until every
    // pid is actually gone. That is what makes the wait as short as the host
    // allows rather than a fixed pause, and it is the only thing that can tell
    // a delivered signal from a stopped process.
    const probe = (): void => {
      if (settled) {
        return;
      }
      if (!isAnyoneAlive()) {
        finish('gone');
        return;
      }
      scheduleProbe();
    };

    const scheduleProbe = (): void => {
      pollTimer = setTimeout(probe, STDIO_KILL_POLL_INTERVAL_MS);
      pollTimer.unref?.();
    };

    const escalate = async (): Promise<void> => {
      if (settled) {
        return;
      }
      if (!isAnyoneAlive()) {
        finish('gone');
        return;
      }

      // The root's tree first: whatever is still attached to it goes with it.
      // Its identity is checked too, because tree-kill walks whatever children
      // the pid has now, and after this long the pid may belong to a stranger.
      if (isProcessAlive(pid) && rootIsStillOurs()) {
        await safeKill('SIGKILL');
      }

      // The await above yields for as long as tree-kill's own child takes, and
      // the cap or a test reset can land inside that window. Nothing below may
      // send a signal on behalf of a wait that has already been abandoned.
      if (settled) {
        return;
      }

      const survivors = watched.filter((entry) => isProcessAlive(entry.pid));
      if (survivors.length === 0) {
        return;
      }

      // Then the captured pids, one by one. The wrapper may already be gone,
      // which is exactly why these are not reachable through its tree any
      // more. A pid can have been recycled in the meantime, so each one is
      // signalled only while the kernel still reports the start time it had
      // when it was captured.
      const startTimes = readProcessStartTimesSync(survivors.map((entry) => entry.pid));
      if (startTimes === null) {
        // The process table could not be read, so identity cannot be
        // established for any of them. Signalling anyway is how a recycled pid
        // gets killed, and tree-kill has already covered everything still
        // attached to the root.
        logger.warn('Cannot confirm pid identity, not signalling captured pids', {
          serverName: name,
          pids: survivors.map((entry) => entry.pid),
        });
        return;
      }
      for (const survivor of survivors) {
        const startedAt = startTimes.get(survivor.pid);
        if (startedAt === UNKNOWN_START_TIME) {
          // Exists, but the kernel would not say what it is. Not signalled,
          // and not forgotten either: it may still be the captured process,
          // and calling it gone would be a claim this cannot support. One such
          // pid must not stop the others being dealt with, which is why this
          // is decided per pid rather than for the whole lookup.
          logger.warn('Cannot confirm the identity of a captured pid, not signalling it', {
            serverName: name,
            pid: survivor.pid,
          });
          continue;
        }
        if (startedAt !== survivor.startedAt) {
          // Either the pid is gone (nothing to do) or it is somebody else's
          // now. Both mean: stop watching it, never signal it.
          logger.warn('Not signalling a pid that is no longer the captured process', {
            serverName: name,
            pid: survivor.pid,
          });
          forget(survivor.pid);
          continue;
        }
        safeDirectKillPid(survivor.pid, 'SIGKILL');
      }

      if (!isAnyoneAlive()) {
        finish('gone');
      }
    };

    escalationTimer = setTimeout(() => {
      void escalate();
    }, STDIO_KILL_GRACE_PERIOD_MS);

    scheduleProbe();
  });

  // The SIGTERM spawn has to finish as well: on Windows tree-kill shells out to
  // taskkill, and a caller that exits before that spawn has run kills the kill.
  //
  // An observed exit outweighs it, though. Waiting for both meant a tree-kill
  // whose callback never fires — a hung taskkill is the real case — turned a
  // shutdown where every pid had been seen to go into a reported orphan. Once
  // the processes are gone there is nothing left for that spawn to deliver.
  const settled = gone.then(async (outcome) => {
    if (outcome === 'gone') {
      return outcome;
    }
    await termination.catch(() => undefined);
    return outcome;
  });

  trackStdioTermination(name, pid, settled, {
    pids: watchedPids,
    stopWatching: () => stopWatching(),
  });
}

function isProcessAlive(pid: number): boolean {
  // Signal 0 sends nothing, but it is still a pid named to the kernel: pid 0
  // asks about the hub's own process group and would answer "alive" forever,
  // which is a wait that can never end rather than a stray signal.
  if (!isSignallableTarget(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we don't have permission to signal
    // it — count it as alive so the SIGKILL fallback still fires. Any other
    // error (typically ESRCH) means the process is gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
