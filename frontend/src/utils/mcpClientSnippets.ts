/**
 * Per-client MCP configuration presets for the copy actions (#1165).
 *
 * MCPHub hands out HTTP endpoints, so every preset describes the same target -
 * a name, an optional URL/headers pair (HTTP) or command/args/env triple
 * (stdio) - in the shape the selected client expects. Eleven of the fourteen
 * presets were verified against the upstream sources below (URLs re-checked
 * 2026-09, the month this file landed); the remaining three reuse the generic
 * `mcpServers` shape (or, for the generic-http escape hatch, the bare entry)
 * these copy actions always produced.
 *
 * Which clients document an explicit transport field, and which do not:
 * - Documents a transport field (the `type` key is written into the entry):
 *   claude-code (`type: "http" | "sse" | "stdio"`; a remote entry with `url`
 *   but no `type` is a configuration error per
 *   https://code.claude.com/docs/en/mcp), vscode (`"http" | "sse" | "stdio"`,
 *   final URL after the 2026-09 migration:
 *   https://code.visualstudio.com/docs/agent-customization/mcp-servers),
 *   codebuddy (`type` marked Required; fixed `"http"` for HTTP, `"sse"` for
 *   SSE and `"stdio"` for stdio, per
 *   https://www.codebuddy.ai/docs/cli/mcp), qoder (every remote
 *   example carries `type`; for Streamable HTTP the doc says to configure the
 *   URL the same way as SSE and the IDE auto-detects it, so the http target
 *   deliberately keeps the bare `url` + `headers` shape rather than tagging
 *   it `sse`; https://docs.qoder.com/zh/user-guide/chat/model-context-protocol),
 *   cherry-studio (`baseUrl` + `'sse' | 'streamableHttp'`, strict schema),
 *   opencode (`type: 'remote' | 'local'`).
 * - Field table does not list a transport key: cursor
 *   (https://cursor.com/docs/mcp), trae (https://docs.trae.ai/ide/add-mcp-servers),
 *   zcode (https://zcode.z.ai/en/docs/mcp-services), windsurf
 *   (https://docs.windsurf.com/windsurf/cascade/mcp). The `type: "sse"` marker
 *   the generic shape injects for SSE targets on these presets is added on
 *   the assumption that unknown keys are ignored, not required by their
 *   documented shape; it is kept because SSE upstreams must not be dialed as
 *   streamable HTTP.
 * - Verified but the format carries no `type` key at all: codex (TOML;
 *   `codex-rs/config/src/mcp_types.rs`,
 *   https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs).
 *   (The generic-http escape hatch, one of the three unverified presets, is not
 *   a "no `type`" format: for a remote target it always writes an explicit
 *   `type` - `"http"`, or `"sse"` for an SSE upstream.)
 *
 * Upstream sources used:
 * - Claude Code MCP configuration: https://code.claude.com/docs/en/mcp
 * - Cursor MCP docs: https://cursor.com/docs/mcp
 * - VS Code MCP configuration reference:
 *   https://code.visualstudio.com/docs/agent-customization/mcp-servers
 * - Codex `codex-rs/config/src/mcp_types.rs`:
 *   https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs
 * - OpenCode mcp-servers docs: https://opencode.ai/docs/mcp-servers/
 * - Cherry Studio `mcpProtocolInstall.ts`:
 *   https://github.com/CherryHQ/cherry-studio/blob/main/src/shared/data/types/mcpProtocolInstall.ts
 * - CodeBuddy MCP CLI docs: https://www.codebuddy.ai/docs/cli/mcp
 * - Qoder MCP user guide:
 *   https://docs.qoder.com/zh/user-guide/chat/model-context-protocol
 * - Trae MCP docs: https://docs.trae.ai/ide/add-mcp-servers
 * - Windsurf MCP docs: https://docs.windsurf.com/windsurf/cascade/mcp
 * - ZCode MCP docs: https://zcode.z.ai/en/docs/mcp-services
 */

