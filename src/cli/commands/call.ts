import { ApiClient } from '../http.js';
import { CliUsageError } from '../errors.js';
import { GlobalFlags, buildClient, resolveTarget } from '../context.js';
import { extractFlags } from '../parse-args.js';
import { parseCallArguments } from '../call-arguments.js';
import { printJson, printLine } from '../output.js';

interface JsonRpcResponse<T = unknown> {
  jsonrpc?: string;
  id?: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string; data?: unknown }>;
  isError?: boolean;
}

export interface CallDeps {
  client?: ApiClient;
}

export async function run(args: string[], globals: GlobalFlags, deps: CallDeps = {}): Promise<void> {
  const { positional, flags } = extractFlags(args, {
    valued: ['--group', '--params-json'],
    boolean: ['--smart', '--no-coerce'],
  });

  const tool = positional.shift();
  if (!tool) {
    throw new CliUsageError(
      'Usage: mcphub call <tool> [key=value ...] [--group <g>|--smart] [--params-json <json>]',
    );
  }

  let params: unknown;
  if (flags['--params-json']) {
    try {
      params = JSON.parse(flags['--params-json'] as string);
    } catch (e) {
      throw new CliUsageError(`--params-json is not valid JSON: ${(e as Error).message}`);
    }
  } else {
    const parsed = parseCallArguments(positional, { noCoerce: flags['--no-coerce'] === true });
    params = parsed.args;
  }

  // --smart wins over --group; default also resolves to $smart so smart routing
  // is the documented default behavior.
  const group: string | '$smart' | null =
    flags['--smart'] === true
      ? '$smart'
      : (flags['--group'] as string | undefined) ?? '$smart';

  const client = deps.client ?? buildClient(resolveTarget(globals));
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: params },
  };

  const response = await client.mcpCall<JsonRpcResponse<ToolCallResult>>(group, body);
  if (globals.json) {
    printJson(response);
    return;
  }
  if (response.error) {
    throw new CliUsageError(`MCP error ${response.error.code}: ${response.error.message}`);
  }
  printToolResult(response.result);
}

function printToolResult(result: ToolCallResult | undefined): void {
  if (!result) {
    printLine('(no result)');
    return;
  }
  if (result.isError) {
    printLine('(tool reported an error)');
  }
  if (!Array.isArray(result.content)) {
    printLine(JSON.stringify(result, null, 2));
    return;
  }
  for (const piece of result.content) {
    if (piece.type === 'text' && typeof piece.text === 'string') {
      printLine(piece.text);
    } else {
      printLine(JSON.stringify(piece, null, 2));
    }
  }
}
