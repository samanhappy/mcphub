import { CliUsageError } from './errors.js';
import { GlobalFlags } from './context.js';

// Boolean flags that don't take a value when present without "=".
const BOOLEAN_GLOBALS = new Set(['--bearer', '--json', '--debug']);

// Flags handled at the top level (consumed by main.ts before dispatching to
// a subcommand handler). Anything else flows through to the subcommand's
// argv unchanged so subcommand-specific flags can be parsed locally.

const VALUED_GLOBALS = new Set(['--url', '--token', '--profile']);

export interface ParsedGlobals {
  globalFlags: GlobalFlags;
  rest: string[];
}

export function parseGlobalFlags(argv: string[]): ParsedGlobals {
  const globalFlags: GlobalFlags = {};
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (BOOLEAN_GLOBALS.has(arg)) {
      assignFlag(globalFlags, arg, true);
      continue;
    }

    if (VALUED_GLOBALS.has(arg)) {
      const value = argv[++i];
      if (value === undefined) {
        throw new CliUsageError(`Missing value for ${arg}`);
      }
      assignFlag(globalFlags, arg, value);
      continue;
    }

    // Support --flag=value form for valued flags
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0 && arg.startsWith('--')) {
      const name = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      if (VALUED_GLOBALS.has(name)) {
        assignFlag(globalFlags, name, value);
        continue;
      }
      if (BOOLEAN_GLOBALS.has(name)) {
        assignFlag(globalFlags, name, value !== 'false');
        continue;
      }
    }

    rest.push(arg);
  }

  return { globalFlags, rest };
}

function assignFlag(target: GlobalFlags, flag: string, value: string | boolean): void {
  switch (flag) {
    case '--url':
      target.url = value as string;
      break;
    case '--token':
      target.token = value as string;
      break;
    case '--bearer':
      target.bearer = value as boolean;
      break;
    case '--profile':
      target.profile = value as string;
      break;
    case '--json':
      target.json = value as boolean;
      break;
    case '--debug':
      target.debug = value as boolean;
      break;
  }
}

// Simple subcommand flag extractor. Pulls --name <value> and --bool occurrences
// out of `argv` and returns positional arguments. Supports --name=value too.
export function extractFlags(
  argv: string[],
  spec: { valued?: string[]; boolean?: string[] },
): { positional: string[]; flags: Record<string, string | boolean> } {
  const valued = new Set(spec.valued ?? []);
  const bools = new Set(spec.boolean ?? []);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (bools.has(arg)) {
      flags[arg] = true;
      continue;
    }
    if (valued.has(arg)) {
      const value = argv[++i];
      if (value === undefined) {
        throw new CliUsageError(`Missing value for ${arg}`);
      }
      flags[arg] = value;
      continue;
    }
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0 && arg.startsWith('--')) {
      const name = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      if (valued.has(name)) {
        flags[name] = value;
        continue;
      }
      if (bools.has(name)) {
        flags[name] = value !== 'false';
        continue;
      }
    }
    positional.push(arg);
  }

  return { positional, flags };
}
