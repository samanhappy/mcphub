import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_DEV_SETTINGS_PATH = path.join(projectRoot, 'data', 'mcp_settings.dev.json');

function resolvePathFromProjectRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function resolveDevConfiguration(env = process.env) {
  const settingsPath = env.MCPHUB_SETTING_PATH
    ? resolvePathFromProjectRoot(env.MCPHUB_SETTING_PATH)
    : DEFAULT_DEV_SETTINGS_PATH;

  return {
    childEnvironment: {
      ...env,
      NODE_ENV: env.NODE_ENV || 'development',
      MCPHUB_SETTING_PATH: settingsPath,
    },
    settingsPath,
  };
}

function prepareDevSettingsFile(settingsPath) {
  if (fs.existsSync(settingsPath)) {
    return false;
  }

  const sourcePath = path.join(projectRoot, 'mcp_settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.copyFileSync(sourcePath, settingsPath);
  return true;
}

function printEnvironment() {
  console.log(
    JSON.stringify({
      environment: 'sanitized',
    }),
  );
}

function printPrepareResult(created) {
  console.log(
    JSON.stringify({
      created,
    }),
  );
}

function startBackend(extraArgs) {
  const configuration = resolveDevConfiguration();
  prepareDevSettingsFile(configuration.settingsPath);

  console.log('[dev] Starting backend dev server');
  console.log('[dev] Using isolated development settings');

  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const child = spawn(pnpm, ['exec', 'tsx', 'watch', 'src/index.ts', ...extraArgs], {
    cwd: projectRoot,
    env: configuration.childEnvironment,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on('exit', (code, signal) => {
    if (signal) {
      const signalExitCodes = {
        SIGINT: 130,
        SIGTERM: 143,
      };
      process.exit(signalExitCodes[signal] ?? 1);
      return;
    }

    process.exit(code ?? 0);
  });
}

const args = process.argv.slice(2);
const printEnv = args.includes('--print-env');
const prepareOnly = args.includes('--prepare-only');
const backendArgs = args.filter((arg) => arg !== '--print-env' && arg !== '--prepare-only');
const configuration = resolveDevConfiguration();

if (printEnv) {
  printEnvironment();
} else if (prepareOnly) {
  const created = prepareDevSettingsFile(configuration.settingsPath);
  printPrepareResult(created);
} else {
  startBackend(backendArgs);
}
