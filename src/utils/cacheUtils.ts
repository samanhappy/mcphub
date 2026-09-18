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
export const packageNameFromSpec = (spec: string): string => {
  const separator = spec.lastIndexOf('@');
  return separator > 0 ? spec.slice(0, separator) : spec;
};

/**
 * Strip the constraint/extras/marker from a PEP 508 uvx package spec:
 * `cowsay==1.2` -> `cowsay`, `cowsay>=1.0` -> `cowsay`, `pkg[extra]` -> `pkg`,
 * `pkg; python_version < "3.12"` -> `pkg`, `pkg @ https://...` -> `pkg`.
 * uvx specs are PEP 508, so the npm-style `@version` strip above does not apply.
 */
export const uvxPackageNameFromSpec = (spec: string): string => {
  let name = spec.trim();
  const extras = name.indexOf('[');
  if (extras > 0) name = name.slice(0, extras);
  const marker = name.indexOf(';');
  if (marker > 0) name = name.slice(0, marker);
  const directReference = name.indexOf(' @ ');
  if (directReference > 0) name = name.slice(0, directReference);
  const constraint = name.search(/[<>=~!]/);
  if (constraint > 0) name = name.slice(0, constraint);
  return name.trim();
};

/**
 * Lenient whitelist for package names handed to `npm view` / `uv pip compile`:
 * anything else (a leading `-`, spaces, `=` constraints that failed to strip)
 * is skipped instead of being interpolated into a subprocess argument or a
 * filesystem path. Scoped npm names keep their `/`.
 */
export const isValidPackageName = (name: string): boolean =>
  /^[@a-zA-Z0-9][a-zA-Z0-9@_.\-/]*$/.test(name);

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
 * Get the uv tool install directory (the environments `uv tool install` creates).
 * Platform-aware: honors UV_TOOL_DIR, then XDG_DATA_HOME/uv/tools on posix and
 * %APPDATA%/uv/tools on Windows, matching uv's own defaults.
 */
export const getUvToolDir = (): string => {
  if (process.env.UV_TOOL_DIR) return process.env.UV_TOOL_DIR;
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'uv',
      'tools',
    );
  }
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, 'uv', 'tools');
  return path.join(os.homedir(), '.local', 'share', 'uv', 'tools');
};

/**
 * Get the uv cache directory (where uvx keeps its ephemeral environments).
 * Platform-aware: honors UV_CACHE_DIR, then XDG_CACHE_HOME/uv on posix and
 * %LOCALAPPDATA%/uv/cache on Windows, matching uv's own defaults.
 */
export const getUvCacheDir = (): string => {
  if (process.env.UV_CACHE_DIR) return process.env.UV_CACHE_DIR;
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'uv',
      'cache',
    );
  }
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'uv');
  return path.join(os.homedir(), '.cache', 'uv');
};

/**
 * Derive the package spec a `uvx` invocation runs, from a server's args.
 *
 * Mirrors uvx's argument shape: a --from PACKAGE option names the package
 * explicitly (and may repeat), otherwise the first bare token is the
 * command/package. Options that take a value are skipped together with their
 * value so their arguments are not mistaken for the package (-p 3.12 is a
 * python version, not a package). Everything after the package is the server's
 * own args.
 */
export const resolveUvxPackageSpec = (args: string[]): string | undefined => {
  // Every uvx option that takes a value (from `uvx --help`), long and short
  // forms, so their values are skipped instead of being mistaken for the
  // package. `--from` is handled separately since it names the package.
  const valueOptions = new Set([
    '--from',
    '--with',
    '-w',
    '--with-editable',
    '--with-requirements',
    '-c',
    '--constraints',
    '-b',
    '--build-constraints',
    '--overrides',
    '--env-file',
    '--python-platform',
    '--torch-backend',
    '-p',
    '--python',
    '--index',
    '--default-index',
    '-i',
    '--index-url',
    '--extra-index-url',
    '-f',
    '--find-links',
    '--index-strategy',
    '--keyring-provider',
    '-P',
    '--upgrade-package',
    '--upgrade-group',
    '--resolution',
    '--prerelease',
    '--prerelease-package',
    '--fork-strategy',
  ]);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--from') {
      const value = args[i + 1];
      if (value !== undefined) return value;
      continue;
    }

    if (arg.startsWith('--from=')) {
      return arg.slice('--from='.length);
    }

    if (valueOptions.has(arg)) {
      i += 1; // skip the option's value
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    // The first bare token is the package; the rest are the server's own args.
    return arg;
  }

  return undefined;
};

