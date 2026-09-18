import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';
import {
  resolveNpxPackageSpecs,
  resolveUvxPackageSpec,
  packageNameFromSpec,
  uvxPackageNameFromSpec,
  isValidPackageName,
  normalizePackageName,
} from './cacheUtils.js';

const execFileAsync = promisify(execFile);

export interface PackageUpdateOptions {
  /** npm registry mirror (systemConfig.install.npmRegistry), injected like the server env. */
  npmRegistry?: string;
  /** python index mirror (systemConfig.install.pythonIndexUrl), injected like the server env. */
  pythonIndexUrl?: string;
  /** How long a resolved "latest" is trusted before re-querying the registry (ms). */
  cacheTtlMs?: number;
  /** How long a failed lookup is remembered before being retried (ms). */
  failureTtlMs?: number;
  /** Test seam: overrides the registry query. */
  queryLatest?: (
    command: string,
    packageName: string,
    opts: PackageUpdateOptions,
  ) => Promise<string | undefined>;
}

export interface PackageUpdateResult {
  latestVersion: string;
  updateAvailable: boolean;
}

/** Default freshness window for registry lookups (6h). */
export const DEFAULT_UPDATE_TTL_MS = 6 * 60 * 60 * 1000;

/** How long a failed lookup is remembered before being retried (15 min). */
export const DEFAULT_FAILURE_TTL_MS = 15 * 60 * 1000;

/** Maximum number of registry subprocesses running at once. */
export const QUERY_CONCURRENCY_LIMIT = 4;

/** Subprocess timeout: registry queries run out of band, so give them room. */
const QUERY_TIMEOUT_MS = 30_000;

interface LatestCacheEntry {
  /** Absent for negative-cached failures. */
  version?: string;
  checkedAt: number;
}

const latestCache = new Map<string, LatestCacheEntry>();
const inFlight = new Map<string, Promise<string | undefined>>();

/** Simple semaphore so a sweep of N packages never spawns N subprocesses. */
let activeQueries = 0;
const queryWaiters: Array<() => void> = [];

const acquireQuerySlot = (): Promise<() => void> => {
  const release = (): void => {
    activeQueries -= 1;
    const next = queryWaiters.shift();
    if (next) {
      activeQueries += 1;
      next();
    }
  };
  if (activeQueries < QUERY_CONCURRENCY_LIMIT) {
    activeQueries += 1;
    return Promise.resolve(release);
  }
  return new Promise((resolve) => {
    queryWaiters.push(() => resolve(release));
  });
};

const cacheKey = (command: string, packageName: string, opts: PackageUpdateOptions): string =>
  `${command}:${packageName}:${opts.npmRegistry ?? ''}:${opts.pythonIndexUrl ?? ''}`;

/**
 * Parse the output of `npm view <pkg> version`: a single version line.
 */
export const parseNpmViewVersion = (stdout: string): string | undefined => {
  const line = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line || undefined;
};

/**
 * Parse the output of `uv pip compile`: the `NAME==VERSION` line for the
 * requested package. Transitive dependencies also appear as `==` lines, so the
 * package name must match — with PEP 503 normalization on both sides, matching
 * how the dist-info scan spells names (`mcp-server-fetch` / `mcp_server.fetch`).
 */
export const parseUvCompileVersion = (stdout: string, packageName: string): string | undefined => {
  const normalizedPackage = normalizePackageName(packageName);
  for (const raw of stdout.split('\n')) {
    const line = raw.trim().split(' ')[0];
    if (!line.includes('==')) continue;
    const separator = line.indexOf('==');
    if (normalizePackageName(line.slice(0, separator)) !== normalizedPackage) continue;
    const version = line.slice(separator + 2);
    if (version) return version;
  }
  return undefined;
};

/**
 * Compare two versions for the "update available" hint.
 *
 * Only the numeric core is compared: pre-release (`1.0.0-rc.1`) and build
 * (`1.0.0+build`) suffixes are stripped, and a version whose core has a
 * non-numeric segment is treated as equal (conservative — never claim an
 * update when the comparison is ambiguous). A pre-release `latest` therefore
 * never outranks an installed stable with the same core.
 */
export const isNewerVersion = (latest: string, installed: string): boolean => {
  const stripV = (version: string): string =>
    version.startsWith('v') ? version.slice(1) : version;
  const core = (version: string): string => stripV(version).split(/[-+]/)[0];
  const latestCore = core(latest);
  const installedCore = core(installed);

  const latestParts = latestCore.split('.');
  const installedParts = installedCore.split('.');
  const length = Math.max(latestParts.length, installedParts.length);

  for (let i = 0; i < length; i += 1) {
    const latestSegment = Number.parseInt(latestParts[i] ?? '0', 10);
    const installedSegment = Number.parseInt(installedParts[i] ?? '0', 10);
    if (Number.isNaN(latestSegment) || Number.isNaN(installedSegment)) {
      return false; // not comparable — do not guess
    }
    if (latestSegment !== installedSegment) return latestSegment > installedSegment;
  }

  return false;
};

