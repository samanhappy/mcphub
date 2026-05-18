import { ApiClient } from '../http.js';
import { CliUsageError } from '../errors.js';
import { GlobalFlags, buildClient, resolveTarget } from '../context.js';
import { extractFlags } from '../parse-args.js';
import { green, maskToken, printJson, printLine, printTable } from '../output.js';
import type { BearerKey, BearerKeyAccessType } from '../../types/index.js';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

const VALID_ACCESS_TYPES: BearerKeyAccessType[] = ['all', 'groups', 'servers', 'custom'];

export interface KeysDeps {
  client?: ApiClient;
}

export async function run(args: string[], globals: GlobalFlags, deps: KeysDeps = {}): Promise<void> {
  const sub = args.shift();
  const client = deps.client ?? buildClient(resolveTarget(globals));
  switch (sub) {
    case undefined:
    case 'list':
      return list(client, globals);
    case 'create':
      return create(client, args, globals);
    case 'delete':
      return remove(client, args);
    default:
      throw new CliUsageError(`Unknown keys subcommand: ${sub}`);
  }
}

async function list(client: ApiClient, globals: GlobalFlags): Promise<void> {
  const res = await client.get<ApiResponse<BearerKey[]>>('/api/auth/keys');
  const keys = res.data ?? [];
  if (globals.json) {
    // Show the raw token in --json so scripts can capture it. Plaintext only
    // returns to the user who has admin access to the hub anyway.
    printJson(keys);
    return;
  }
  printTable(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      enabled: k.enabled ? 'yes' : 'no',
      accessType: k.accessType,
      token: maskToken(k.token),
    })),
    ['id', 'name', 'enabled', 'accessType', 'token'],
  );
}

async function create(client: ApiClient, args: string[], globals: GlobalFlags): Promise<void> {
  const { flags } = extractFlags(args, {
    valued: ['--name', '--access-type', '--groups', '--servers', '--token'],
    boolean: ['--disabled'],
  });
  const name = flags['--name'] as string | undefined;
  if (!name) {
    throw new CliUsageError(
      'Usage: mcphub keys create --name <n> [--access-type all|groups|servers|custom] [--groups a,b] [--servers x,y]',
    );
  }
  const accessType = (flags['--access-type'] as BearerKeyAccessType | undefined) ?? 'all';
  if (!VALID_ACCESS_TYPES.includes(accessType)) {
    throw new CliUsageError(
      `Invalid --access-type: ${accessType}. Expected one of ${VALID_ACCESS_TYPES.join(', ')}`,
    );
  }
  const body: Partial<BearerKey> = {
    name,
    enabled: !flags['--disabled'],
    accessType,
  };
  if (flags['--token']) body.token = flags['--token'] as string;
  if (accessType === 'groups' || accessType === 'custom') {
    if (flags['--groups']) body.allowedGroups = splitCsv(flags['--groups'] as string);
  }
  if (accessType === 'servers' || accessType === 'custom') {
    if (flags['--servers']) body.allowedServers = splitCsv(flags['--servers'] as string);
  }

  const res = await client.post<ApiResponse<BearerKey>>('/api/auth/keys', body);
  if (globals.json) {
    printJson(res.data);
    return;
  }
  printLine(green(`Created key "${name}" (id: ${res.data?.id ?? 'unknown'}).`));
  if (res.data?.token) {
    // The server generates the token if not supplied. Print it once — admins
    // need to copy it before navigating away.
    printLine(`Token: ${res.data.token}`);
  }
}

async function remove(client: ApiClient, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) throw new CliUsageError('Usage: mcphub keys delete <id>');
  await client.delete(`/api/auth/keys/${encodeURIComponent(id)}`);
  printLine(green(`Deleted key ${id}.`));
}

function splitCsv(s: string): string[] {
  return s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}
