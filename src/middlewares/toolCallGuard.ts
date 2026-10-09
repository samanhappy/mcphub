/**
 * Opt-in pre-call guard for `tools/call` requests.
 *
 * When enabled, tool call arguments are inspected for a small set of
 * high-confidence dangerous payloads — shell command injection/RCE and
 * cloud instance-metadata (SSRF / credential-hijack) targets — and a
 * matching call is blocked before it reaches the upstream MCP server
 * (fail-closed).
 *
 * Rules are split into two tiers:
 * - **Always-on** rules detect payloads that are dangerous in any field,
 *   not only an executable one: cloud instance-metadata endpoints and
 *   credential paths (SSRF / credential hijack). These are checked on
 *   every string value.
 * - **Execution** rules detect shell/RCE content (chaining, command
 *   substitution, download-and-execute, sensitive-file reads, destructive
 *   deletion, reverse shells, PowerShell cradles). Because shell-like text
 *   and punctuation routinely appear inside ordinary prose, documentation
 *   and messaging arguments, these rules are applied only to values held
 *   in fields explicitly named to carry executable content
 *   (`command`, `cmd`, `script`, `run`, … — see {@link EXECUTION_KEYS}).
 *
 * Every pattern is a high-confidence indicator of an attack and every
 * inspection is linear in the size of its input (no catastrophic
 * backtracking). No network access and no third-party dependencies are
 * required.
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

/**
 * Selects which arguments carry executable content and are therefore
 * inspected under the execution-tier rules.
 */
type RuleScope = 'always' | 'execution';

interface GuardRule {
  id: string;
  /** When the rule applies. */
  scope: RuleScope;
  /** Returns true when the rule's dangerous pattern is present in the string. */
  test: (value: string) => boolean;
}

/**
 * Normalised names of object keys whose values hold executable content.
 * A key matches when its lower-cased name, after removing `_`, `-` and
 * spaces, is one of these tokens, or ends with one of the suffixes in
 * {@link EXECUTION_KEY_SUFFIXES}.
 */
const EXECUTION_KEYS: ReadonlySet<string> = new Set([
  'command',
  'cmd',
  'cmds',
  'script',
  'exec',
  'execute',
  'shell',
  'run',
  'code',
  'statement',
  'expression',
]);

/** Normalised key suffixes that indicate executable content. */
const EXECUTION_KEY_SUFFIXES: readonly string[] = ['command', 'commands', 'script'];

/** Returns true when an object key is explicitly named to carry a command. */
const isExecutionKey = (key: string): boolean => {
  const normalised = key.toLowerCase().replace(/[_\-\s]/g, '');
  if (EXECUTION_KEYS.has(normalised)) return true;
  return EXECUTION_KEY_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
};

/**
 * Command substitution / execution expansions. These forms execute the
 * embedded command whenever a shell interprets the value, so they are a
 * direct RCE indicator.
 *
 * `$( ... )` is matched directly. Backtick pairs are inspected with a
 * linear scan rather than a single regex, because a single opening
 * backtick followed by a long run of non-backtick characters made the old
 * backtick expression retry across the whole string.
 */
const COMMAND_EXPANSION: GuardRule = {
  id: 'command-expansion',
  scope: 'execution',
  test: (v) => /\$\([^)]/.test(v) || backtickSpanContains(v, SHELL_SYNTAX_CHARS),
};

/** Matches characters that indicate the content of a backtick span is shell syntax. */
const SHELL_SYNTAX_CHARS = /[;&|$/]/;

/**
 * Linear scan for backtick-delimited spans that contain shell syntax or a
 * known command. Each character is visited once; there is no backtracking.
 */
const backtickSpanContains = (value: string, syntax: RegExp): boolean => {
  let open = -1;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== '`') continue;
    if (open === -1) {
      open = i;
    } else {
      const span = value.slice(open + 1, i);
      if (syntax.test(span) || COMMAND_IN_BACKTICK.test(span)) return true;
      open = -1;
    }
  }
  return false;
};

/** A backtick span that runs a known command with an argument. */
const COMMAND_IN_BACKTICK =
  /^\s*(?:sudo\s+)?(?:cat|ls|id|whoami|uname|wget|curl|bash|sh|nc|python|perl|ruby|chmod|chown|rm|cp|mv)\s+\S/;

/**
 * Classic shell metacharacter chaining (`;`, `&&`, `||`) immediately
 * followed by a command name. Requires a following command token so prose
 * and ordinary punctuation do not match.
 */
const SHELL_CHAINING: GuardRule = {
  id: 'shell-chaining',
  scope: 'execution',
  test: (v) =>
    /(?:;|&&|\|\|)\s*(?:sudo\s+)?(?:cat|ls|id|whoami|uname|wget|curl|bash|sh|nc|python|perl|ruby|chmod|chown|rm|cp|mv)\b/.test(
      v,
    ),
};