export type ClientSnippetId =
  | 'generic-mcp-servers'
  | 'generic-http'
  | 'claude-code'
  | 'cursor'
  | 'vscode'
  | 'codex'
  | 'opencode'
  | 'windsurf'
  | 'cherry-studio'
  | 'codebuddy'
  | 'qoder'
  | 'trae'
  | 'zcode'
  | 'workbuddy';

export interface ClientSnippetPreset {
  id: ClientSnippetId;
}

/** Tab the dialog opens on; the shape the copy actions produced before. */
export const DEFAULT_CLIENT_SNIPPET_ID: ClientSnippetId = 'generic-mcp-servers';

/**
 * Tabs shown in the copy dialog, most common clients first. The first entry is
 * the shape the copy actions produced before the presets existed, so the
 * default tab stays familiar; the bare HTTP entry is the escape hatch for
 * clients that wrap the entry in their own container.
 */
export const CLIENT_SNIPPET_PRESETS: readonly ClientSnippetPreset[] = [
  { id: 'generic-mcp-servers' },
  { id: 'claude-code' },
  { id: 'cursor' },
  { id: 'vscode' },
  { id: 'codex' },
  { id: 'opencode' },
  { id: 'windsurf' },
  { id: 'cherry-studio' },
  { id: 'codebuddy' },
  { id: 'qoder' },
  { id: 'trae' },
  { id: 'zcode' },
  { id: 'workbuddy' },
  { id: 'generic-http' },
];

export interface ClientSnippetTarget {
  name: string;
  /** Stored transport type; `sse` is called out so clients do not misdial it as http. */
  type?: 'stdio' | 'sse' | 'streamable-http' | 'openapi';
  /** HTTP targets carry a URL (and usually an Authorization header). */
  url?: string;
  headers?: Record<string, string>;
  /** stdio targets carry a command instead. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface ClientSnippetBlock {
  kind: 'config' | 'command';
  text: string;
}

export interface ClientSnippetOptions {
  /** Description used by the VS Code token input prompt. */
  tokenPromptDescription?: string;
}

/** Placeholder MCPHub uses for snippets that need a token pasted in by hand. */
export const ACCESS_TOKEN_PLACEHOLDER = '<your-access-token>';
const TOKEN_INPUT_ID = 'mcphub-token';

const isHttpTarget = (target: ClientSnippetTarget): boolean => Boolean(target.url);

