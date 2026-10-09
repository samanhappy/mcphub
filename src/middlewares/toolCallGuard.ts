/**
 * Opt-in pre-call guard for `tools/call` requests.
 *
 * When enabled, tool call arguments are inspected for a small set of
 * high-confidence dangerous payloads — shell command injection/RCE and
 * cloud instance-metadata (SSRF / credential-hijack) targets — and a
 * matching call is blocked before it reaches the upstream MCP server
 * (fail-closed).
 *
 * This module is intentionally narrow:
 * - It inspects only string values inside the call arguments.
 * - Every pattern is a high-confidence indicator of an attack, so benign
 *   arguments (including prose mentioning punctuation such as `|` or `;`)
 *   do not match.
 * - No network access and no third-party dependencies are required.
 *
 * Enable with `TOOL_CALL_GUARD_ENABLED=true`. The guard is off by default
 * and performs no work unless explicitly enabled.
 */

/**
 * Thrown when the guard blocks a tool call. The message is safe to return to
 * the caller; it deliberately does not echo the matched payload.
 */
export class ToolCallBlockedError extends Error {
  constructor(
    message: string,
    /** Stable machine-readable identifier of the rule that fired. */
    public readonly ruleId: string,
  ) {
    super(message);
    this.name = 'ToolCallBlockedError';
  }
}

/** Returns true when the pre-call guard is explicitly enabled via environment. */
export const isToolCallGuardEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.TOOL_CALL_GUARD_ENABLED === 'true';

interface GuardRule {
  id: string;
  /** Returns true when the rule's dangerous pattern is present in the string. */
  test: (value: string) => boolean;
}

/**
 * Command substitution / execution expansions. These forms execute the
 * embedded command whenever a shell interprets the value, so they are a
 * direct RCE indicator. Backtick pairs are matched only when they contain
 * shell syntax, since single backticks are common in prose/markdown.
 */
const COMMAND_EXPANSION: GuardRule = {
  id: 'command-expansion',
  test: (v) =>
    /\$\([^)]/.test(v) ||
    /`[^`]*[;&|$()/]{1,2}[^`]*`/.test(v) ||
    /`\s*(?:sudo\s+)?(?:cat|ls|id|whoami|uname|wget|curl|bash|sh|nc|python|perl|ruby|chmod|chown|rm|cp|mv)\s+[^`]+`/.test(
      v,
    ),
};

/**
 * Classic shell metacharacter chaining (`;`, `&&`, `||`) immediately
 * followed by a command name. Requires a following command token so prose
 * and ordinary punctuation do not match.
 */
const SHELL_CHAINING: GuardRule = {
  id: 'shell-chaining',
  test: (v) =>
    /(?:;|&&|\|\|)\s*(?:sudo\s+)?(?:cat|ls|id|whoami|uname|wget|curl|bash|sh|nc|python|perl|ruby|chmod|chown|rm|cp|mv|export|echo)\b/.test(
      v,
    ),
};

/**
 * Download-and-execute pattern, e.g. `curl http://... | sh` or
 * `wget -O- ... | bash`, including the `sh -c "$(curl ...)"` form.
 */
