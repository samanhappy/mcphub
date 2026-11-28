/**
 * Configuration, limits, error taxonomy, and runner abstraction for Smart Routing Code Mode.
 */

export interface SmartRoutingCodeModeConfig {
  /** Master opt-in switch (off by default). */
  enabled?: boolean;
  /** Expose `execute_code_read` alongside `execute_code` (default: true when codeMode is enabled). */
  readOnlyVariantEnabled?: boolean;
  /** Wall-clock timeout for a full script execution including upstream tool waits (ms). */
  timeoutMs?: number;
  /** Synchronous JavaScript CPU execution budget inside the sandbox (ms). */
  cpuTimeoutMs?: number;
  /** QuickJS heap memory cap (MB). */
  memoryLimitMb?: number;
  /** Maximum number of `tools.call` + `tools.search` invocations per run. */
  maxToolCalls?: number;
  /** Maximum script source size (bytes). */
  maxSourceBytes?: number;
  /** Maximum captured console log size (bytes). */
  maxLogBytes?: number;
  /** Maximum raw byte size of a single intermediate upstream tool result passed into the sandbox. */
  maxToolResultBytes?: number;
  /** Maximum serialized final return value size (bytes). */
  maxOutputBytes?: number;
  /** Maximum number of concurrent sandbox executions per MCPHub instance. */
  maxConcurrentRuns?: number;
}

export type ResolvedCodeModeConfig = Required<SmartRoutingCodeModeConfig>;

export const DEFAULT_CODE_MODE_CONFIG: ResolvedCodeModeConfig = {
  enabled: false,
  readOnlyVariantEnabled: true,
  timeoutMs: 30_000,
  cpuTimeoutMs: 5_000,
  memoryLimitMb: 32,
  maxToolCalls: 20,
  maxSourceBytes: 32_768,
  maxLogBytes: 16_384,
  maxToolResultBytes: 524_288,
  maxOutputBytes: 65_536,
  maxConcurrentRuns: 4,
};

export const CODE_MODE_LIMIT_BOUNDS = {
  timeoutMs: { min: 500, max: 120_000 },
  cpuTimeoutMs: { min: 100, max: 30_000 },
  memoryLimitMb: { min: 4, max: 256 },
  maxToolCalls: { min: 1, max: 100 },
  maxSourceBytes: { min: 256, max: 262_144 },
  maxLogBytes: { min: 256, max: 131_072 },
  maxToolResultBytes: { min: 4_096, max: 4_194_304 },
  maxOutputBytes: { min: 1_024, max: 1_048_576 },
  maxConcurrentRuns: { min: 1, max: 32 },
} as const;

export type CodeModeNumericField = keyof typeof CODE_MODE_LIMIT_BOUNDS;

export const parseCodeModeInteger = (
  value: unknown,
  field: CodeModeNumericField,
): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed)) {
    return undefined;
  }
  const { min, max } = CODE_MODE_LIMIT_BOUNDS[field];
  if (parsed < min || parsed > max) {
    return undefined;
  }
  return parsed;
};

export const normalizeCodeModeConfig = (
  config?: SmartRoutingCodeModeConfig,
): ResolvedCodeModeConfig => ({
  enabled: config?.enabled === true,
  readOnlyVariantEnabled: config?.readOnlyVariantEnabled ?? DEFAULT_CODE_MODE_CONFIG.readOnlyVariantEnabled,
  timeoutMs: parseCodeModeInteger(config?.timeoutMs, 'timeoutMs') ?? DEFAULT_CODE_MODE_CONFIG.timeoutMs,
  cpuTimeoutMs:
    parseCodeModeInteger(config?.cpuTimeoutMs, 'cpuTimeoutMs') ?? DEFAULT_CODE_MODE_CONFIG.cpuTimeoutMs,
  memoryLimitMb:
    parseCodeModeInteger(config?.memoryLimitMb, 'memoryLimitMb') ??
    DEFAULT_CODE_MODE_CONFIG.memoryLimitMb,
  maxToolCalls:
    parseCodeModeInteger(config?.maxToolCalls, 'maxToolCalls') ?? DEFAULT_CODE_MODE_CONFIG.maxToolCalls,
  maxSourceBytes:
    parseCodeModeInteger(config?.maxSourceBytes, 'maxSourceBytes') ??
    DEFAULT_CODE_MODE_CONFIG.maxSourceBytes,
  maxLogBytes:
    parseCodeModeInteger(config?.maxLogBytes, 'maxLogBytes') ?? DEFAULT_CODE_MODE_CONFIG.maxLogBytes,
  maxToolResultBytes:
    parseCodeModeInteger(config?.maxToolResultBytes, 'maxToolResultBytes') ??
    DEFAULT_CODE_MODE_CONFIG.maxToolResultBytes,
  maxOutputBytes:
    parseCodeModeInteger(config?.maxOutputBytes, 'maxOutputBytes') ??
    DEFAULT_CODE_MODE_CONFIG.maxOutputBytes,
  maxConcurrentRuns:
    parseCodeModeInteger(config?.maxConcurrentRuns, 'maxConcurrentRuns') ??
    DEFAULT_CODE_MODE_CONFIG.maxConcurrentRuns,
});

export type CodeSandboxErrorKind =
  | 'syntax_error'
  | 'runtime_error'
  | 'timeout'
  | 'cpu_timeout'
  | 'memory_limit'
  | 'call_budget_exceeded'
  | 'source_too_large'
  | 'output_too_large'
  | 'tool_result_too_large'
  | 'concurrency_limit'
  | 'unauthorized'
  | 'readonly_violation'
  | 'elicitation_unsupported'
  | 'disabled';

export class CodeSandboxError extends Error {
  public readonly kind: CodeSandboxErrorKind;

  constructor(kind: CodeSandboxErrorKind, message: string) {
    super(message);
    this.name = 'CodeSandboxError';
    this.kind = kind;
  }
}

export interface CodeModeToolCallSummary {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface CodeSandboxBridge {
  search(query: string, options?: { limit?: number }): Promise<unknown>;
  call(toolName: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface CodeSandboxRunRequest {
  code: string;
  limits: Pick<
    ResolvedCodeModeConfig,
    | 'timeoutMs'
    | 'cpuTimeoutMs'
    | 'memoryLimitMb'
    | 'maxSourceBytes'
    | 'maxLogBytes'
    | 'maxOutputBytes'
    | 'maxConcurrentRuns'
  >;
  bridge: CodeSandboxBridge;
}

export interface CodeSandboxRunResult {
  value: unknown;
  logs: string[];
  truncatedLogs: boolean;
}

export interface CodeSandboxRunner {
  run(request: CodeSandboxRunRequest): Promise<CodeSandboxRunResult>;
}

export interface CodeModeExecutionResponse {
  value: unknown;
  logs: string[];
  truncatedLogs?: boolean;
  toolCalls: CodeModeToolCallSummary[];
}
