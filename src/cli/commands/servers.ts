import fs from 'node:fs';
import { ApiClient } from '../http.js';
import { CliUsageError } from '../errors.js';
import { GlobalFlags, buildClient, resolveTarget } from '../context.js';
import { extractFlags } from '../parse-args.js';
import { green, printJson, printLine, printTable } from '../output.js';
import type { ServerConfig, ServerInfo } from '../../types/index.js';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface ServersDeps {
  client?: ApiClient;
  fs?: Pick<typeof fs, 'readFileSync'>;
}

export async function run(args: string[], globals: GlobalFlags, deps: ServersDeps = {}): Promise<void> {
  const sub = args.shift();
  const client = deps.client ?? buildClient(resolveTarget(globals));
  switch (sub) {
    case undefined:
    case 'list':
      return list(client, globals);
    case 'get':
      return get(client, args, globals);
    case 'add':
      return add(client, args, globals, deps);
    case 'remove':
      return remove(client, args);
    case 'toggle':
      return toggle(client, args);
    case 'reload':
      return reload(client, args);
    default:
      throw new CliUsageError(`Unknown servers subcommand: ${sub}`);
  }
}

async function list(client: ApiClient, globals: GlobalFlags): Promise<void> {
  const res = await client.get<ApiResponse<ServerInfo[]>>('/api/servers');
  const servers = res.data ?? [];
  if (globals.json) {
    printJson(servers);
    return;
  }
  printTable(
    servers.map((s) => ({
      name: s.name,
      status: s.status,
      tools: s.tools?.length ?? 0,
      owner: s.owner ?? '',
      error: s.error ?? '',
    })),
    ['name', 'status', 'tools', 'owner', 'error'],
  );
}

async function get(client: ApiClient, args: string[], globals: GlobalFlags): Promise<void> {
  const name = args[0];
  if (!name) throw new CliUsageError('Usage: mcphub servers get <name>');
  const res = await client.get<ApiResponse<ServerConfig | ServerInfo>>(
    `/api/servers/${encodeURIComponent(name)}`,
  );
  if (globals.json) {
    printJson(res.data);
    return;
  }
  printLine(JSON.stringify(res.data, null, 2));
}

async function add(
  client: ApiClient,
  args: string[],
  globals: GlobalFlags,
  deps: ServersDeps,
): Promise<void> {
  const { positional, flags } = extractFlags(args, {
    valued: ['--from-file', '--type', '--command', '--url', '--description'],
    boolean: ['--enabled', '--disabled'],
  });
  const name = positional[0];
  if (!name) {
    throw new CliUsageError(
      'Usage: mcphub servers add <name> --from-file <path>\n' +
        '   or  mcphub servers add <name> --type <stdio|sse|streamable-http|openapi> [--command ...] [--arg ...] [--env K=V ...]',
    );
  }

  let config: ServerConfig;
  if (flags['--from-file']) {
    const path = flags['--from-file'] as string;
    const raw = (deps.fs ?? fs).readFileSync(path, 'utf8');
    config = JSON.parse(raw) as ServerConfig;
  } else {
    const argArgs = collectRepeated(args, '--arg');
    const envEntries = collectRepeated(args, '--env').map((kv) => {
      const idx = kv.indexOf('=');
      if (idx < 0) throw new CliUsageError(`--env expects KEY=VALUE, got: ${kv}`);
      return [kv.slice(0, idx), kv.slice(idx + 1)] as const;
    });
    config = {
      type: (flags['--type'] as ServerConfig['type']) || 'stdio',
      description: flags['--description'] as string | undefined,
      command: flags['--command'] as string | undefined,
      args: argArgs.length > 0 ? argArgs : undefined,
      env: envEntries.length > 0 ? Object.fromEntries(envEntries) : undefined,
      url: flags['--url'] as string | undefined,
      enabled: flags['--disabled'] ? false : true,
    };
  }

  const res = await client.post<ApiResponse<unknown>>('/api/servers', { name, config });
  if (globals.json) {
    printJson(res);
    return;
  }
  printLine(green(`Added server "${name}".`));
}

async function remove(client: ApiClient, args: string[]): Promise<void> {
  const name = args[0];
  if (!name) throw new CliUsageError('Usage: mcphub servers remove <name>');
  await client.delete(`/api/servers/${encodeURIComponent(name)}`);
  printLine(green(`Removed server "${name}".`));
}

async function toggle(client: ApiClient, args: string[]): Promise<void> {
  const { positional, flags } = extractFlags(args, { boolean: ['--on', '--off'] });
  const name = positional[0];
  if (!name) throw new CliUsageError('Usage: mcphub servers toggle <name> [--on|--off]');
  const body: Record<string, unknown> = {};
  if (flags['--on']) body.enabled = true;
  if (flags['--off']) body.enabled = false;
  await client.post(`/api/servers/${encodeURIComponent(name)}/toggle`, body);
  printLine(green(`Toggled server "${name}".`));
}

async function reload(client: ApiClient, args: string[]): Promise<void> {
  const name = args[0];
  if (!name) throw new CliUsageError('Usage: mcphub servers reload <name>');
  await client.post(`/api/servers/${encodeURIComponent(name)}/reload`, {});
  printLine(green(`Reloaded server "${name}".`));
}

// Helper: pull every occurrence of `--flag <value>` out of argv. extractFlags
// only captures the last occurrence, so repeated flags need this scan. Values
// may legitimately start with `--` (e.g. `--arg --version` for a wrapped CLI);
// we consume them unconditionally and skip the next index so we don't re-scan
// the value as another flag boundary.
function collectRepeated(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      const v = argv[i + 1];
      if (v !== undefined) {
        out.push(v);
        i++;
      }
    } else if (argv[i].startsWith(`${flag}=`)) {
      out.push(argv[i].slice(flag.length + 1));
    }
  }
  return out;
}