/**
 * Download-and-execute pattern, e.g. `curl http://... | sh` or
 * `wget -O- ... | bash`, including the `sh -c "$(curl ...)"` form.
 *
 * The piped form is detected with a linear scan: the line is split at each
 * pipe and a single pass records whether a downloader appeared before the
 * pipe and whether a shell follows it. The previous expression used
 * `curl/wget` followed by `[^|\n]*` running to the terminator, so a string
 * of repeated command words (`'curl '.repeat(40000)`) made the engine retry
 * from each word and produced quadratic time. The shell is not required to
 * sit at the end of the line: real invocations pass arguments (`sh -s`) or
 * append comments (`sh # install`), and this rule is execution-scoped so
 * downloaders merely quoted in prose are not matched.
 */
const DOWNLOADER_PIPE: GuardRule = {
  id: 'downloader-pipe',
  scope: 'execution',
  test: (v) => {
    if (SH_C_CURL.test(v)) return true;
    for (const line of v.split('\n')) {
      if (hasDownloaderPipedToShell(line)) return true;
    }
    return false;
  },
};

/** The `sh -c "$(curl ...)"` download-and-execute form. */
const SH_C_CURL = /(?:ba|z|fi|k|t?c)?sh\s+-c\s+["']?\$\((?:curl|wget)\b/;

/** A shell command name (bash/sh/zsh/fish/ksh/tcsh). */
const SHELL_AFTER_PIPE = /^(?:sudo\s+)?(?:ba|z|fi|k|t?c)?sh\b/;

/** A downloader command name. */
const DOWNLOADER_IN_SEGMENT = /\b(?:curl|wget)\b/;

/**
 * Linear detection of `downloader ... | shell` within one line. The line is
 * split at pipes and visited once; every segment is inspected with a
 * bounded regex that does not run to an end-of-line terminator.
 */
const hasDownloaderPipedToShell = (line: string): boolean => {
  let downloaderSeen = false;
  for (const segment of line.split('|')) {
    if (SHELL_AFTER_PIPE.test(segment.trimStart()) && downloaderSeen) return true;
    if (DOWNLOADER_IN_SEGMENT.test(segment)) downloaderSeen = true;
  }
  return false;
};

/**
 * Reading sensitive account files through a shell command, including their
 * use inside command substitution. `passwd` alone is harmless (it contains
 * only public account names), so a reader command must precede it; `shadow`
 * is sensitive regardless.
 *
 * Detected with a linear token scan: the line is split on whitespace and
 * visited once, recording whether a reader command appeared before the
 * `/etc/passwd` token. The previous expression used a reader word followed
 * by `[^\n]*` running to the path, so repeated command words
 * (`'cat '.repeat(50000)`) caused quadratic retries.
 */
const SENSITIVE_FILE_READ: GuardRule = {
  id: 'sensitive-file-read',
  scope: 'execution',
  test: (v) => {
    for (const line of v.split('\n')) {
      if (SHADOW_PATH.test(line)) return true;
      if (hasReaderThenPasswd(line)) return true;
    }
    return false;
  },
};

/** A reference to `/etc/shadow`; sensitive even without an explicit reader. */
const SHADOW_PATH = /\/etc\/shadow(?![\w.-])/;

/** A `/etc/passwd` token at the end of a whitespace-delimited word. */
const PASSWD_TOKEN = /\/etc\/passwd(?![\w.-])$/;

/** A command that reads a file. */
const FILE_READER_WORD = /^(?:cat|head|tail|less|more|tac|nl|od|xxd|cp|mv|grep|open)$/;

/**
 * Linear detection of a reader command followed later by `/etc/passwd`
 * within one line. Tokens are visited once; a reader seen earlier is
 * remembered when the path token is reached.
 */
const hasReaderThenPasswd = (line: string): boolean => {
  let readerSeen = false;
  for (const token of line.split(/\s+/)) {
    if (PASSWD_TOKEN.test(token) && readerSeen) return true;
    if (FILE_READER_WORD.test(token)) readerSeen = true;
  }
  return false;
};

/**
 * Forced recursive deletion of a system/home root.
 *
 * Implemented as a linear per-line scan instead of a single regex. The
 * original combined three greedy `[^\n]*` segments in one expression, and
 * even the intermediate `/-[^\s]*[rf]/` flag check retried from each dash,
 * so long runs of dashes (e.g. `rm ` + `'-'.repeat(100000)) produced
 * catastrophic backtracking. The checks below run independently on each
 * line, inspecting only whitespace-delimited flag tokens, so the total work
 * is O(n) with no backtracking across segments.
 */
const FORCE_DELETE_ROOT: GuardRule = {
  id: 'force-delete-root',
  scope: 'execution',
  test: (v) => {
    for (const line of v.split('\n')) {
      if (!/\brm\b/.test(line)) continue;
      if (!hasRecursiveForceFlag(line)) continue;
      if (/(?:--no-preserve-root\b)?\s\/(?:\s|$|\*)/.test(line)) return true;
    }
    return false;
  },
};

/**
 * Returns true when the line carries a recursive flag (a single-dash flag
 * token containing `r`), or `--no-preserve-root`. Recursive deletion of the
 * root target is dangerous with `-r` alone, so `-f` is not required. Only
 * whitespace-delimited tokens are inspected, so a run of dashes that never
 * forms such a token is visited once and rejected.
 */
const hasRecursiveForceFlag = (line: string): boolean => {
  if (line.includes('--no-preserve-root')) return true;
  for (const token of line.split(/\s+/)) {
    if (token.length < 2 || token[0] !== '-' || token[1] === '-') continue;
    if (token.slice(1).includes('r')) return true;
  }
  return false;
};

/** Reverse-shell starters. */
const REVERSE_SHELL: GuardRule = {
  id: 'reverse-shell',
  scope: 'execution',
  test: (v) =>
    /\/dev\/tcp\/\S+\/\d+/.test(v) ||
    /bash\s+-i\b/.test(v) ||
    /\bnc\b[^\n]*-e\s+\/(?:bin|usr\/bin)\/sh\b/.test(v),
};

/** PowerShell download cradles (download + execute APIs used together). */
const POWERSHELL_CRADLE: GuardRule = {
  id: 'powershell-cradle',
  scope: 'execution',
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
 * network, so a match is always an SSRF attempt regardless of the field it
 * appears in.
 */
const CLOUD_METADATA_URL: GuardRule = {
  id: 'cloud-metadata-url',
  scope: 'always',
  test: (v) =>
    /https?:\/\/(?:169\.254\.169\.254|2852039166|0xa9fea9fe)(?::\d+)?\//.test(v) ||
    /https?:\/\/(?:metadata\.google\.internal|169\.254\.169\.254\.metadata\.azure\.com|100\.100\.100\.200)\//.test(
      v,
    ),
};

/** Well-known cloud credential / IMDS token paths or hostnames. */
const CLOUD_CREDENTIAL_PATH: GuardRule = {
  id: 'cloud-credential-path',
  scope: 'always',
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
 * Cap on total argument text inspected per call. When a single call contains
 * more text than this, it cannot be fully inspected and the guard blocks the
 * call (fail-closed) rather than treating the unexamined portion as safe.
 * This keeps a single call from doing unbounded work while preventing an
 * attacker from padding a payload past the budget to smuggle a command.
 */
const MAX_SCAN_BYTES = 1_000_000;

/**
 * Rule id reported when a call contains more text than the scan budget and
 * therefore cannot be fully inspected.
 */
const SCAN_LIMIT_RULE_ID = 'scan-limit-exceeded';

export interface InspectToolArgumentsResult {
  blocked: boolean;
  /** Present when blocked; stable identifier of the rule that fired. */
  ruleId?: string;
}

/**
 * Inspect tool call arguments for high-confidence dangerous payloads.
 *
 * Every string value reachable from the arguments object (including arrays
 * and nested objects) is checked. Strings inside a field whose key is named
 * for executable content (and everything nested beneath it) are also
 * checked against the execution-tier rules; other strings are checked only
 * against the always-on (SSRF/credential) rules. Non-string values are
 * ignored.
 *
 * @returns `{ blocked: false }` when nothing matched, otherwise the id of
 *          the first matching rule.
 */
export const inspectToolArguments = (args: unknown): InspectToolArgumentsResult => {
  let budget = MAX_SCAN_BYTES;

  const scan = (node: unknown, execution: boolean): string | undefined => {
    if (typeof node === 'string') {
      // Fail closed: if this string cannot be fully inspected within the
      // remaining budget, block the call instead of silently passing the
      // unexamined content through.
      if (node.length > budget) return SCAN_LIMIT_RULE_ID;
      budget -= node.length;
      for (const rule of RULES) {
        if (rule.scope === 'execution' && !execution) continue;
        if (rule.test(node)) return rule.id;
      }
      return undefined;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = scan(item, execution);
        if (hit) return hit;
      }
      return undefined;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        // A command-named field puts its whole subtree into execution scope;
        // other fields keep the scope inherited from their parent.
        const hit = scan(value, execution || isExecutionKey(key));
        if (hit) return hit;
      }
    }
    return undefined;
  };

  // A top-level bare string is not a named execution field, so only the
  // always-on rules apply to it. (In MCP, tool call arguments are an object;
  // bare-string inputs exist mainly for testing.)
  const ruleId = scan(args, false);
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