const queryLatestNpmVersion = async (
  packageName: string,
  registry?: string,
): Promise<string | undefined> => {
  try {
    const env = { ...process.env };
    if (registry) env.npm_config_registry = registry;
    // On Windows `npm` is the npm.cmd batch wrapper, which execFile cannot
    // launch without a shell (same handling as clearAllCaches). The package
    // name is validated upstream (isValidPackageName), so shell interpolation
    // is not a concern here.
    const execOptions = process.platform === 'win32' ? { shell: true } : {};
    const { stdout } = await execFileAsync('npm', ['view', packageName, 'version'], {
      env,
      timeout: QUERY_TIMEOUT_MS,
      ...execOptions,
    });
    return parseNpmViewVersion(stdout);
  } catch (error) {
    logger.warn(`Failed to query npm registry for ${packageName}`, { error });
    return undefined;
  }
};

const queryLatestUvVersion = async (
  packageName: string,
  indexUrl?: string,
): Promise<string | undefined> => {
  // uv pip compile has no stdin-friendly requirement argument, so resolve from
  // a throwaway requirements file. The bare name resolves to the newest version
  // the configured index offers, exactly like `uvx <name>` would install.
  let requirementsFile: string | undefined;
  try {
    requirementsFile = path.join(
      os.tmpdir(),
      `mcphub-uv-req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.promises.writeFile(requirementsFile, `${packageName}\n`, 'utf8');

    const env = { ...process.env };
    if (indexUrl) env.UV_DEFAULT_INDEX = indexUrl;
    const { stdout } = await execFileAsync(
      'uv',
      ['pip', 'compile', '--no-cache', requirementsFile],
      { env, timeout: QUERY_TIMEOUT_MS },
    );
    return parseUvCompileVersion(stdout, packageName);
  } catch (error) {
    logger.warn(`Failed to query uv index for ${packageName}`, { error });
    return undefined;
  } finally {
    if (requirementsFile) {
      await fs.promises.rm(requirementsFile, { force: true }).catch(() => undefined);
    }
  }
};

const queryLatestPackageVersion = async (
  command: string,
  packageName: string,
  opts: PackageUpdateOptions,
): Promise<string | undefined> => {
  if (command === 'npx') return queryLatestNpmVersion(packageName, opts.npmRegistry);
  if (command === 'uvx') return queryLatestUvVersion(packageName, opts.pythonIndexUrl);
  return undefined;
};

/** Maximum cache entries before stale/oldest entries are evicted. */
const MAX_CACHE_ENTRIES = 1024;

/** Evict stale entries; if still over the cap, drop the oldest one. */
const pruneCache = (now: number, ttlMs: number): void => {
  for (const [key, entry] of latestCache) {
    if (now - entry.checkedAt >= ttlMs) latestCache.delete(key);
  }
  if (latestCache.size <= MAX_CACHE_ENTRIES) return;
  let oldestKey: string | undefined;
  let oldestCheckedAt = Infinity;
  for (const [key, entry] of latestCache) {
    if (entry.checkedAt < oldestCheckedAt) {
      oldestCheckedAt = entry.checkedAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined) latestCache.delete(oldestKey);
};

/**
 * Query the newest version a registry offers for an npx/uvx package, with a TTL
 * cache (keyed by command + package + configured mirror), in-flight
 * deduplication and a concurrency gate, so a startup sweep of many servers only
 * queries each package once and never spawns a subprocess storm. Failures are
 * negative-cached for a short window. Never throws: registry failures surface
 * as undefined.
 */
export const checkPackageUpdate = async (
  command: string,
  args: string[],
  installedVersion: string,
  opts: PackageUpdateOptions = {},
): Promise<PackageUpdateResult | undefined> => {
  const spec =
    command === 'npx'
      ? resolveNpxPackageSpecs(args)[0]
      : command === 'uvx'
        ? resolveUvxPackageSpec(args)
        : undefined;
  if (!spec) return undefined;
  const packageName = command === 'uvx' ? uvxPackageNameFromSpec(spec) : packageNameFromSpec(spec);
  if (!packageName || !isValidPackageName(packageName)) return undefined;

  const ttlMs = opts.cacheTtlMs ?? DEFAULT_UPDATE_TTL_MS;
  const failureTtlMs = opts.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
  const key = cacheKey(command, packageName, opts);
  const query = opts.queryLatest ?? queryLatestPackageVersion;

  const now = Date.now();
  pruneCache(now, ttlMs);

  const cached = latestCache.get(key);
  if (cached) {
    const age = now - cached.checkedAt;
    const entryTtl = cached.version === undefined ? failureTtlMs : ttlMs;
    if (age < entryTtl) {
      if (cached.version === undefined) return undefined; // negative cache hit
      return {
        latestVersion: cached.version,
        updateAvailable: isNewerVersion(cached.version, installedVersion),
      };
    }
    latestCache.delete(key);
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const release = await acquireQuerySlot();
      try {
        const version = await query(command, packageName, opts);
        latestCache.set(key, { version, checkedAt: Date.now() });
        return version;
      } finally {
        release();
      }
    })().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }

  const latestVersion = await pending;
  if (!latestVersion) return undefined;
  return {
    latestVersion,
    updateAvailable: isNewerVersion(latestVersion, installedVersion),
  };
};

/** Drop all cached and in-flight lookups (test isolation; the cache is also self-pruning). */
export const clearPackageUpdateCache = (): void => {
  latestCache.clear();
  inFlight.clear();
};