/**
 * PEP 503 name normalization, matching how pip/uv spell dist-info directories:
 * `mcp-server-fetch` and `mcp_server.fetch` both become `mcp_server_fetch`.
 */
export const normalizePackageName = (name: string): string =>
  name.toLowerCase().replace(/[-_.]+/g, '_');

/**
 * Read the installed version of `packageName` from a python environment root
 * (a uv tool install env or a uvx cache environment). The version lives in
 * the NAME-VERSION.dist-info directory inside site-packages under lib, the
 * same layout pip/uv write everywhere.
 */
const scanDistInfoVersion = async (
  envRoot: string,
  packageName: string,
): Promise<string | undefined> => {
  const normalized = normalizePackageName(packageName);
  let libs: string[];
  try {
    libs = await fs.promises.readdir(path.join(envRoot, 'lib'));
  } catch {
    return undefined;
  }

  for (const lib of libs) {
    let files: string[];
    try {
      files = await fs.promises.readdir(path.join(envRoot, 'lib', lib, 'site-packages'));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.dist-info')) continue;
      const base = file.slice(0, -'.dist-info'.length);
      const separator = base.lastIndexOf('-');
      if (separator <= 0) continue;
      if (normalizePackageName(base.slice(0, separator)) !== normalized) continue;
      const version = base.slice(separator + 1);
      if (version) return version;
    }
  }

  return undefined;
};

/**
 * List the ephemeral uvx environments uv keeps in its cache. Modern uv stores
 * them under environments-v2/PYHASH/ENVHASH (each a symlink into the archive);
 * older layouts kept the env directly under the cache root. Only the cache
 * layout matters, never npm's — returns [] when nothing is found.
 */
const listUvCacheEnvironments = async (cacheDir: string): Promise<string[]> => {
  const envsRoot = path.join(cacheDir, 'environments-v2');
  try {
    const pyHashes = await fs.promises.readdir(envsRoot);
    const envs: string[] = [];
    for (const pyHash of pyHashes) {
      let entries: string[];
      try {
        entries = await fs.promises.readdir(path.join(envsRoot, pyHash));
      } catch {
        continue;
      }
      for (const entry of entries) {
        envs.push(path.join(envsRoot, pyHash, entry));
      }
    }
    return envs;
  } catch {
    // Fallback for older uv layouts without environments-v2.
    try {
      const entries = await fs.promises.readdir(cacheDir);
      const envs: string[] = [];
      for (const entry of entries) {
        const candidate = path.join(cacheDir, entry);
        try {
          await fs.promises.access(path.join(candidate, 'pyvenv.cfg'));
          envs.push(candidate);
        } catch {
          // Not an environment root (wheels, archives, index caches, ...).
        }
      }
      return envs;
    } catch {
      return [];
    }
  }
};

/**
 * Resolve the package version currently installed for a uvx server.
 *
 * Two homes for a uvx environment are checked, newest-first: uv tool install
 * environments (UV_TOOL_DIR) and the ephemeral environments uvx itself creates
 * in the uv cache. The most recently touched environment that holds the package
 * is the one a fresh uvx spawn would use.
 */
