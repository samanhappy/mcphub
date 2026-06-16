import { ApiClient } from '../http.js';
import { CliUsageError } from '../errors.js';
import { GlobalFlags, buildClient, resolveTarget } from '../context.js';
import { green, printJson, printLine } from '../output.js';

interface CacheClearResult {
  status: 'cleared' | 'skipped' | 'error';
  message?: string;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  results?: T;
}

export async function run(args: string[], globals: GlobalFlags): Promise<void> {
  const sub = args.shift();
  const client = buildClient(resolveTarget(globals));
  switch (sub) {
    case undefined:
    case 'clear':
      return clear(client, globals);
    default:
      throw new CliUsageError(`Unknown cache subcommand: ${sub}. Available: clear`);
  }
}

async function clear(client: ApiClient, globals: GlobalFlags): Promise<void> {
  const res = await client.post<ApiResponse<Record<string, CacheClearResult>>>('/api/cache/clear', {});

  if (globals.json) {
    printJson(res);
    return;
  }

  const results = res.results || {};
  const entries = Object.entries(results);

  if (entries.length === 0) {
    printLine(res.message || 'Cache clear completed');
    return;
  }

  for (const [runner, info] of entries) {
    if (info.status === 'cleared') {
      printLine(green(`  ${runner}: cleared`));
    } else if (info.status === 'skipped') {
      printLine(`  ${runner}: skipped (${info.message || 'not found'})`);
    } else {
      printLine(`  ${runner}: error (${info.message || 'unknown'})`);
    }
  }
}
