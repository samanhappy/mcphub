import type {
  FileStagingSettings,
  ServerConfig,
  ServerStagingConfig,
  StagingAdapterId,
  ToolFileStagingConfig,
} from '../types/index.js';
import { ServerConfigValidationError } from './serverConfigValidation.js';

/**
 * File staging (#1056) configuration helpers.
 *
 * PR1 keeps the feature off by default. Validation here is structural: whether
 * a declared parameter actually exists in a tool's input schema needs the live
 * tool definition and is checked at runtime (and, for the dashboard, in PR2).
 */

export const DEFAULT_FILE_STAGING_SETTINGS: FileStagingSettings = {
  enabled: false,
  maxFileBytes: 100 * 1024 * 1024,
  inlineMaxBytes: 1024 * 1024,
  perUserQuotaBytes: 1024 * 1024 * 1024,
  globalQuotaBytes: 10 * 1024 * 1024 * 1024,
  ttlHours: 24,
  downloadTtlSeconds: 300,
  maxFilesPerUser: 100,
  cleanupIntervalMinutes: 15,
};

export const STAGING_ADAPTERS: readonly StagingAdapterId[] = ['ssh'];

const OVERRIDEABLE_NUMERIC_KEYS = [
  'maxFileBytes',
  'inlineMaxBytes',
  'perUserQuotaBytes',
  'globalQuotaBytes',
  'ttlHours',
  'downloadTtlSeconds',
  'maxFilesPerUser',
  'cleanupIntervalMinutes',
] as const;

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
};

/**
 * Merge stored settings over the defaults. Unknown/out-of-range values are
 * clamped rather than rejected so a hand-edited settings file cannot brick the
 * hub; the API layer validates writes before they reach storage.
 */
export const resolveFileStagingSettings = (
  stored?: Partial<FileStagingSettings> | null,
): FileStagingSettings => {
  const settings: FileStagingSettings = {
    ...DEFAULT_FILE_STAGING_SETTINGS,
    enabled: stored?.enabled === true,
  };
  for (const key of OVERRIDEABLE_NUMERIC_KEYS) {
    settings[key] = clampInt(stored?.[key], DEFAULT_FILE_STAGING_SETTINGS[key], 1, Number.MAX_SAFE_INTEGER);
  }
  // Inline uploads can never exceed a tool-written file; keep the ceiling
  // consistent even if the two settings are edited independently.
  settings.inlineMaxBytes = Math.min(settings.inlineMaxBytes, settings.maxFileBytes);
  settings.downloadTtlSeconds = clampInt(settings.downloadTtlSeconds, 300, 10, 3600);
  settings.ttlHours = clampInt(settings.ttlHours, 24, 1, 24 * 365);
  settings.cleanupIntervalMinutes = clampInt(settings.cleanupIntervalMinutes, 15, 1, 24 * 60);
  return settings;
};

/**
 * Validate a settings PATCH and return only the keys the caller supplied, so a
 * partial update merges over the stored settings instead of resetting the rest
 * to defaults. Range checks happen in `resolveFileStagingSettings`.
 */
export const normalizeFileStagingSettings = (
  input: unknown,
): Partial<FileStagingSettings> | undefined => {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ServerConfigValidationError('fileStaging settings must be an object');
  }
  const raw = input as Record<string, unknown>;
  const update: Partial<FileStagingSettings> = {};
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') {
      throw new ServerConfigValidationError('fileStaging.enabled must be a boolean');
    }
    update.enabled = raw.enabled;
  }
  for (const key of OVERRIDEABLE_NUMERIC_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new ServerConfigValidationError(`fileStaging.${key} must be a positive number`);
    }
    update[key] = Math.floor(value);
  }
  const known = new Set<string>(['enabled', ...OVERRIDEABLE_NUMERIC_KEYS]);
  const unknown = Object.keys(raw).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new ServerConfigValidationError(
      `Unknown fileStaging setting(s): ${unknown.join(', ')}`,
    );
  }
  return Object.keys(update).length > 0 ? update : undefined;
};

