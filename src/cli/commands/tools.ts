import { ApiClient } from '../http.js';
import { CliUsageError } from '../errors.js';
import { GlobalFlags, buildClient, resolveTarget } from '../context.js';
import { extractFlags } from '../parse-args.js';
import { bold, dim, printJson, printLine, printTable } from '../output.js';
import type { ServerInfo, Tool } from '../../types/index.js';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

interface FlatTool {
  server: string;
  serverStatus: ServerInfo['status'];
  name: string;
  description?: string;
  enabled?: boolean;
  inputSchema?: Record<string, unknown>;
}

export interface ToolsDeps {
  client?: ApiClient;
}

// `tools` is the agent-friendly index for `call`: it answers "what can I call,
// what params does it take, where does it live" in one place, without making
// callers post-process `servers list` responses.

export async function run(args: string[], globals: GlobalFlags, deps: ToolsDeps = {}): Promise<void> {
  const sub = args.shift();
  const client = deps.client ?? buildClient(resolveTarget(globals));
  switch (sub) {
    case undefined:
    case 'list':
      return list(client, args, globals);
    case 'get':
    case 'schema':
      return get(client, args, globals);
    default:
      throw new CliUsageError(`Unknown tools subcommand: ${sub}`);
  }
}

async function fetchFlatTools(client: ApiClient): Promise<FlatTool[]> {
  const res = await client.get<ApiResponse<ServerInfo[]>>('/api/servers');
  const servers = res.data ?? [];
  const out: FlatTool[] = [];
  for (const s of servers) {
    for (const t of (s.tools ?? []) as Tool[]) {
      out.push({
        server: s.name,
        serverStatus: s.status,
        name: t.name,
        description: t.description,
        enabled: t.enabled,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      });
    }
  }
  return out;
}

async function list(client: ApiClient, args: string[], globals: GlobalFlags): Promise<void> {
  const { flags } = extractFlags(args, {
    valued: ['--server'],
    boolean: ['--schema', '--enabled-only'],
  });
  let tools = await fetchFlatTools(client);
  if (flags['--server']) {
    const wanted = String(flags['--server']);
    tools = tools.filter((t) => t.server === wanted);
  }
  if (flags['--enabled-only']) {
    tools = tools.filter((t) => t.enabled !== false);
  }

  if (globals.json) {
    if (!flags['--schema']) {
      // Drop inputSchema by default to keep the JSON small; callers can opt in.
      printJson(tools.map(({ inputSchema: _omit, ...rest }) => rest));
    } else {
      printJson(tools);
    }
    return;
  }

  if (tools.length === 0) {
    printLine(dim('(no tools)'));
    return;
  }
  printTable(
    tools.map((t) => ({
      server: t.server,
      tool: t.name,
      enabled: t.enabled === false ? 'no' : 'yes',
      description: truncate(t.description ?? '', 60),
    })),
    ['server', 'tool', 'enabled', 'description'],
  );
  printLine(
    dim(
      `\nUse \`mcphub tools get <tool> [--server <name>]\` to see input schema and required params.`,
    ),
  );
}

async function get(client: ApiClient, args: string[], globals: GlobalFlags): Promise<void> {
  const { positional, flags } = extractFlags(args, { valued: ['--server'] });
  const name = positional[0];
  if (!name) {
    throw new CliUsageError('Usage: mcphub tools get <tool-name> [--server <server-name>]');
  }
  const wantedServer = flags['--server'] as string | undefined;
  const matches = (await fetchFlatTools(client)).filter(
    (t) => t.name === name && (!wantedServer || t.server === wantedServer),
  );

  if (matches.length === 0) {
    throw new CliUsageError(
      wantedServer
        ? `Tool "${name}" not found on server "${wantedServer}". Run \`mcphub tools list\` to see what's available.`
        : `Tool "${name}" not found. Run \`mcphub tools list\` to see what's available.`,
    );
  }
  if (matches.length > 1 && !wantedServer) {
    const hosts = matches.map((m) => m.server).join(', ');
    throw new CliUsageError(
      `Tool "${name}" exists on multiple servers (${hosts}). Pass --server <name> to pick one.`,
    );
  }

  const tool = matches[0];
  if (globals.json) {
    printJson(tool);
    return;
  }

  const schema = tool.inputSchema as
    | { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
    | undefined;
  const required = new Set(schema?.required ?? []);
  const props = schema?.properties ?? {};

  printLine(`${bold('Server:')}      ${tool.server} (${tool.serverStatus})`);
  printLine(`${bold('Tool:')}        ${tool.name}`);
  if (tool.description) {
    printLine(`${bold('Description:')} ${tool.description}`);
  }
  if (tool.enabled === false) {
    printLine(dim('(disabled — calls will fail until re-enabled)'));
  }
  printLine('');
  if (Object.keys(props).length === 0) {
    printLine(dim('No documented parameters.'));
  } else {
    printLine(bold('Parameters:'));
    const rows = Object.entries(props).map(([key, p]) => ({
      param: key,
      type: typeof p === 'object' && p ? p.type ?? '' : '',
      required: required.has(key) ? 'yes' : 'no',
      description: truncate(typeof p === 'object' && p ? p.description ?? '' : '', 60),
    }));
    printTable(rows, ['param', 'type', 'required', 'description']);
  }

  printLine('');
  printLine(bold('Input schema (JSON):'));
  printLine(JSON.stringify(tool.inputSchema ?? {}, null, 2));

  printLine('');
  printLine(bold('Example:'));
  const example = buildExample(tool, required, props);
  printLine(`  ${example}`);
}

function buildExample(
  tool: FlatTool,
  required: Set<string>,
  props: Record<string, { type?: string; description?: string }>,
): string {
  const sample = (type: string | undefined) => {
    switch (type) {
      case 'number':
      case 'integer':
        return '0';
      case 'boolean':
        return 'true';
      case 'array':
        return '[]';
      case 'object':
        return '{}';
      default:
        return '<value>';
    }
  };
  const parts = ['mcphub', 'call', tool.name];
  // Show required params first, with a hint at the type. Optional params are
  // intentionally omitted so the example is the minimum-viable call.
  const reqKeys = Array.from(required);
  for (const key of reqKeys) {
    const p = props[key];
    parts.push(`${key}=${sample(typeof p === 'object' && p ? p.type : undefined)}`);
  }
  parts.push(`--server`, tool.server);
  return parts.join(' ');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