const DOWNLOADER_PIPE: GuardRule = {
  id: 'downloader-pipe',
  test: (v) =>
    /(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|fi|k|t?c)?sh\b/.test(v) ||
    /(?:ba|z|fi|k|t?c)?sh\s+-c\s+["']?\$\((?:curl|wget)\b/.test(v),
};

/**
 * Reading sensitive account files through a shell command, including their
 * use inside command substitution. `passwd` alone is harmless (it contains
 * only public account names), so a shell action must be present.
 */
const SENSITIVE_FILE_READ: GuardRule = {
  id: 'sensitive-file-read',
  test: (v) =>
    /(?:cat|head|tail|less|more|tac|nl|od|xxd|cp|mv|grep|open)\b[^\n]*\/etc\/(passwd|shadow)(?![\w.-])/.test(
      v,
    ) || /\/etc\/shadow(?![\w.-])/.test(v),
};

/** Forced recursive deletion of a system/home root. */
const FORCE_DELETE_ROOT: GuardRule = {
  id: 'force-delete-root',
  test: (v) => /\brm\b[^\n]*-[^\n]*[rf][^\n]*\s(?:--no-preserve-root\b)?\/(?:\s|$|\*)/.test(v),
};

/** Reverse-shell starters. */
const REVERSE_SHELL: GuardRule = {
  id: 'reverse-shell',
  test: (v) =>
    /\/dev\/tcp\/\S+\/\d+/.test(v) ||
    /bash\s+-i\b/.test(v) ||
    /\bnc\b[^\n]*-e\s+\/(?:bin|usr\/bin)\/sh\b/.test(v),
};

/** PowerShell download cradles (download + execute APIs used together). */
const POWERSHELL_CRADLE: GuardRule = {
  id: 'powershell-cradle',
  test: (v) => {
    const lower = v.toLowerCase();
    const downloads =
      /(?:downloadstring|downloadfile|invoke-webrequest\s*\(|invoke-restmethod\s*\(|\biwr\b|\birm\b)/.test(
        lower,
      );
    const executes = /(?:iex|invoke-expression)\s*[.(]/.test(lower);
    return downloads && executes;
  },
};

/**
 * Cloud instance metadata service targets (AWS / GCP / Azure / Alibaba /
 * Oracle / DigitalOcean / OpenStack), in dotted, decimal or hex form for the
 * AWS IMDS address. The IMDS hostnames are not routable on any ordinary
 * network, so a match is always an SSRF attempt.
 */
const CLOUD_METADATA_URL: GuardRule = {
  id: 'cloud-metadata-url',
  test: (v) =>
    /https?:\/\/(?:169\.254\.169\.254|2852039166|0xa9fea9fe)(?::\d+)?\//.test(v) ||
    /https?:\/\/(?:metadata\.google\.internal|169\.254\.169\.254\.metadata\.azure\.com|100\.100\.100\.200)\//.test(
      v,
    ),
};

/** Well-known cloud credential / IMDS token paths or hostnames. */
const CLOUD_CREDENTIAL_PATH: GuardRule = {
  id: 'cloud-credential-path',
  test: (v) =>
    /\/latest\/(?:meta-data|api\/token)/.test(v) ||
    /\/computeMetadata\/v1\//.test(v) ||
    /\/metadata\/instance\//.test(v) ||
    /(?:metadata\.aliyuninc\.com|169\.254\.170\.2)\//.test(v),
};

const RULES: readonly GuardRule[] = [
  COMMAND_EXPANSION,
  SHELL_CHAINING,
  DOWNLOADER_PIPE,
  SENSITIVE_FILE_READ,
  FORCE_DELETE_ROOT,
  REVERSE_SHELL,
  POWERSHELL_CRADLE,
  CLOUD_METADATA_URL,
  CLOUD_CREDENTIAL_PATH,
];

/**
 * Cap on total argument text inspected per call. Deep or oversized payloads
 * stop being scanned at this boundary, which keeps a single call from doing
 * unbounded work. Dangerous payloads reachable by an attacker are far below
 * this size.
 */
const MAX_SCAN_BYTES = 1_000_000;

export interface InspectToolArgumentsResult {
  blocked: boolean;
  /** Present when blocked; stable identifier of the rule that fired. */
  ruleId?: string;
}

/**
 * Inspect tool call arguments for high-confidence dangerous payloads.
 *
 * Every string value reachable from the arguments object (including arrays
 * and nested objects) is checked. Non-string values are ignored.
 *
 * @returns `{ blocked: false }` when nothing matched, otherwise the id of
 *          the first matching rule.
 */
export const inspectToolArguments = (args: unknown): InspectToolArgumentsResult => {
  let budget = MAX_SCAN_BYTES;

  const scan = (node: unknown): string | undefined => {
    if (typeof node === 'string') {
      if (node.length > budget) {
        const slice = node.slice(0, budget);
        budget = 0;
        for (const rule of RULES) {
          if (rule.test(slice)) return rule.id;
        }
        return undefined;
      }
      budget -= node.length;
      for (const rule of RULES) {
        if (rule.test(node)) return rule.id;
      }
      return undefined;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = scan(item);
        if (hit) return hit;
      }
      return undefined;
    }
    if (node !== null && typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) {
        const hit = scan(value);
        if (hit) return hit;
      }
    }
    return undefined;
  };

  const ruleId = scan(args);
  return ruleId ? { blocked: true, ruleId } : { blocked: false };
};

/**
 * Assert that tool call arguments are safe. Throws {@link ToolCallBlockedError}
 * (fail-closed) when a high-confidence dangerous pattern is present.
 */
export const assertToolCallArgumentsSafe = (
  args: unknown,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  if (!isToolCallGuardEnabled(env)) return;
  const result = inspectToolArguments(args);
  if (result.blocked && result.ruleId) {
    throw new ToolCallBlockedError(
      `Blocked by tool call guard: tool call arguments matched rule '${result.ruleId}'`,
      result.ruleId,
    );
  }
};
