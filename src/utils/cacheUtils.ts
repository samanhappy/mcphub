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
 */
const commandExists = async (cmd: string): Promise<boolean> => {
  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(checkCmd, [cmd]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Clear all runner caches (npm + uv) using fixed commands.
 * Uses execFile with hardcoded arguments — no shell interpolation, no injection risk.
 * On Windows, shell: true is required because npm and uv are .cmd batch files.
 * Skips runners that are not installed on the system.
 */
export const clearAllCaches = async (): Promise<Record<string, CacheClearResult>> => {
  const results: Record<string, CacheClearResult> = {};
  // Windows npm/uv are .cmd wrappers and require shell: true to execute via execFile
  const execOptions = process.platform === 'win32' ? { shell: true } : {};

  // npm cache clean --force
  if (await commandExists('npm')) {
    try {
      await execFileAsync('npm', ['cache', 'clean', '--force'], execOptions);
      results.npm = { status: 'cleared' };
      console.log('Cleared npm cache');
    } catch (error) {
      results.npm = {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
      console.error('Failed to clear npm cache', error);
    }
  } else {
    results.npm = { status: 'skipped', message: 'npm not found' };
  }

  // uv cache clean
  if (await commandExists('uv')) {
    try {
      await execFileAsync('uv', ['cache', 'clean'], execOptions);
      results.uv = { status: 'cleared' };
      console.log('Cleared uv cache');
    } catch (error) {
      results.uv = {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
      console.error('Failed to clear uv cache', error);
    }
  } else {
    results.uv = { status: 'skipped', message: 'uv not found' };
  }

  return results;
};
