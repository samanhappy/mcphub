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
} from './cacheUtils.js';

const execFileAsync = promisify(execFile);

export interface PackageUpdateOptions {
  /** npm registry mirror (systemConfig.install.npmRegistry), injected like the server env. */
  npmRegistry?: string;
  /** python index mirror (systemConfig.install.pythonIndexUrl), injected like the server env. */
  pythonIndexUrl?: string;
  /** How long a resolved "latest" is trusted before re-querying the registry (ms). */
  cacheTtlMs?: number;
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

/** Subprocess timeout: registry queries run out of band, so give them room. */
const QUERY_TIMEOUT_MS = 30_000;

interface LatestCacheEntry {
  version: string;
  checkedAt: number;
}

const latestCache = new Map<string, LatestCacheEntry>();
const inFlight = new Map<string, Promise<string | undefined>>();

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
 * package name must match exactly.
 */
export const parseUvCompileVersion = (stdout: string, packageName: string): string | undefined => {
  for (const raw of stdout.split('\n')) {
    const line = raw.trim().split(' ')[0];
    if (!line.includes('==')) continue;
    const separator = line.indexOf('==');
    if (line.slice(0, separator) !== packageName) continue;
    const version = line.slice(separator + 2);
    if (version) return version;
  }
  return undefined;
};

/**
 * Compare two versions numerically, segment by segment, ignoring a leading `v`.
 * Falls back to plain string order when a segment is not numeric (pre-release
 * or build metadata), which is only an approximation — good enough for a UI
 * "update available" hint.
 */
export const isNewerVersion = (latest: string, installed: string): boolean => {
  const stripV = (version: string): string =>
    version.startsWith('v') ? version.slice(1) : version;
  const latestParts = stripV(latest).split('.');
  const installedParts = stripV(installed).split('.');
  const length = Math.max(latestParts.length, installedParts.length);

  for (let i = 0; i < length; i += 1) {
    const latestSegment = Number.parseInt(latestParts[i] ?? '0', 10);
    const installedSegment = Number.parseInt(installedParts[i] ?? '0', 10);
    if (Number.isNaN(latestSegment) || Number.isNaN(installedSegment)) {
      return stripV(latest) > stripV(installed);
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
    const { stdout } = await execFileAsync('npm', ['view', packageName, 'version'], {
      env,
      timeout: QUERY_TIMEOUT_MS,
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

/**
 * Query the newest version a registry offers for an npx/uvx package, with a TTL
 * cache (keyed by command + package + configured mirror) and in-flight
 * deduplication so a startup sweep of many servers only queries each package
 * once. Never throws: registry failures surface as undefined.
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
  const packageName = packageNameFromSpec(spec);
  if (!packageName) return undefined;

  const ttlMs = opts.cacheTtlMs ?? DEFAULT_UPDATE_TTL_MS;
  const key = cacheKey(command, packageName, opts);
  const query = opts.queryLatest ?? queryLatestPackageVersion;

  const cached = latestCache.get(key);
  if (cached && Date.now() - cached.checkedAt < ttlMs) {
    return {
      latestVersion: cached.version,
      updateAvailable: isNewerVersion(cached.version, installedVersion),
    };
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = query(command, packageName, opts)
      .then((version) => {
        if (version) {
          latestCache.set(key, { version, checkedAt: Date.now() });
          return version;
        }
        return undefined;
      })
      .finally(() => {
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

/** Drop all cached and in-flight lookups (used by tests and on config changes). */
export const clearPackageUpdateCache = (): void => {
  latestCache.clear();
  inFlight.clear();
};
