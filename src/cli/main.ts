import { CliApiError, CliUsageError } from './errors.js';
import { GlobalFlags } from './context.js';
import { parseGlobalFlags } from './parse-args.js';
import { printError, printLine, printWarn } from './output.js';
import { printHelp, printVersion } from './help.js';

export type CommandHandler = (args: string[], globals: GlobalFlags) => Promise<void>;

interface CommandModule {
  run?: CommandHandler;
  logout?: CommandHandler;
}

const SUBCOMMAND_LOADERS: Record<string, () => Promise<CommandModule>> = {
  login: () => import('./commands/login.js'),
  logout: () => import('./commands/login.js'),
  config: () => import('./commands/config.js'),
  servers: () => import('./commands/servers.js'),
  groups: () => import('./commands/groups.js'),
  keys: () => import('./commands/keys.js'),
  tools: () => import('./commands/tools.js'),
  call: () => import('./commands/call.js'),
  export: () => import('./commands/export.js'),
  discover: () => import('./commands/discover.js'),
  install: () => import('./commands/install.js'),
  cache: () => import('./commands/cache.js'),
};

export async function runCli(argv: string[]): Promise<void> {
  const { globalFlags, rest } = parseGlobalFlags(argv);
  const command = rest.shift();

  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      printHelp(rest[0]);
      return;
    }
    if (command === '--version' || command === '-v') {
      printVersion();
      return;
    }

    const loader = SUBCOMMAND_LOADERS[command];
    if (!loader) {
      throw new CliUsageError(`Unknown command: ${command}. Run \`mcphub --help\` for a list.`);
    }

    const mod = await loader();
    const handler = command === 'logout' ? mod.logout : mod.run;
    if (!handler) {
      throw new CliUsageError(`Command not implemented: ${command}`);
    }
    await handler(rest, globalFlags);
  } catch (err) {
    handleTopLevelError(err, globalFlags);
  }
}

function handleTopLevelError(err: unknown, globals: GlobalFlags): void {
  if (err instanceof CliUsageError) {
    printError(err.message);
    process.exitCode = 1;
    return;
  }
  if (err instanceof CliApiError) {
    printError(`API error (${err.status}): ${err.message}`);
    if (err.requiresLogin) {
      printWarn('Hint: run `mcphub login` to refresh your token.');
    }
    if (globals.debug && err.body !== undefined) {
      printLine(typeof err.body === 'string' ? err.body : JSON.stringify(err.body, null, 2));
    }
    process.exitCode = 2;
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  printError(`Unexpected error: ${message}`);
  if (globals.debug && err instanceof Error && err.stack) {
    printLine(err.stack);
  }
  process.exitCode = 1;
}

// Self-run when invoked directly (`tsx src/cli/main.ts ...` or
// `node dist/cli/main.js ...`). bin/cli.js also imports runCli explicitly, so
// the dispatcher works in both modes.
import { fileURLToPath as toPath } from 'node:url';
import process from 'node:process';

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1] === toPath(import.meta.url) ||
    process.argv[1].endsWith('/cli/main.ts') ||
    process.argv[1].endsWith('/cli/main.js'));

if (invokedDirectly) {
  void runCli(process.argv.slice(2));
}
