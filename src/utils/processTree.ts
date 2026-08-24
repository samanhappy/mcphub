import fs from 'fs';
import path from 'path';

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
