import fs from 'node:fs';
import { ApiClient } from '../http.js';
import { CliApiError, CliUsageError } from '../errors.js';
import {
  GlobalFlags,
  buildClient,
  resolveTarget,
  resolveTargetForPublic,
} from '../context.js';
import { extractFlags } from '../parse-args.js';
import { green, printJson, printLine, printWarn } from '../output.js';
import { promptLine } from '../prompts.js';

// Local mirrors of the #809 controller's response shape. See
// `src/controllers/discoveryController.ts` on the implement-issue-809 branch.

interface InstallSnippet {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface InstallResponse {
  name: string;
  installationType: string;
  availableTypes: string[];
  mcpServers: Record<string, InstallSnippet>;
  arguments?: Record<string, { description?: string; required?: boolean; example?: string }>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
}

type Destination = 'hub' | 'file' | 'stdout';

export interface InstallDeps {
  sourceClient?: ApiClient; // marketplace source (no auth needed)
  destClient?: ApiClient; // active profile hub (auth needed for /api/servers)
  fs?: Pick<typeof fs, 'readFileSync' | 'writeFileSync' | 'existsSync' | 'renameSync'>;
  prompts?: { line: (q: string) => Promise<string> };
}

export async function run(args: string[], globals: GlobalFlags, deps: InstallDeps = {}): Promise<void> {
  const { positional, flags } = extractFlags(args, {
    valued: ['--remote', '--type', '--to', '--out'],
    boolean: ['--yes', '--force', '--dry-run'],
  });

  const name = positional[0];
  if (!name) {
    throw new CliUsageError(
      'Usage: mcphub install <name> [--remote <url>] [--type <type>]\n' +
        '                 [--to hub|file|stdout] [--out <path>] [--env K=V ...]\n' +
        '                 [--dry-run] [--yes] [--force]',
    );
  }

  const dest: Destination = flags['--dry-run']
    ? 'stdout'
    : ((flags['--to'] as Destination | undefined) ?? 'hub');
  if (!['hub', 'file', 'stdout'].includes(dest)) {
    throw new CliUsageError(`--to must be one of: hub, file, stdout (got "${dest}")`);
  }

  const envOverrides = collectEnvOverrides(args);

  const sourceClient =
    deps.sourceClient ??
    new ApiClient({
      baseUrl: resolveTargetForPublic(globals, flags['--remote'] as string | undefined).baseUrl,
    });

  const typeQuery = flags['--type'] ? `?type=${encodeURIComponent(String(flags['--type']))}` : '';
  let envelope: ApiEnvelope<InstallResponse>;
  try {
    envelope = await sourceClient.get<ApiEnvelope<InstallResponse>>(
      `/discovery/servers/${encodeURIComponent(name)}/install${typeQuery}`,
    );
  } catch (e) {
    if (e instanceof CliApiError && e.status === 404) {
      // Surface the server's message verbatim so the "no 'docker' installation
      // method" hint reaches the user. discoveryController returns it in body.message.
      throw new CliUsageError(e.message);
    }
    throw e;
  }

  const install = envelope.data;
  if (!install || !install.mcpServers) {
    throw new CliUsageError('Marketplace response did not include an install snippet.');
  }

  // Merge --env overrides into the resolved snippet. The user explicitly
  // passed these so we add new keys too (e.g. DEBUG=1, optional provider keys)
  // rather than restricting overrides to whatever the marketplace declared.
  const snippetKey = Object.keys(install.mcpServers)[0];
  const snippet = install.mcpServers[snippetKey];
  if (Object.keys(envOverrides).length > 0) {
    snippet.env = { ...(snippet.env ?? {}), ...envOverrides };
  }

  // Prompt for required-but-unset env vars when we have a TTY and --yes isn't set.
  await fillRequiredEnv(install, snippet, {
    yes: flags['--yes'] === true,
    prompts: deps.prompts,
  });

  if (dest === 'stdout') {
    printJson({ mcpServers: install.mcpServers });
    return;
  }

  if (dest === 'file') {
    return writeToFile(install, flags['--out'] as string | undefined, !!flags['--force'], deps);
  }

  // dest === 'hub'
  return writeToHub(install, snippetKey, globals, deps);
}

function collectEnvOverrides(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--env') {
      const v = argv[++i];
      if (v === undefined) throw new CliUsageError('--env expects KEY=VALUE');
      const eq = v.indexOf('=');
      if (eq < 0) throw new CliUsageError(`--env expects KEY=VALUE, got: ${v}`);
      out[v.slice(0, eq)] = v.slice(eq + 1);
    } else if (token.startsWith('--env=')) {
      const v = token.slice('--env='.length);
      const eq = v.indexOf('=');
      if (eq < 0) throw new CliUsageError(`--env expects KEY=VALUE, got: ${v}`);
      out[v.slice(0, eq)] = v.slice(eq + 1);
    }
  }
  return out;
}

