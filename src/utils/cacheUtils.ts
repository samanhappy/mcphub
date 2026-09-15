import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface CacheClearResult {
  status: 'cleared' | 'skipped' | 'error';
  message?: string;
}

/**
 * Get the npx package cache directory path.
 * Platform-aware: macOS/Linux use ~/.npm/_npx, Windows uses %APPDATA%/npm-cache/_npx.
 */
export const getNpxCacheDir = (): string => {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'npm-cache',
      '_npx',
    );
  }
  return path.join(os.homedir(), '.npm', '_npx');
};

/**
 * Check if a server command supports cache refresh (reinstall).
 * Currently supports: npx (directory-based clear) and uvx (flag-based refresh).
 */
export const supportsCacheRefresh = (command: string): boolean => {
  return command === 'npx' || command === 'uvx';
};

/**
 * Inject cache-busting flags into command arguments for flag-based refresh.
 * Currently only applies to uvx (--refresh flag).
 *
 * For npx, this is a no-op — use clearRunnerCache() instead,
 * since --ignore-existing was removed in npm 7+.
 */
export const injectRefreshFlag = (command: string, args: string[]): string[] => {
  if (command === 'uvx' && !args.includes('--refresh')) {
    return ['--refresh', ...args];
  }
  return args;
};

/**
 * Derive the package specs an `npx` invocation installs, from a server's args.
 *
 * Mirrors how npx itself reads its arguments: `-p`/`--package` names packages
 * explicitly and may repeat, `-c` hands the rest to a shell, and otherwise the
 * first non-flag token is the package. The result is matched against npm's own
 * `_npx.packages` metadata rather than used to recompute npm's cache hash, so
 * it keeps working across npm versions.
 */
export const resolveNpxPackageSpecs = (args: string[]): string[] => {
  const specs: string[] = [];
  let explicit = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '-p' || arg === '--package') {
      const value = args[i + 1];
      if (value !== undefined) {
        specs.push(value);
        explicit = true;
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('--package=')) {
      specs.push(arg.slice('--package='.length));
      explicit = true;
      continue;
    }

    // Everything after -c is the shell command, not a package spec.
    if (arg === '-c' || arg === '--call') {
      break;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    // The first bare token is the package; the rest are the server's own args.
    if (!explicit) {
      specs.push(arg);
    }
    break;
  }

  return specs;
};

/**
 * Strip the version from a package spec, keeping a scoped name intact:
 * `cowsay@1.5.0` -> `cowsay`, `@scope/pkg@1.2.3` -> `@scope/pkg`, `@scope/pkg`
 * unchanged (its only `@` is the scope marker at position 0).
 */
const packageNameFromSpec = (spec: string): string => {
  const separator = spec.lastIndexOf('@');
  return separator > 0 ? spec.slice(0, separator) : spec;
};

/**
 * Decide whether one `_npx` entry belongs to the packages being reinstalled.
 *
 * Two shapes have to be recognised, because the field to match on depends on
 * the npm version rather than on anything MCPHub controls:
 *
 * - npm 11 records the specs it was invoked with as `_npx.packages`, which
 *   distinguishes `cowsay` from `cowsay@1.6.0` exactly.
 * - npm 10.9 - what the image ships, through NodeSource Node 22 - writes no
 *   `_npx` block at all. Only `dependencies` is present, keyed by package name
 *   (scoped names included), so matching there is by name and takes every
 *   version of that package with it.
 *
 * Preferring `_npx.packages` per entry keeps the precise behaviour wherever npm
 * offers it, without making the coarser fallback the rule everywhere.
 */
const entryMatchesSpecs = (
  manifest: { _npx?: { packages?: unknown }; dependencies?: unknown },
  specs: string[],
): boolean => {
  const packages = manifest._npx?.packages;
  if (Array.isArray(packages)) {
    return packages.some((pkg) => specs.includes(pkg as string));
  }

  const dependencies = manifest.dependencies;
  if (dependencies && typeof dependencies === 'object') {
    const names = new Set(specs.map(packageNameFromSpec));
    return Object.keys(dependencies).some((name) => names.has(name));
  }

  return false;
};

