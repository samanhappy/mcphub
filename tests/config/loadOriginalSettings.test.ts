import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Regression tests for #1081: `loadOriginalSettings()` (and the cached system
 * config it feeds) must re-read `mcp_settings.json` when the file is edited
 * externally, mirroring the mtime check `JsonFileBaseDao` already applies to
 * server definitions. System settings should not behave differently from
 * server definitions.
 */

const writeSettings = (settingsPath: string, settings: unknown): void => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
};

// Push the file mtime into the future so the test never depends on
// filesystem mtime granularity.
const bumpMtime = (filePath: string): void => {
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(filePath, future, future);
};

type ConfigModule = typeof import('../../src/config/index.js');

describe('settings file cache staleness (#1081)', () => {
  let tmpDir: string;
  let settingsPath: string;
  let originalSettingsEnv: string | undefined;
  let originalUseDb: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-config-'));
    settingsPath = path.join(tmpDir, 'mcp_settings.json');

    originalSettingsEnv = process.env.MCPHUB_SETTING_PATH;
    originalUseDb = process.env.USE_DB;
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    // Force file mode regardless of DB_URL (tests/setup.ts sets it).
    process.env.USE_DB = 'false';
  });

  afterEach(() => {
    if (originalSettingsEnv === undefined) {
      delete process.env.MCPHUB_SETTING_PATH;
    } else {
      process.env.MCPHUB_SETTING_PATH = originalSettingsEnv;
    }
    if (originalUseDb === undefined) {
      delete process.env.USE_DB;
    } else {
      process.env.USE_DB = originalUseDb;
    }

    jest.resetModules();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  const loadConfigModule = async (): Promise<ConfigModule> => {
    jest.resetModules();
    return import('../../src/config/index.js');
  };

  it('re-reads mcp_settings.json when the file is externally modified', async () => {
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: { nameSeparator: 'a' },
    });
    const config = await loadConfigModule();

    expect(config.loadOriginalSettings().systemConfig?.nameSeparator).toBe('a');

    // Simulate a hand edit to the settings file.
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: { nameSeparator: 'b' },
    });
    bumpMtime(settingsPath);

    expect(config.loadOriginalSettings().systemConfig?.nameSeparator).toBe('b');
  });

  it('serves the cached snapshot while the file is unchanged', async () => {
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: { nameSeparator: 'a' },
    });
    const config = await loadConfigModule();

    const readSpy = jest.spyOn(fs, 'readFileSync');
    expect(config.loadOriginalSettings().systemConfig?.nameSeparator).toBe('a');
    expect(config.loadOriginalSettings().systemConfig?.nameSeparator).toBe('a');
    // The file is read exactly once; the second call hits the cache and must
    // not trigger a re-read (the mtime check must preserve the cache).
    expect(readSpy).toHaveBeenCalledTimes(1);
    readSpy.mockRestore();
  });

  it('getNameSeparator() reflects an external edit after the cache is populated', async () => {
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: { nameSeparator: 'a' },
    });
    const config = await loadConfigModule();
    // Populate the cached system config the way startup hydration does.
    const systemConfigCache = await import('../../src/utils/systemConfigCache.js');
    await systemConfigCache.hydrateSystemConfigCache();

    expect(config.getNameSeparator()).toBe('a');

    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: { nameSeparator: 'b' },
    });
    bumpMtime(settingsPath);

    // getNameSeparator() must pick up the edited separator without a restart.
    expect(config.getNameSeparator()).toBe('b');
  });

  it('honors a programmatic system config set until the file is externally edited', async () => {
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: { nameSeparator: 'a' },
    });
    const config = await loadConfigModule();
    const systemConfigCache = await import('../../src/utils/systemConfigCache.js');

    // Simulate a dashboard system-config update: set programmatically.
    systemConfigCache.setCachedSystemConfig({ nameSeparator: 'c' });

    expect(config.getNameSeparator()).toBe('c');

    // An external edit still wins once the file changes.
    writeSettings(settingsPath, {
      mcpServers: {},
      users: [],
      systemConfig: { nameSeparator: 'b' },
    });
    bumpMtime(settingsPath);

    expect(config.getNameSeparator()).toBe('b');
  });
});
