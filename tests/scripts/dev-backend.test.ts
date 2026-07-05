import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(projectRoot, 'scripts', 'dev-backend.js');

const runScript = (args: string[], env: NodeJS.ProcessEnv = {}) => {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: undefined,
      ADMIN_PASSWORD: undefined,
      MCPHUB_SETTING_PATH: undefined,
      ...env,
    },
    encoding: 'utf8',
  });
};

describe('dev backend launcher', () => {
  it('prints only sanitized environment metadata', () => {
    const resultText = runScript(['--print-env'], {
      ADMIN_PASSWORD: 'super-secret-password',
      MCPHUB_SETTING_PATH: 'data/custom-dev-settings.json',
    });
    const result = JSON.parse(resultText);

    expect(result).toEqual({ environment: 'sanitized' });
    expect(result).not.toHaveProperty('ADMIN_PASSWORD');
    expect(resultText).not.toContain('super-secret-password');
    expect(resultText).not.toContain('custom-dev-settings.json');
  });

  it('prepares a copied dev settings file without modifying the repository settings', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-dev-settings-'));
    const devSettingsPath = path.join(tmpDir, 'mcp_settings.dev.json');
    const shippedSettingsPath = path.join(projectRoot, 'mcp_settings.json');
    const shippedSettingsBefore = fs.readFileSync(shippedSettingsPath, 'utf8');

    try {
      const result = JSON.parse(
        runScript(['--prepare-only'], {
          MCPHUB_SETTING_PATH: devSettingsPath,
        }),
      );

      expect(result.created).toBe(true);
      expect(result).not.toHaveProperty('MCPHUB_SETTING_PATH');
      expect(fs.readFileSync(devSettingsPath, 'utf8')).toBe(shippedSettingsBefore);
      expect(fs.readFileSync(shippedSettingsPath, 'utf8')).toBe(shippedSettingsBefore);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps production start independent from dev defaults', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    );

    expect(packageJson.scripts['backend:dev']).toBe('node scripts/dev-backend.js');
    expect(packageJson.scripts.start).toBe('node dist/index.js');
  });
});
