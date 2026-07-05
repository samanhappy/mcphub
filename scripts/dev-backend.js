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

function resolveDevEnvironment(env = process.env) {
  const settingsPath = env.MCPHUB_SETTING_PATH
    ? resolvePathFromProjectRoot(env.MCPHUB_SETTING_PATH)
    : DEFAULT_DEV_SETTINGS_PATH;

  return {
    ...env,
    NODE_ENV: env.NODE_ENV || 'development',
    MCPHUB_SETTING_PATH: settingsPath,
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

function printEnvironment(env) {
  console.log(
    JSON.stringify({
      NODE_ENV: env.NODE_ENV,
      ADMIN_PASSWORD: env.ADMIN_PASSWORD,
      MCPHUB_SETTING_PATH: env.MCPHUB_SETTING_PATH,
    }),
  );
}

function printPrepareResult(env, created) {
  console.log(
    JSON.stringify({
      created,
      MCPHUB_SETTING_PATH: env.MCPHUB_SETTING_PATH,
    }),
  );
}

function startBackend(extraArgs) {
  const env = resolveDevEnvironment();
  prepareDevSettingsFile(env.MCPHUB_SETTING_PATH);

  console.log(`[dev] NODE_ENV=${env.NODE_ENV}`);
  console.log(`[dev] Using settings file: ${path.relative(projectRoot, env.MCPHUB_SETTING_PATH)}`);

  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const child = spawn(pnpm, ['exec', 'tsx', 'watch', 'src/index.ts', ...extraArgs], {
    cwd: projectRoot,
    env,
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
const env = resolveDevEnvironment();

if (printEnv) {
  printEnvironment(env);
} else if (prepareOnly) {
  const created = prepareDevSettingsFile(env.MCPHUB_SETTING_PATH);
  printPrepareResult(env, created);
} else {
  startBackend(backendArgs);
}