const definedHeaders = (target: ClientSnippetTarget): Record<string, string> | undefined => {
  const entries = Object.entries(target.headers ?? {}).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const definedEnv = (target: ClientSnippetTarget): Record<string, string> | undefined => {
  const entries = Object.entries(target.env ?? {}).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const stdioEntry = (target: ClientSnippetTarget): Record<string, unknown> => {
  const args = target.args?.filter((arg) => arg !== undefined) ?? [];
  const env = definedEnv(target);
  return {
    command: target.command ?? '',
    ...(args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
  };
};

/**
 * HTTP/stdio entry for clients whose docs make the transport a required field.
 * Claude Code skips an entry that has a `url` but no `type` (it reads the
 * entry as stdio and reports a configuration error), and CodeBuddy's field
 * table marks `type` as Required, fixed to `"http"` for the HTTP form and
 * `"sse"` for the SSE form.
 *
 * Stdio targets differ between the two clients. Claude Code reads a type-less
 * entry as stdio (https://code.claude.com/docs/en/mcp), so its stdio shape
 * keeps the plain command/args/env form with no `type` key. CodeBuddy's docs
 * mark `type` as Required with the fixed value `"stdio"`
 * (https://www.codebuddy.ai/docs/cli/mcp), so its stdio shape writes
 * `"type": "stdio"`; pass `stdioType` only for CodeBuddy.
 */
const typedTransportEntry = (
  target: ClientSnippetTarget,
  stdioType: boolean = false,
): Record<string, unknown> => {
  if (!isHttpTarget(target)) {
    return stdioType ? { type: 'stdio', ...stdioEntry(target) } : stdioEntry(target);
  }

  const headers = definedHeaders(target);
  return {
    type: target.type === 'sse' ? 'sse' : 'http',
    url: target.url ?? '',
    ...(headers ? { headers } : {}),
  };
};

// This helper feeds the generic `mcpServers` shape for the generic-mcp-servers,
// qoder, cursor, windsurf, trae, zcode and workbuddy presets. Only qoder's
// upstream docs carry a transport field for this shape; for the rest
// (generic-mcp-servers, cursor, windsurf, trae, zcode, workbuddy) the
// `type: "sse"` marker is added on the assumption that unknown keys are
// ignored, so it is unverified against a field table. It is kept because an
// SSE upstream must not be dialed as streamable HTTP.
const httpEntry = (target: ClientSnippetTarget): Record<string, unknown> => {
  const headers = definedHeaders(target);
  return {
    // Only `sse` is spelled out: it is the one HTTP transport a client might
    // otherwise misdial as streamable HTTP. Every other target keeps the bare
    // `url` + `headers` shape these presets always produced.
    ...(target.type === 'sse' ? { type: 'sse' } : {}),
    url: target.url ?? '',
    ...(headers ? { headers } : {}),
  };
};

const withWrappedName = (
  wrapper: string,
  name: string,
  entry: Record<string, unknown>,
): string => JSON.stringify({ [wrapper]: { [name]: entry } }, null, 2);

const jsonSnippet = (target: ClientSnippetTarget): string =>
  withWrappedName(
    'mcpServers',
    target.name,
    isHttpTarget(target) ? httpEntry(target) : stdioEntry(target),
  );

// VS Code wants the transport spelled out and can prompt for the token itself,
// so the shared placeholder becomes an input reference plus an `inputs` entry.
const vscodeSnippet = (target: ClientSnippetTarget, options: ClientSnippetOptions): string => {
  const headers = definedHeaders(target);
  const placeholder = `Bearer ${ACCESS_TOKEN_PLACEHOLDER}`;
  const needsTokenInput = headers?.Authorization === placeholder;

  const body = needsTokenInput
    ? { ...headers, Authorization: `Bearer \${input:${TOKEN_INPUT_ID}}` }
    : headers;

  const entry = isHttpTarget(target)
    ? {
        // VS Code distinguishes the SSE transport from streamable HTTP.
        type: target.type === 'sse' ? 'sse' : 'http',
        url: target.url,
        ...(body ? { headers: body } : {}),
      }
    : { type: 'stdio', ...stdioEntry(target) };

  return JSON.stringify(
    {
      servers: { [target.name]: entry },
      ...(needsTokenInput
        ? {
            inputs: [
              {
                id: TOKEN_INPUT_ID,
                type: 'promptString',
                description: options.tokenPromptDescription ?? 'MCPHub access token',
                password: true,
              },
            ],
          }
        : {}),
    },
    null,
    2,
  );
};

const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

const tomlKey = (key: string): string => (TOML_BARE_KEY.test(key) ? key : JSON.stringify(key));
const tomlValue = (value: string): string => JSON.stringify(value);
const tomlInlineTable = (entries: Record<string, string>): string =>
  `{ ${Object.entries(entries)
    .map(([key, value]) => `${tomlKey(key)} = ${tomlValue(value)}`)
    .join(', ')} }`;

// Codex calls the header map `http_headers` (there is no `headers` key), and
// needs quoted table keys for names that are not bare TOML keys - group names
// may contain spaces or CJK. Note `#[schemars(deny_unknown_fields)]` in
// `mcp_types.rs` only constrains the generated JSON Schema; the Rust struct
// itself has no `#[serde(deny_unknown_fields)]`, so TOML parsing may silently
// ignore unknown fields instead of rejecting them.
const codexSnippet = (target: ClientSnippetTarget): string => {
  const key = tomlKey(target.name);
  const lines = [`[mcp_servers.${key}]`];

  if (isHttpTarget(target)) {
    lines.push(`url = ${tomlValue(target.url ?? '')}`);
    const headers = definedHeaders(target);
    if (headers) {
      lines.push(`http_headers = ${tomlInlineTable(headers)}`);
    }
    return lines.join('\n');
  }

  lines.push(`command = ${tomlValue(target.command ?? '')}`);
  const args = target.args?.filter((arg) => arg !== undefined) ?? [];
  if (args.length > 0) {
    lines.push(`args = [${args.map(tomlValue).join(', ')}]`);
  }
  const env = definedEnv(target);
  if (env) {
    lines.push('', `[mcp_servers.${key}.env]`);
    for (const [name, value] of Object.entries(env)) {
      lines.push(`${tomlKey(name)} = ${tomlValue(value)}`);
    }
  }
  return lines.join('\n');
};

const openCodeSnippet = (target: ClientSnippetTarget): string => {
  if (!isHttpTarget(target)) {
    const env = definedEnv(target);
    const args = target.args?.filter((arg) => arg !== undefined) ?? [];
    return JSON.stringify(
      {
        mcp: {
          [target.name]: {
            type: 'local',
            command: [target.command ?? '', ...args],
            ...(env ? { environment: env } : {}),
          },
        },
      },
      null,
      2,
    );
  }

  const headers = definedHeaders(target);
  return JSON.stringify(
    {
      mcp: {
        [target.name]: {
          type: 'remote',
          url: target.url,
          ...(headers ? { headers } : {}),
        },
      },
    },
    null,
    2,
  );
};

// Cherry Studio's `ProtocolMcpServerConfigSchema` is a strict object: remote
// servers use `baseUrl` + `type: 'sse' | 'streamableHttp'` (no `url` key) and
// stdio servers use command/args/env. The install-time metadata
// (`installSource`, `isTrusted`, `installedAt`, `isActive: false`) belongs to
// `ProtocolMcpServerInstallSchema`, the install *request* schema, not to this
// hand-pasted config; an entry carrying `isActive` would not satisfy
// `ProtocolMcpServerConfigSchema` (which has no such key).
const cherryStudioSnippet = (target: ClientSnippetTarget): string => {
  const base = {
    name: target.name,
    description: target.description ?? '',
  };

  const headers = definedHeaders(target);
  const entry = isHttpTarget(target)
    ? {
        ...base,
        // The schema accepts exactly two remote transports; keep SSE upstreams
        // spelled out so Cherry Studio does not dial them as streamable HTTP.
        type: target.type === 'sse' ? 'sse' : 'streamableHttp',
        baseUrl: target.url,
        ...(headers ? { headers } : {}),
      }
    : { ...base, type: 'stdio', ...stdioEntry(target) };

  return withWrappedName('mcpServers', target.name, entry);
};

const CLI_SAFE = /^[A-Za-z0-9._:@/=-]+$/;

// Single quotes are the only reliable POSIX quoting for a pasted command:
// double quotes still let the shell expand `$(...)`, backticks and `${...}`
// inside them. Within single quotes nothing is expanded, so the only character
// needing special handling is `'` itself, escaped as `'\''` (close quote,
// escaped quote, reopen).
const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const cliArg = (value: string): string =>
  CLI_SAFE.test(value) ? value : shellQuote(value);

// Claude Code's one-liner equivalent of the JSON block, in the documented
// HTTP shape: `claude mcp add --transport <t> <name> <url> [--header ...]`.
//
// A positional that starts with `-` cannot be spelled safely in that shape:
// shell quoting is gone by the time the CLI's tokenizer sees the value, and
// the documented `--` separator belongs to the stdio form, so relying on it
// for the HTTP form would be an unverified parsing assumption. Since
// SERVER_NAME_PATTERN admits names like `-foo`, a name or URL starting with
// a dash omits the command block outright - the JSON config block still
// carries the full entry - rather than emitting a command the CLI would
// misparse as one of its own options.
const claudeCodeCommand = (target: ClientSnippetTarget): string | undefined => {
  if (!isHttpTarget(target)) {
    return undefined;
  }

  if (target.name.startsWith('-') || (target.url ?? '').startsWith('-')) {
    return undefined;
  }

  const parts = [
    'claude',
    'mcp',
    'add',
    '--transport',
    // SSE endpoints must not be dialed as streamable HTTP.
    target.type === 'sse' ? 'sse' : 'http',
    cliArg(target.name),
    cliArg(target.url ?? ''),
  ];
  for (const [name, value] of Object.entries(definedHeaders(target) ?? {})) {
    parts.push('--header', cliArg(`${name}: ${value}`));
  }
  return parts.join(' ');
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Narrow a stored `type` to the four legal server types; anything else is dropped. */
const asServerType = (value: unknown): ClientSnippetTarget['type'] => {
  switch (value) {
    case 'stdio':
    case 'sse':
    case 'streamable-http':
    case 'openapi':
      return value;
    default:
      return undefined;
  }
};

const asStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
};

/**
 * Narrow a stored server configuration (the `mcp-settings/export` payload
 * carries MCPHub's internal fields too) down to what a client snippet needs.
 */
export const toClientSnippetTarget = (
  name: string,
  config: Record<string, unknown> | undefined,
): ClientSnippetTarget => {
  const source = config ?? {};

  return {
    name,
    ...(asServerType(source.type) ? { type: asServerType(source.type) } : {}),
    ...(asString(source.url) ? { url: asString(source.url) } : {}),
    ...(asStringRecord(source.headers) ? { headers: asStringRecord(source.headers) } : {}),
    ...(asString(source.command) ? { command: asString(source.command) } : {}),
    ...(asStringArray(source.args) ? { args: asStringArray(source.args) } : {}),
    ...(asStringRecord(source.env) ? { env: asStringRecord(source.env) } : {}),
    ...(asString(source.description) ? { description: asString(source.description) } : {}),
  };
};

const configSnippet = (
  id: ClientSnippetId,
  target: ClientSnippetTarget,
  options: ClientSnippetOptions,
): string => {
  switch (id) {
    case 'generic-mcp-servers':
      return jsonSnippet(target);
    case 'generic-http':
      return JSON.stringify(
        isHttpTarget(target)
          ? { type: 'http', ...httpEntry(target) }
          : stdioEntry(target),
        null,
        2,
      );
    case 'vscode':
      return vscodeSnippet(target, options);
    case 'codex':
      return codexSnippet(target);
    case 'opencode':
      return openCodeSnippet(target);
    case 'cherry-studio':
      return cherryStudioSnippet(target);
    case 'claude-code':
      return withWrappedName('mcpServers', target.name, typedTransportEntry(target));
    case 'codebuddy':
      // CodeBuddy's field table marks `type` as Required, fixed to `"stdio"`
      // for stdio entries, so unlike Claude Code it always carries the type.
      return withWrappedName('mcpServers', target.name, typedTransportEntry(target, true));
    default:
      return jsonSnippet(target);
  }
};

export const buildClientSnippetBlocks = (
  id: ClientSnippetId,
  target: ClientSnippetTarget,
  options: ClientSnippetOptions = {},
): ClientSnippetBlock[] => {
  // OpenAPI-backed servers carry neither a URL nor a command, so every preset
  // would degrade to filler like `command: ""`. Return no blocks and let the
  // dialog explain that there is no client-side transport to copy.
  if (!target.url && !target.command) {
    return [];
  }

  const blocks: ClientSnippetBlock[] = [{ kind: 'config', text: configSnippet(id, target, options) }];

  if (id === 'claude-code') {
    const command = claudeCodeCommand(target);
    if (command) {
      blocks.push({ kind: 'command', text: command });
    }
  }

  return blocks;
};
