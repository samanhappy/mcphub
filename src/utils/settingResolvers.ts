import { expandEnvVars } from '../config/index.js';

export const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    return undefined;
  }

  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  return undefined;
};

export const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = expandEnvVars(value).trim();
  return trimmedValue || undefined;
};

export const splitStringArray = (value: string): string[] => {
  const normalizedValue = expandEnvVars(value).trim();
  if (!normalizedValue) {
    return [];
  }

  if (normalizedValue.startsWith('[')) {
    try {
      const parsedValue = JSON.parse(normalizedValue);
      if (Array.isArray(parsedValue)) {
        return parsedValue
          .map((item) => normalizeOptionalString(item))
          .filter((item): item is string => Boolean(item));
      }
    } catch {
      // Fall back to delimiter-based parsing below.
    }
  }

  const delimiter = normalizedValue.includes(',') ? /,/ : /\s+/;
  return normalizedValue
    .split(delimiter)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const normalizeStringArray = (value: unknown, fallback: string[] = []): string[] => {
  const normalized = Array.isArray(value)
    ? value
        .map((item) => normalizeOptionalString(item))
        .filter((item): item is string => Boolean(item))
    : typeof value === 'string'
      ? splitStringArray(value)
      : [];

  return normalized.length > 0 ? normalized : fallback;
};

export const resolveBooleanSetting = (
  envValue: string | undefined,
  settingsValue: unknown,
  defaultValue: boolean,
): boolean => {
  const envOverride = parseBoolean(envValue);
  if (envOverride !== undefined) {
    return envOverride;
  }

  const settingsOverride = parseBoolean(settingsValue);
  if (settingsOverride !== undefined) {
    return settingsOverride;
  }

  return defaultValue;
};

export const resolveStringSetting = (
  envValue: string | undefined,
  settingsValue: unknown,
  defaultValue?: string,
): string | undefined => {
  const envOverride = normalizeOptionalString(envValue);
  if (envOverride !== undefined) {
    return envOverride;
  }

  const settingsOverride = normalizeOptionalString(settingsValue);
  if (settingsOverride !== undefined) {
    return settingsOverride;
  }

  return defaultValue;
};

export const resolveStringArraySetting = (
  envValue: string | undefined,
  settingsValue: unknown,
  defaultValue: string[] = [],
): string[] => {
  if (envValue !== undefined) {
    const envOverride = normalizeStringArray(envValue, []);
    if (envOverride.length > 0) {
      return envOverride;
    }
  }

  const settingsOverride = normalizeStringArray(settingsValue, []);
  if (settingsOverride.length > 0) {
    return settingsOverride;
  }

  return defaultValue;
};
