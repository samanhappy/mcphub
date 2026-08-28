import fs from 'fs';
import { SystemConfig, McpSettings } from '../types/index.js';
import { getConfigFilePath } from './path.js';

let cachedSystemConfig: SystemConfig | null = null;
// mtime of the settings file the cache was last read from. In file mode,
// `getCachedSystemConfig()` lazily re-reads `mcp_settings.json` when the file
// is newer, mirroring `JsonFileBaseDao`'s staleness check so system settings
// (e.g. `nameSeparator`) don't stay pinned to the startup value after an
// external edit (#1081).
let lastSeenSettingsFileMtime: number | null = null;

export const isDatabaseModeEnabled = (): boolean =>
  process.env.USE_DB !== undefined ? process.env.USE_DB === 'true' : Boolean(process.env.DB_URL);

export const getCachedSystemConfig = (): SystemConfig | null => {
  // In database mode the file is not authoritative; the cache is populated
  // from the database and must not be refreshed from the settings file.
  if (!isDatabaseModeEnabled()) {
    const settingsPath = getConfigFilePath('mcp_settings.json', 'Settings');
    try {
      const mtime = fs.statSync(settingsPath).mtime.getTime();
      if (lastSeenSettingsFileMtime === null || mtime > lastSeenSettingsFileMtime) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as McpSettings;
        cachedSystemConfig = settings.systemConfig ?? null;
        lastSeenSettingsFileMtime = mtime;
      }
    } catch {
      // Missing or unreadable file — keep serving the last known value.
    }
  }
  return cachedSystemConfig;
};

export const setCachedSystemConfig = (systemConfig: SystemConfig | null | undefined): void => {
  cachedSystemConfig = systemConfig ?? null;
  if (!isDatabaseModeEnabled()) {
    // A programmatic set (e.g. a dashboard system-config update that has
    // already been persisted to the file) is authoritative until the file is
    // externally edited, so record the current file mtime as the baseline.
    try {
      const settingsPath = getConfigFilePath('mcp_settings.json', 'Settings');
      lastSeenSettingsFileMtime = fs.statSync(settingsPath).mtime.getTime();
    } catch {
      lastSeenSettingsFileMtime = null;
    }
  }
};

export const hydrateSystemConfigCache = async (): Promise<SystemConfig> => {
  const { getSystemConfigDao } = await import('../dao/DaoFactory.js');
  const systemConfig = (await getSystemConfigDao().get()) || {};
  setCachedSystemConfig(systemConfig);
  return systemConfig;
};
