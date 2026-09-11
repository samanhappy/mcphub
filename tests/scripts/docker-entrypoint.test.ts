import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const projectRoot = path.resolve(__dirname, '../..');

describe('Docker settings path selection', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-entrypoint-'));
    fs.writeFileSync(path.join(directory, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    // Exercise the real entrypoint with an isolated equivalent of the container's /app.
    const script = fs.readFileSync(path.join(projectRoot, 'entrypoint.sh'), 'utf8');
    fs.writeFileSync(
      path.join(directory, 'entrypoint.sh'),
      script.replaceAll('/app/', `${directory}/`),
    );
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  const run = (settingsPath?: string) => {
    const env: NodeJS.ProcessEnv = {
      HOME: directory,
      BASH_ENV: '/dev/null',
      PATH: directory,
    };
    if (settingsPath !== undefined) env.MCPHUB_SETTING_PATH = settingsPath;
    return execFileSync(
      '/bin/bash',
      [
        path.join(directory, 'entrypoint.sh'),
        '/bin/bash',
        '-c',
        'printf "selected=%s" "$MCPHUB_SETTING_PATH"',
      ],
      { env, encoding: 'utf8' },
    ).split('selected=')[1];
  };

  it('uses the data directory on a fresh installation', () => {
    expect(run()).toBe(path.join(directory, 'data/mcp_settings.json'));
  });

  it('retains the legacy file even when a data directory configuration also exists', () => {
    fs.writeFileSync(path.join(directory, 'mcp_settings.json'), '{"users":[]}');
    fs.mkdirSync(path.join(directory, 'data'));
    fs.writeFileSync(path.join(directory, 'data/mcp_settings.json'), '{}');
    expect(run()).toBe(path.join(directory, 'mcp_settings.json'));
    expect(fs.readFileSync(path.join(directory, 'mcp_settings.json'), 'utf8')).toBe('{"users":[]}');
  });

  it('honors an explicit path even with a legacy file present', () => {
    fs.writeFileSync(path.join(directory, 'mcp_settings.json'), '{}');
    const explicitPath = path.join(directory, 'data/mcp_settings.json');
    expect(run(explicitPath)).toBe(explicitPath);
  });
});