export const resolveUvxPackageVersion = async (args: string[]): Promise<string | undefined> => {
  const spec = resolveUvxPackageSpec(args);
  if (!spec) return undefined;
  const packageName = uvxPackageNameFromSpec(spec);
  if (!packageName || !isValidPackageName(packageName)) return undefined;

  const toolDir = getUvToolDir();
  const cacheDir = getUvCacheDir();

  const candidates: string[] = [];
  try {
    candidates.push(
      ...(await fs.promises.readdir(toolDir)).map((entry) => path.join(toolDir, entry)),
    );
  } catch {
    // No tool installs yet.
  }
  candidates.push(...(await listUvCacheEnvironments(cacheDir)));

  const withMtime = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return { path: candidate, mtime: (await fs.promises.stat(candidate)).mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );
  const ordered = withMtime
    .filter((candidate): candidate is { path: string; mtime: number } => candidate !== undefined)
    .sort((a, b) => b.mtime - a.mtime);

  for (const candidate of ordered) {
    const version = await scanDistInfoVersion(candidate.path, packageName);
    if (version) return version;
  }

  return undefined;
};

/**
 * Read the installed version of `packageName` from an _npx cache entry.
 * Each entry is a private npm install: node_modules/PKG/package.json
 * carries the exact resolved version.
 */
const readInstalledPackageVersion = async (
  entryDir: string,
  packageName: string,
): Promise<string | undefined> => {
  try {
    const pkg = JSON.parse(
      await fs.promises.readFile(
        path.join(entryDir, 'node_modules', packageName, 'package.json'),
        'utf8',
      ),
    );
    if (typeof pkg?.version === 'string' && pkg.version) return pkg.version;
  } catch {
    // The package is not installed in this entry, or the manifest is unreadable.
  }
  return undefined;
};

/**
 * Resolve the package version currently installed for an npx server.
 *
 * Reuses the same _npx entry matching as the cache clear: npm 11 records the
 * invoked specs as _npx.packages, npm <= 10.9 only writes dependencies. When
 * several entries hold the same package, the most recently modified one is
 * what a fresh npx spawn would use.
 */
export const resolveNpxPackageVersion = async (args: string[]): Promise<string | undefined> => {
  const specs = resolveNpxPackageSpecs(args);
  if (specs.length === 0) return undefined;
  const primaryName = packageNameFromSpec(specs[0]);
  if (!primaryName || !isValidPackageName(primaryName)) return undefined;
  const cacheDir = getNpxCacheDir();

  let entries: string[];
  try {
    entries = await fs.promises.readdir(cacheDir);
  } catch {
    return undefined;
  }

  const withMtime = await Promise.all(
    entries.map(async (entry) => {
      try {
        return { entry, mtime: (await fs.promises.stat(path.join(cacheDir, entry))).mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );
  const ordered = withMtime
    .filter((candidate): candidate is { entry: string; mtime: number } => candidate !== undefined)
    .sort((a, b) => b.mtime - a.mtime);

  for (const { entry } of ordered) {
    const entryDir = path.join(cacheDir, entry);
    let manifest: { _npx?: { packages?: unknown }; dependencies?: unknown };
    try {
      manifest = JSON.parse(
        await fs.promises.readFile(path.join(entryDir, 'package.json'), 'utf8'),
      );
    } catch {
      continue;
    }
    if (!entryMatchesSpecs(manifest, specs)) continue;
    const version = await readInstalledPackageVersion(entryDir, primaryName);
    if (version) return version;
  }

  return undefined;
};

/**
 * Resolve the package version currently installed for a stdio server launched
 * through npx or uvx, so the dashboard can answer "what version is actually
 * running" (see #1166). Returns undefined for anything else — HTTP/SSE servers,
 * unsupported runners, or packages that have not been installed yet — without
 * throwing.
 */
export const resolveRunnerPackageVersion = async (
  command: string,
  args: string[] = [],
): Promise<string | undefined> => {
  if (command === 'npx') return resolveNpxPackageVersion(args);
  if (command === 'uvx') return resolveUvxPackageVersion(args);
  return undefined;
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
