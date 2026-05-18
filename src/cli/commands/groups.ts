import { ApiClient } from '../http.js';
import { CliUsageError } from '../errors.js';
import { GlobalFlags, buildClient, resolveTarget } from '../context.js';
import { extractFlags } from '../parse-args.js';
import { green, printJson, printLine, printTable } from '../output.js';
import type { IGroup } from '../../types/index.js';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface GroupsDeps {
  client?: ApiClient;
}

export async function run(args: string[], globals: GlobalFlags, deps: GroupsDeps = {}): Promise<void> {
  const sub = args.shift();
  const client = deps.client ?? buildClient(resolveTarget(globals));
  switch (sub) {
    case undefined:
    case 'list':
      return list(client, globals);
    case 'get':
      return get(client, args, globals);
    case 'add':
      return add(client, args, globals);
    case 'remove':
      return remove(client, args);
    case 'add-server':
      return addServer(client, args);
    case 'remove-server':
      return removeServer(client, args);
    default:
      throw new CliUsageError(`Unknown groups subcommand: ${sub}`);
  }
}

async function fetchAll(client: ApiClient): Promise<IGroup[]> {
  const res = await client.get<ApiResponse<IGroup[]>>('/api/groups');
  return res.data ?? [];
}

// /api/groups/:id resolves by UUID. The CLI accepts a name too — we look it up
// client-side and substitute the UUID before calling.
async function resolveGroupId(client: ApiClient, ref: string): Promise<string> {
  const groups = await fetchAll(client);
  const match = groups.find((g) => g.id === ref || g.name === ref);
  if (!match) throw new CliUsageError(`Group not found: ${ref}`);
  return match.id;
}

async function list(client: ApiClient, globals: GlobalFlags): Promise<void> {
  const groups = await fetchAll(client);
  if (globals.json) {
    printJson(groups);
    return;
  }
  printTable(
    groups.map((g) => ({
      name: g.name,
      id: g.id,
      servers: Array.isArray(g.servers) ? g.servers.length : 0,
      description: g.description ?? '',
    })),
    ['name', 'id', 'servers', 'description'],
  );
}

async function get(client: ApiClient, args: string[], globals: GlobalFlags): Promise<void> {
  const ref = args[0];
  if (!ref) throw new CliUsageError('Usage: mcphub groups get <id|name>');
  const id = await resolveGroupId(client, ref);
  const res = await client.get<ApiResponse<IGroup>>(`/api/groups/${encodeURIComponent(id)}`);
  if (globals.json) {
    printJson(res.data);
    return;
  }
  printLine(JSON.stringify(res.data, null, 2));
}

async function add(client: ApiClient, args: string[], globals: GlobalFlags): Promise<void> {
  const { positional, flags } = extractFlags(args, {
    valued: ['--description'],
  });
  const name = positional[0];
  if (!name) throw new CliUsageError('Usage: mcphub groups add <name> [--description <d>]');
  const res = await client.post<ApiResponse<IGroup>>('/api/groups', {
    name,
    description: flags['--description'] ?? '',
  });
  if (globals.json) {
    printJson(res.data);
    return;
  }
  printLine(green(`Created group "${name}" (id: ${res.data?.id ?? 'unknown'}).`));
}

async function remove(client: ApiClient, args: string[]): Promise<void> {
  const ref = args[0];
  if (!ref) throw new CliUsageError('Usage: mcphub groups remove <id|name>');
  const id = await resolveGroupId(client, ref);
  await client.delete(`/api/groups/${encodeURIComponent(id)}`);
  printLine(green(`Removed group "${ref}".`));
}

async function addServer(client: ApiClient, args: string[]): Promise<void> {
  const [groupRef, serverName] = args;
  if (!groupRef || !serverName) {
    throw new CliUsageError('Usage: mcphub groups add-server <group> <server>');
  }
  const id = await resolveGroupId(client, groupRef);
  await client.post(`/api/groups/${encodeURIComponent(id)}/servers`, { serverName });
  printLine(green(`Added "${serverName}" to group "${groupRef}".`));
}

async function removeServer(client: ApiClient, args: string[]): Promise<void> {
  const [groupRef, serverName] = args;
  if (!groupRef || !serverName) {
    throw new CliUsageError('Usage: mcphub groups remove-server <group> <server>');
  }
  const id = await resolveGroupId(client, groupRef);
  await client.delete(
    `/api/groups/${encodeURIComponent(id)}/servers/${encodeURIComponent(serverName)}`,
  );
  printLine(green(`Removed "${serverName}" from group "${groupRef}".`));
}
