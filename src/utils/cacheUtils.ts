import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

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
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm-cache', '_npx');
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
 * Clear the runner's package cache synchronously before reconnect.
 * - npx: deletes ~/.npm/_npx (the only reliable method in npm 7+).
 * - uvx: no-op (cache refresh is handled via --refresh flag injection).
 *
 * Safe to call even if the directory doesn't exist.
 */
export const clearRunnerCache = async (command: string): Promise<void> => {
  if (command === 'npx') {
    const cacheDir = getNpxCacheDir();
    try {
      await fs.promises.rm(cacheDir, { recursive: true, force: true });
      console.log(`Cleared npx cache directory: ${cacheDir}`);
    } catch (error) {
      console.error(`Failed to clear npx cache directory: ${cacheDir}`, error);
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
    console.log(`Cleared ${runner} cache`);
    return { status: 'cleared' };
  } catch (error) {
    console.error(`Failed to clear ${runner} cache`, error);
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