async function fillRequiredEnv(
  install: InstallResponse,
  snippet: InstallSnippet,
  opts: { yes: boolean; prompts?: InstallDeps['prompts'] },
): Promise<void> {
  if (!install.arguments || !snippet.env) return;
  const missing: string[] = [];
  for (const [argName, def] of Object.entries(install.arguments)) {
    if (!def.required) continue;
    const current = snippet.env[argName];
    const placeholder =
      current === undefined ||
      current === '' ||
      current === def.example ||
      (typeof current === 'string' && /<.*>/.test(current));
    if (!placeholder) continue;
    if (opts.yes) {
      missing.push(argName);
      continue;
    }
    const prompt = opts.prompts?.line ?? promptLine;
    const value = await prompt(`${argName}${def.description ? ` (${def.description})` : ''}: `);
    if (!value) {
      missing.push(argName);
      continue;
    }
    snippet.env[argName] = value;
  }
  if (missing.length > 0) {
    throw new CliUsageError(
      `Missing required env values: ${missing.join(', ')}. Pass them via --env KEY=VALUE.`,
    );
  }
}

function writeToFile(
  install: InstallResponse,
  outPath: string | undefined,
  force: boolean,
  deps: InstallDeps,
): void {
  if (!outPath) {
    throw new CliUsageError('--to file requires --out <path>');
  }
  const reader = deps.fs ?? fs;
  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (reader.existsSync(outPath)) {
    try {
      existing = JSON.parse(reader.readFileSync(outPath, 'utf8'));
    } catch (e) {
      throw new CliUsageError(`Failed to parse existing ${outPath}: ${(e as Error).message}`);
    }
  }
  const merged: { mcpServers: Record<string, unknown> } = {
    ...existing,
    mcpServers: { ...(existing.mcpServers ?? {}) },
  };
  for (const [k, v] of Object.entries(install.mcpServers)) {
    if (merged.mcpServers[k] && !force) {
      throw new CliUsageError(
        `"${k}" already present in ${outPath}. Pass --force to overwrite.`,
      );
    }
    merged.mcpServers[k] = v;
  }
  // Atomic write: a crashed write must not leave a half-written config (the
  // target may be the user's primary Claude Desktop / OpenClaw config).
  const tmp = `${outPath}.tmp.${process.pid}`;
  reader.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  reader.renameSync(tmp, outPath);
  printLine(green(`Wrote ${Object.keys(install.mcpServers).length} server(s) to ${outPath}.`));
}

async function writeToHub(
  install: InstallResponse,
  snippetKey: string,
  globals: GlobalFlags,
  deps: InstallDeps,
): Promise<void> {
  const dest = deps.destClient ?? buildClient(resolveTarget(globals));
  const snippet = install.mcpServers[snippetKey];
  const config = {
    type: 'stdio' as const,
    command: snippet.command,
    args: snippet.args,
    env: snippet.env,
    enabled: true,
  };
  await dest.post('/api/servers', { name: snippetKey, config });
  printLine(
    green(
      `Installed "${snippetKey}" (${install.installationType}) into the active hub. ` +
        `Run \`mcphub servers reload ${snippetKey}\` if it doesn't connect automatically.`,
    ),
  );
  if (install.availableTypes && install.availableTypes.length > 1) {
    printWarn(
      `Other installation types available: ${install.availableTypes
        .filter((t) => t !== install.installationType)
        .join(', ')}`,
    );
  }
}