const normalizeParamList = (value: unknown, field: string, toolKey: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ServerConfigValidationError(`tools.${toolKey}.fileStaging.${field} must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new ServerConfigValidationError(`tools.${toolKey}.fileStaging.${field} entries must be non-empty strings`);
    }
    const name = entry.trim();
    if (seen.has(name)) {
      throw new ServerConfigValidationError(`tools.${toolKey}.fileStaging.${field} contains duplicate "${name}"`);
    }
    seen.add(name);
  }
  return [...seen];
};

/**
 * Validate and normalize one tool's staging config. Returns undefined when the
 * field is absent so persistence keeps the shape otherwise unchanged.
 */
export const normalizeToolFileStaging = (
  input: unknown,
  toolKey: string,
): ToolFileStagingConfig | undefined => {
  if (input === undefined || input === null) return undefined;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ServerConfigValidationError(`tools.${toolKey}.fileStaging must be an object`);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.enabled !== 'boolean') {
    throw new ServerConfigValidationError(`tools.${toolKey}.fileStaging.enabled must be a boolean`);
  }
  const inputParams = normalizeParamList(raw.inputParams, 'inputParams', toolKey);
  const outputParams = normalizeParamList(raw.outputParams, 'outputParams', toolKey);
  if (inputParams && outputParams) {
    const overlap = inputParams.filter((name) => outputParams.includes(name));
    if (overlap.length > 0) {
      throw new ServerConfigValidationError(
        `tools.${toolKey}.fileStaging inputParams and outputParams overlap: ${overlap.join(', ')}`,
      );
    }
  }
  if (raw.enabled === true && !inputParams?.length && !outputParams?.length) {
    throw new ServerConfigValidationError(
      `tools.${toolKey}.fileStaging requires inputParams or outputParams when enabled`,
    );
  }
  if (raw.enabled === false) {
    return { enabled: false };
  }
  return {
    enabled: true,
    ...(inputParams ? { inputParams } : {}),
    ...(outputParams ? { outputParams } : {}),
  };
};

/** Validate and normalize a server's staging trust declaration. */
export const normalizeServerStaging = (input: unknown): ServerStagingConfig | undefined => {
  // TypeORM's simple-json columns read back SQL NULL as null; treat it exactly
  // like an absent key so DB round-trips do not fail validation.
  if (input === undefined || input === null) return undefined;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ServerConfigValidationError('staging must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (raw.shared !== undefined && typeof raw.shared !== 'boolean') {
    throw new ServerConfigValidationError('staging.shared must be a boolean');
  }
  if (raw.adapter !== undefined) {
    if (typeof raw.adapter !== 'string' || !STAGING_ADAPTERS.includes(raw.adapter as StagingAdapterId)) {
      throw new ServerConfigValidationError(
        `staging.adapter must be one of: ${STAGING_ADAPTERS.join(', ')}`,
      );
    }
  }
  const shared = raw.shared === true;
  const adapter =
    typeof raw.adapter === 'string' ? (raw.adapter as StagingAdapterId) : undefined;
  if (shared && !adapter) {
    throw new ServerConfigValidationError('staging.shared requires staging.adapter');
  }
  if (!shared && !adapter) return undefined;
  return { ...(shared ? { shared: true } : {}), ...(adapter ? { adapter } : {}) };
};

/**
 * Server-level consistency: any tool with `fileStaging.enabled` needs the
 * server to declare an adapter, otherwise the tool can never run (there is no
 * hub-cwd fallback in PR1). Run after tools and staging are normalized.
 */
export const assertStagingConfigConsistent = (config: ServerConfig): void => {
  const enabledTools = Object.entries(config.tools ?? {}).filter(
    ([, tool]) => tool?.fileStaging?.enabled === true,
  );
  if (enabledTools.length === 0) return;
  if (config.url || config.type === 'sse' || config.type === 'streamable-http' || config.type === 'openapi') {
    throw new ServerConfigValidationError('File staging is only available for stdio servers');
  }
  if (!config.staging?.adapter) {
    throw new ServerConfigValidationError(
      `File staging requires staging.adapter on this server (staged tools: ${enabledTools
        .map(([name]) => name)
        .join(', ')})`,
    );
  }
};
