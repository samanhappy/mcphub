import fs from 'node:fs';
import { ApiClient } from '../http.js';
import { GlobalFlags, buildClient, resolveTarget } from '../context.js';
import { extractFlags } from '../parse-args.js';
import { green, printLine } from '../output.js';

export interface ExportDeps {
  client?: ApiClient;
  fs?: Pick<typeof fs, 'writeFileSync'>;
}

export async function run(args: string[], globals: GlobalFlags, deps: ExportDeps = {}): Promise<void> {
  const { flags } = extractFlags(args, { valued: ['--out'] });
  const client = deps.client ?? buildClient(resolveTarget(globals));
  const settings = await client.get<unknown>('/api/mcp-settings/export');
  const json = JSON.stringify(settings, null, 2);
  const outPath = flags['--out'] as string | undefined;
  if (outPath) {
    (deps.fs ?? fs).writeFileSync(outPath, json);
    printLine(green(`Wrote ${outPath}`));
    return;
  }
  // Use printLine so the trailing newline is consistent with the rest of CLI
  // output (and so --json behavior is predictable when piped).
  printLine(json);
}
