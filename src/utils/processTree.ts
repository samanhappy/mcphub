import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

// tree-kill walks the stdio process tree by spawning `ps` on Linux (and other
// Unix platforms). Slim container images often ship without procps, so that
// spawn fails with ENOENT as an unhandled 'error' event on tree-kill's
// internal child process — an uncaught exception MCPHub cannot intercept via
// tree-kill's callback. Detect tool availability up front so callers can fall
// back to signaling the direct child only (issue #1072).

let cachedAvailability: boolean | null = null;

const WELL_KNOWN_BIN_DIRS = ['/bin', '/usr/bin', '/sbin', '/usr/sbin'];

function findExecutableOnDisk(name: string): boolean {
  const candidates = WELL_KNOWN_BIN_DIRS.map((dir) => path.join(dir, name));
  const pathDirs = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => dir.length > 0);
  candidates.push(...pathDirs.map((dir) => path.join(dir, name)));

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      // Not present or not executable here — keep looking.
    }
  }
  return false;
}

/**
 * Whether the external tool tree-kill relies on is available on this platform.
 * win32 uses taskkill and darwin uses pgrep — both ship with the OS. All other
 * platforms require `ps` from procps, which minimal images frequently lack.
 * The result is cached for the process lifetime; use
 * `resetProcessTreeKillCache` in tests.
 */
export function isProcessTreeKillAvailable(): boolean {
  if (cachedAvailability === null) {
    cachedAvailability =
      process.platform === 'win32' ||
      process.platform === 'darwin' ||
      findExecutableOnDisk('ps');
  }
  return cachedAvailability;
}

export function resetProcessTreeKillCache(): void {
  cachedAvailability = null;
}

// A pid together with the start time the kernel reports for it. The start time
// is the identity token: it separates "still the process we captured" from
// "this pid has been recycled by something else", which matters because these
// pids are signalled directly, outside any live tree walk.
export interface ProcessSnapshotEntry {
  pid: number;
  startedAt: string;
}

// Returned for a pid the kernel exists for but will not describe. A real start
// time is digits on Linux and a date off it, so this matches neither, and a
// caller comparing it against a captured token always sees a mismatch. It is
// NOT the same as a pid being absent, which means gone.
export const UNKNOWN_START_TIME = 'unknown';

export interface ProcessTreeSnapshot {
  // The root's own start time as of the snapshot. Undefined when the process
  // table could not be read, or the root was already gone when it was taken.
  rootStartedAt?: string;
  // True when the table WAS read and the root pid simply was not in it. Says
  // apart the two reasons there is no token, which otherwise look identical to
  // the caller and both end in "signal it unchecked": a table that could not be
  // read at all, and a readable table whose root row is missing or hidden. Only
  // the second is worth a word in the log, since the first is also win32 and
  // every host without `ps`.
  rootUnknown?: boolean;
  descendants: ProcessSnapshotEntry[];
}

interface ProcessListing {
  pid: number;
  ppid: number;
  startedAt: string;
}

// pid 0 means the caller's own process group, so a signal to it would reach
// every process in MCPHub's group, and pid 1 is init, which in a container is
// MCPHub itself. Neither is something this code wants to signal, and a negative
// value reaching process.kill() names a process group as well.
const isSignallablePid = (pid: number): boolean => Number.isInteger(pid) && pid > 1;

const PROC_ROOT = '/proc';

// Everywhere other than Linux, `ps` is what there is. `-A`, `-o` and the `=`
// that suppresses a header are POSIX, but `lstart` is a BSD and procps
// extension, so a host with a narrower `ps` rejects this and gets no snapshot:
// `runPs` throws, the caller reads null, and behaviour falls back to watching
// the root pid alone. Degraded, and no worse than before this existed.
//
// `lstart` also resolves only to the second, which makes it a weaker identity
// token than Linux's `starttime` in clock ticks: two processes that start
// inside the same second and share a recycled pid compare equal. That needs pid
// wraparound within one second to reach, and no finer start time is available
// portably.
//
// The projection is deliberately minimal: `comm` and `args` are NOT read.
// Several published MCP servers carry API keys in argv, and a listing that
// included them would turn this into a credential capture, with the values
// reaching log payloads.
const PS_SNAPSHOT_ARGS = ['-A', '-o', 'pid=,ppid=,lstart='];
const PS_TIMEOUT_MS = 2000;
const PS_MAX_BUFFER = 8 * 1024 * 1024;

