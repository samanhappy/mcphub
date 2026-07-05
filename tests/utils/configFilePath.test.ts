import fs from 'fs';
import os from 'os';
import path from 'path';
import { getConfigFilePath } from '../../src/utils/path.js';

describe('getConfigFilePath MCPHUB_SETTING_PATH handling', () => {
  let originalSettingsPath: string | undefined;
  const tmpDirs: string[] = [];

  const createTempDir = (): string => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-settings-path-'));
    tmpDirs.push(tmpDir);
    return tmpDir;
  };

  beforeEach(() => {
    originalSettingsPath = process.env.MCPHUB_SETTING_PATH;
    delete process.env.MCPHUB_SETTING_PATH;
  });

  afterEach(() => {
    if (originalSettingsPath === undefined) {
      delete process.env.MCPHUB_SETTING_PATH;
    } else {
      process.env.MCPHUB_SETTING_PATH = originalSettingsPath;
    }

    for (const tmpDir of tmpDirs.splice(0)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats a custom JSON path as the settings file path', () => {
    const tmpDir = createTempDir();
    const settingsPath = path.join(tmpDir, 'mcp_settings.dev.json');
    process.env.MCPHUB_SETTING_PATH = settingsPath;

    expect(getConfigFilePath('mcp_settings.json')).toBe(settingsPath);
  });

  it('creates the parent directory for a missing custom settings file path', () => {
    const tmpDir = createTempDir();
    const settingsPath = path.join(tmpDir, 'nested', 'mcp_settings.dev.json');
    process.env.MCPHUB_SETTING_PATH = settingsPath;

    expect(getConfigFilePath('mcp_settings.json')).toBe(settingsPath);
    expect(fs.statSync(path.dirname(settingsPath)).isDirectory()).toBe(true);
  });

  it('keeps directory-style MCPHUB_SETTING_PATH values compatible', () => {
    const settingsDir = path.join(createTempDir(), 'settings-dir');
    process.env.MCPHUB_SETTING_PATH = settingsDir;

    expect(getConfigFilePath('mcp_settings.json')).toBe(
      path.join(settingsDir, 'mcp_settings.json'),
    );
    expect(fs.statSync(settingsDir).isDirectory()).toBe(true);
  });
});