/**
 * Remove the `_npx` entries that installed the given package specs.
 *
 * The target entry is identified from the metadata npm itself leaves in each
 * entry's package.json, rather than by recomputing npm's cache hash, which is a
 * private implementation detail. Entries whose metadata cannot be read are left
 * alone: this runs to refresh one server, and an unreadable neighbour is not
 * ours to delete.
 */
const removeNpxEntriesForSpecs = async (cacheDir: string, specs: string[]): Promise<number> => {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(cacheDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  let removed = 0;

  for (const entry of entries) {
    const entryDir = path.join(cacheDir, entry);
    let manifest: { _npx?: { packages?: unknown }; dependencies?: unknown };
    try {
      manifest = JSON.parse(await fs.promises.readFile(path.join(entryDir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }

    if (!entryMatchesSpecs(manifest, specs)) {
      continue;
    }

    await fs.promises.rm(entryDir, { recursive: true, force: true });
    removed += 1;
  }

  return removed;
};

/**
 * Clear the runner's package cache synchronously before reconnect.
 * - npx: deletes only the `_npx` entries belonging to this server's package.
 *   Deleting the whole `_npx` directory would discard every other npx server's
 *   install as well, which on a large fleet silently turns a warm cache cold
 *   and only shows up as a slow, timeout-prone restart much later.
 * - uvx: no-op (cache refresh is handled via --refresh flag injection).
 *
 * Safe to call even if the directory doesn't exist.
 */
export const clearRunnerCache = async (command: string, args: string[] = []): Promise<void> => {
  if (command === 'npx') {
    const cacheDir = getNpxCacheDir();
    const specs = resolveNpxPackageSpecs(args);

    if (specs.length === 0) {
      // Removing everything would be worse than removing nothing: the reconnect
      // still runs, it just reuses whatever is cached for this server.
      logger.warn(
        `Could not identify the npx package from the server arguments; left the cache at ${cacheDir} untouched`,
      );
      return;
    }

    try {
      const removed = await removeNpxEntriesForSpecs(cacheDir, specs);
      logger.log(
        `Cleared ${removed} npx cache entr${removed === 1 ? 'y' : 'ies'} for ${specs.join(', ')}`,
      );
    } catch (error) {
      logger.error(`Failed to clear npx cache entries under: ${cacheDir}`, error);
      throw error;
    }
  }
  // uvx: cache refresh is handled via --refresh flag injection in createTransportFromConfig
};

/**
 * Check if a command binary exists on the system.
 * Uses a 3s timeout to avoid hanging on slow PATH lookups.
 */
const commandExists = async (cmd: string): Promise<boolean> => {
  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(checkCmd, [cmd], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
};

// 60s timeout per cache clear command. npm cache clean can be slow on large caches.
const CACHE_CLEAR_TIMEOUT_MS = 60_000;

/**
 * Clear a single runner's cache. Returns the result without throwing.
 */
const clearRunnerCacheAsync = async (
  runner: string,
  cmd: string,
  args: string[],
  execOptions: Record<string, unknown>,
): Promise<CacheClearResult> => {
  if (!(await commandExists(cmd))) {
    return { status: 'skipped', message: `${cmd} not found` };
  }
  try {
    await execFileAsync(cmd, args, { ...execOptions, timeout: CACHE_CLEAR_TIMEOUT_MS });
    logger.log(`Cleared ${runner} cache`);
    return { status: 'cleared' };
  } catch (error) {
    logger.error(`Failed to clear ${runner} cache`, error);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Clear all runner caches (npm + uv) in parallel using fixed commands.
 * Uses execFile with hardcoded arguments — no shell interpolation, no injection risk.
 * On Windows, shell: true is required because npm and uv are .cmd batch files.
 * Each command has a 60s timeout. Skips runners that are not installed.
 */
export const clearAllCaches = async (): Promise<Record<string, CacheClearResult>> => {
  // Windows npm/uv are .cmd wrappers and require shell: true to execute via execFile
  const execOptions = process.platform === 'win32' ? { shell: true } : {};

  // Run npm and uv clears in parallel — they operate on independent caches
  const [npmResult, uvResult] = await Promise.all([
    clearRunnerCacheAsync('npm', 'npm', ['cache', 'clean', '--force'], execOptions),
    clearRunnerCacheAsync('uv', 'uv', ['cache', 'clean', '--force'], execOptions),
  ]);

  return { npm: npmResult, uv: uvResult };
};