// A FAILING `ps` is cached for this long. Without that, a hung `ps` costs
// PS_TIMEOUT_MS per closing server, synchronously, and an N-server shutdown
// blows through the drain budget before a single SIGTERM has been sent.
//
// A SUCCESSFUL listing is deliberately not cached, though an earlier version of
// this did cache it for the same window. Reusing one is unsound for a snapshot:
// the pids in it are turned into an identity token and then signalled. A
// listing taken before the hub's child was spawned still attributes that pid
// number to its previous owner, so a capture served from it would take the
// PREVIOUS owner's start time as the root's, and — worse — enter that owner's
// surviving children as this server's captured descendants. Those children
// then pass their own identity check, because their start times are genuinely
// unchanged, and the escalation SIGKILLs processes that were never ours. The
// cost of reading per close is one fork per closing server on the platforms
// that need `ps` at all; Linux reads /proc and forks nothing.
const PS_FAILURE_CACHE_MS = 200;

let cachedPsFailure: { at: number } | null = null;

function parsePsRows(stdout: string): ProcessListing[] {
  const rows: ProcessListing[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    // pid, ppid, then lstart, which itself contains spaces.
    const match = /^(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(trimmed);
    if (!match) {
      // Dropped, which means a row this cannot read is reported as a pid that
      // is not there. On the /proc path the same situation is reported as
      // "cannot tell" instead (see readProcStatOrUnknown); the distinction is
      // not available here, because `ps` gives no way to tell a line it could
      // not produce from a line that was never asked for.
      continue;
    }
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), startedAt: match[3] });
  }
  return rows;
}

