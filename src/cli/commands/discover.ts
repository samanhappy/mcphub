import { ApiClient } from '../http.js';
import { CliApiError, CliUsageError } from '../errors.js';
import { GlobalFlags, resolveTargetForPublic } from '../context.js';
import { extractFlags } from '../parse-args.js';
import { dim, printJson, printLine, printTable } from '../output.js';

// Minimal local types for the discovery responses. These mirror the shapes
// added by the #809 branch's discoveryController. Defined locally so the CLI
// doesn't depend on the MarketServer type being shipped to main.

interface DiscoveryServer {
  name: string;
  display_name?: string;
  description?: string;
  categories?: string[];
  tags?: string[];
  installations?: Record<string, unknown>;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface DiscoverDeps {
  client?: ApiClient;
}

export async function run(args: string[], globals: GlobalFlags, deps: DiscoverDeps = {}): Promise<void> {
  const sub = args[0];
  // Reserved subcommands consume the head; everything else flows through to
  // the default "list" behavior.
  if (sub === 'info') {
    return info(args.slice(1), globals, deps);
  }
  if (sub === 'categories') {
    return categories(args.slice(1), globals, deps);
  }
  if (sub === 'tags') {
    return tags(args.slice(1), globals, deps);
  }
  return list(args, globals, deps);
}

function client(globals: GlobalFlags, remote: string | undefined, deps: DiscoverDeps): ApiClient {
  if (deps.client) return deps.client;
  const { baseUrl } = resolveTargetForPublic(globals, remote);
  // Public endpoints — no token attached.
  return new ApiClient({ baseUrl });
}

function notEnabledHint(): string {
  return (
    'Discovery is not enabled on the target hub.\n' +
    'Ask an admin to set `systemConfig.discovery.enabled = true` in mcp_settings.json.'
  );
}

async function list(args: string[], globals: GlobalFlags, deps: DiscoverDeps): Promise<void> {
  const { flags } = extractFlags(args, {
    valued: ['--remote', '--search', '--category', '--tag', '--limit'],
  });
  const c = client(globals, flags['--remote'] as string | undefined, deps);
  const qs = new URLSearchParams();
  if (flags['--search']) qs.set('search', String(flags['--search']));
  if (flags['--category']) qs.set('category', String(flags['--category']));
  if (flags['--tag']) qs.set('tag', String(flags['--tag']));
  if (flags['--limit']) qs.set('limit', String(flags['--limit']));
  const path = `/discovery/servers${qs.toString() ? `?${qs}` : ''}`;
  let res: ApiResponse<{ total: number; servers: DiscoveryServer[] }>;
  try {
    res = await c.get(path);
  } catch (e) {
    if (e instanceof CliApiError && e.status === 404) {
      throw new CliUsageError(notEnabledHint());
    }
    throw e;
  }
  const data = res.data ?? { total: 0, servers: [] };
  if (globals.json) {
    printJson(data);
    return;
  }
  if (data.servers.length === 0) {
    printLine(dim('(no servers)'));
    return;
  }
  printTable(
    data.servers.map((s) => ({
      name: s.name,
      categories: (s.categories ?? []).join(','),
      description: trim(s.description ?? '', 60),
    })),
    ['name', 'categories', 'description'],
  );
  printLine(dim(`Total: ${data.total}`));
}

async function info(args: string[], globals: GlobalFlags, deps: DiscoverDeps): Promise<void> {
  const { positional, flags } = extractFlags(args, { valued: ['--remote'] });
  const name = positional[0];
  if (!name) throw new CliUsageError('Usage: mcphub discover info <name>');
  const c = client(globals, flags['--remote'] as string | undefined, deps);
  try {
    const res = await c.get<ApiResponse<DiscoveryServer>>(
      `/discovery/servers/${encodeURIComponent(name)}`,
    );
    if (globals.json) {
      printJson(res.data);
      return;
    }
    printLine(JSON.stringify(res.data, null, 2));
  } catch (e) {
    if (e instanceof CliApiError && e.status === 404) {
      // The same 404 covers "discovery disabled" and "server not found" —
      // discoveryController returns "Not found" for both. Use the response
      // message to disambiguate when possible.
      if (typeof e.message === 'string' && /not.*found/i.test(e.message)) {
        throw new CliUsageError(`Server not found in marketplace: ${name}`);
      }
      throw new CliUsageError(notEnabledHint());
    }
    throw e;
  }
}

async function categories(args: string[], globals: GlobalFlags, deps: DiscoverDeps): Promise<void> {
  const { flags } = extractFlags(args, { valued: ['--remote'] });
  const c = client(globals, flags['--remote'] as string | undefined, deps);
  const res = await c.get<ApiResponse<string[]>>('/discovery/categories');
  if (globals.json) {
    printJson(res.data);
    return;
  }
  for (const cat of res.data ?? []) printLine(cat);
}

async function tags(args: string[], globals: GlobalFlags, deps: DiscoverDeps): Promise<void> {
  const { flags } = extractFlags(args, { valued: ['--remote'] });
  const c = client(globals, flags['--remote'] as string | undefined, deps);
  const res = await c.get<ApiResponse<string[]>>('/discovery/tags');
  if (globals.json) {
    printJson(res.data);
    return;
  }
  for (const t of res.data ?? []) printLine(t);
}

function trim(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