function runPs(args: string[]): ProcessListing[] {
  const stdout = execFileSync('ps', args, {
    encoding: 'utf8',
    timeout: PS_TIMEOUT_MS,
    maxBuffer: PS_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return parsePsRows(stdout);
}

// Fields of /proc/<pid>/stat: 1 pid, 2 comm, 3 state, 4 ppid, 22 starttime.
// `comm` is parenthesised and may itself contain spaces and parentheses, so
// everything is counted from the LAST ')', after which field 3 comes first.
// `starttime` is in clock ticks since boot: monotonic, unaffected by an NTP
// step, and finer than the one-second resolution of a formatted date.
function parseProcStat(pid: number, stat: string): ProcessListing | null {
  const commEnd = stat.lastIndexOf(')');
  if (commEnd < 0) {
    return null;
  }
  const fields = stat
    .slice(commEnd + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number(fields[1]);
  const startedAt = fields[19];
  if (!Number.isFinite(ppid) || startedAt === undefined) {
    return null;
  }
  return { pid, ppid, startedAt };
}

function readProcStat(pid: number): ProcessListing | null {
  try {
    return parseProcStat(pid, fs.readFileSync(path.join(PROC_ROOT, String(pid), 'stat'), 'utf8'));
  } catch {
    // Gone between the listing and the read, or hidden by hidepid.
    return null;
  }
}

// The same read, but it keeps the two reasons a pid yields nothing apart.
// ENOENT is an answer: the pid is gone. Anything else (EACCES under hidepid, or
// a stat line that will not parse) means the kernel would not say, and a caller
// comparing identities must not read "would not say" as "absent". That is the
// same shape as "this pid is a stranger now", and it would turn an unreadable
// live process into a confirmed-gone one.
function readProcStatOrUnknown(pid: number): ProcessListing | null | 'unknown' {
  let stat: string;
  try {
    stat = fs.readFileSync(path.join(PROC_ROOT, String(pid), 'stat'), 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'unknown';
  }
  return parseProcStat(pid, stat) ?? 'unknown';
}

function readProcListing(): ProcessListing[] {
  const rows: ProcessListing[] = [];
  for (const entry of fs.readdirSync(PROC_ROOT)) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const row = readProcStat(Number(entry));
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

function readProcessListing(): ProcessListing[] | null {
  if (process.platform === 'linux') {
    try {
      return readProcListing();
    } catch (err) {
      logger.debug('Could not read the process table from /proc', { err });
      return null;
    }
  }
  const now = Date.now();
  // Only a recent FAILURE short-circuits. A successful listing is always read
  // fresh, for the reason given at PS_FAILURE_CACHE_MS.
  if (cachedPsFailure && now - cachedPsFailure.at < PS_FAILURE_CACHE_MS) {
    return null;
  }
  try {
    const rows = runPs(PS_SNAPSHOT_ARGS);
    cachedPsFailure = null;
    return rows;
  } catch (err) {
    logger.debug('Could not read the process table from ps', { err });
    // Timed from when the failure came back, not from before the call. A `ps`
    // that hangs for its whole timeout takes longer than this window, so
    // stamping it with the earlier time left the entry already expired on
    // return and every closing server paid the timeout over again, which is
    // the one thing this cache exists to prevent.
    cachedPsFailure = { at: Date.now() };
    return null;
  }
}

/**
 * Every descendant of `pid` at this moment with the start time of each, plus
 * the root's own start time.
 *
 * Taken synchronously and deliberately: it has to run before anything signals
 * the tree. Once a wrapper such as `npx` exits, its children are reparented to
 * init and no `--ppid` walk can find them again, so the pids have to be in hand
 * first. An asynchronous snapshot would race the SIGTERM that the transport's
 * own `close()` sends.
 *
 * Returns nothing on win32, where tree-kill shells out to `taskkill /T /F` and
 * the whole tree is gone at the first signal, and on any host where the process
 * table cannot be read. Both cases leave the caller watching the root pid
 * alone, which is the behaviour it had before.
 *
 * Said plainly, because the rest of this file reads as though identity is
 * always checked: no start time comes back in either of those cases, so there
 * is NO identity token and the caller signals the pid it was given. win32 is
 * therefore unchecked, and it is also where pids are reused soonest. What the
 * caller is given is `transport.pid`, and the SDK clears that only on the
 * child's `close` event, which waits for its stdio pipes rather than its exit
 * — so a surviving grandchild holding those pipes keeps a reaped pid readable.
 * Closing that needs the start time recorded when the child is spawned, which
 * is above this function: it can only check the pid it is handed.
 */
export function captureProcessTreeSync(pid: number): ProcessTreeSnapshot {
  if (process.platform === 'win32' || !isSignallablePid(pid)) {
    return { descendants: [] };
  }
  // No ps, no /proc, no permission, or it timed out: nothing to add, and the
  // caller keeps the root-pid-only behaviour it had before.
  const rows = readProcessListing();
  if (rows === null) {
    return { descendants: [] };
  }

  const childrenByParent = new Map<number, ProcessListing[]>();
  let rootStartedAt: string | undefined;
  for (const row of rows) {
    if (row.pid === pid) {
      rootStartedAt = row.startedAt;
    }
    const siblings = childrenByParent.get(row.ppid);
    if (siblings) {
      siblings.push(row);
    } else {
      childrenByParent.set(row.ppid, [row]);
    }
  }

  const descendants: ProcessSnapshotEntry[] = [];
  const seen = new Set<number>([pid]);
  const queue = [pid];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const child of childrenByParent.get(current) ?? []) {
      // A cycle cannot happen in a process table, but a self-parented row in a
      // malformed listing must not spin here, and neither the hub itself nor
      // init may ever enter the set that gets signalled by pid.
      if (seen.has(child.pid) || !isSignallablePid(child.pid) || child.pid === process.pid) {
        continue;
      }
      seen.add(child.pid);
      descendants.push({ pid: child.pid, startedAt: child.startedAt });
      queue.push(child.pid);
    }
  }
  // The table was readable to get here, so a missing root start time means the
  // root row itself was absent or hidden, not that the lookup failed.
  return { rootStartedAt, rootUnknown: rootStartedAt === undefined, descendants };
}

/**
 * Current start time of each given pid, for the pids that still exist, or
 * `null` when the process table could not be consulted at all.
 *
 * The distinction is the point. A caller compares these against start times it
 * captured earlier and signals only what still matches, so "cannot tell" has
 * to be a reason not to signal. An empty map would read as "none of these
 * match", which is the same shape as "every one of them is a stranger" and the
 * opposite of safe.
 *
 * A pid is left out of the map only when the kernel says it is gone. One that
 * cannot be described for any other reason is present with the value
 * `UNKNOWN_START_TIME`, which equals no real start time and so can never be
 * mistaken for a match: silence about such a pid would be indistinguishable
 * from that pid being a stranger, and the caller would stop watching a process
 * that is still running. The answer is `null` only when the table could not be
 * consulted at all. Per pid rather than per batch, because one unreadable pid
 * must not strand the others: they would otherwise go unsignalled too, which is
 * how a stubborn orphan survives alongside an unrelated unreadable process.
 *
 * Reading this is a check, not a lock. A pid can be recycled between the read
 * and the signal that follows it; closing that window needs
 * `pidfd_send_signal`, which Node does not expose. What the check does buy is
 * the size of the window: microseconds instead of the whole grace period.
 */
export function readProcessStartTimesSync(pids: number[]): Map<number, string> | null {
  if (process.platform === 'win32') {
    return null;
  }
  const wanted = pids.filter((pid) => isSignallablePid(pid));
  const result = new Map<number, string>();
  if (wanted.length === 0) {
    return result;
  }
  if (process.platform === 'linux') {
    for (const pid of wanted) {
      const row = readProcStatOrUnknown(pid);
      if (row === 'unknown') {
        result.set(pid, UNKNOWN_START_TIME);
        continue;
      }
      if (row) {
        result.set(pid, row.startedAt);
      }
    }
    return result;
  }
  try {
    for (const row of runPs(['-o', 'pid=,ppid=,lstart=', '-p', wanted.join(',')])) {
      result.set(row.pid, row.startedAt);
    }
  } catch {
    // ps could not answer. Reported as null rather than an empty map, so the
    // caller does not read it as "all of these are strangers".
    return null;
  }
  return result;
}

export function resetProcessListingCacheForTest(): void {
  cachedPsFailure = null;
}
