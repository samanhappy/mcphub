/**
 * Code Mode orchestration service for Smart Routing ($smart and $smart/<group>).
 *
 * Bridges sandboxed JS (`execute_code` / `execute_code_read`) to MCPHub's existing
 * `search_tools` and `call_tool` dispatch paths without introducing a new permission surface.
 */

import type { Tool } from '../../types/index.js';
import { getSmartRoutingConfig } from '../../utils/smartRouting.js';
import { maybeCompressToolResult } from '../toolResultCompressionService.js';
import { isReservedStagingName } from '../fileStaging/tools.js';
import { getDefaultCodeSandboxRunner } from './quickjsWorkerRunner.js';
import {
  CodeSandboxError,
  normalizeCodeModeConfig,
  type CodeModeExecutionResponse,
  type CodeModeToolCallSummary,
  type CodeSandboxRunner,
  type ResolvedCodeModeConfig,
} from './types.js';

export const CODE_MODE_TOOL_NAMES = new Set(['execute_code', 'execute_code_read']);

const RESERVED_META_TOOL_NAMES = new Set([
  'search_tools',
  'describe_tool',
  'call_tool',
  'execute_code',
  'execute_code_read',
]);

/**
 * MCP-spec-aligned read-only check:
 * Requires an explicit `readOnlyHint: true` and must not explicitly mark `destructiveHint: true`.
 * Note: MCP tool annotations are self-declared advisory hints from upstream servers.
 */
export const isToolReadOnly = (tool: Pick<Tool, 'annotations'> | undefined): boolean => {
  const annotations = tool?.annotations;
  if (!annotations || typeof annotations !== 'object') {
    return false;
  }
  return annotations.readOnlyHint === true && annotations.destructiveHint !== true;
};

/**
 * Unwrap an MCP `CallToolResult` for ergonomic consumption inside a code-mode script:
 * - `isError: true` throws an Error with the error text.
 * - `structuredContent` is returned directly when present.
 * - A single text content block is JSON-parsed when valid JSON, else returned as a string.
 * - Mixed or binary content is returned as the raw `CallToolResult`.
 */
export const unwrapToolCallResult = (result: any): unknown => {
  if (!result || typeof result !== 'object') {
    return result;
  }

  if (result.isError === true) {
    const errorText = Array.isArray(result.content)
      ? result.content
          .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
          .map((block: any) => block.text)
          .join('\n')
      : '';
    throw new Error(errorText || 'Upstream tool returned an error');
  }

  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  if (
    Array.isArray(result.content) &&
    result.content.length === 1 &&
    result.content[0]?.type === 'text' &&
    typeof result.content[0].text === 'string'
  ) {
    const text = result.content[0].text;
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return text;
      }
    }
    return text;
  }

  return result;
};

const assertResultWithinBytes = (value: unknown, maxBytes: number, toolName: string): void => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }
  if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new CodeSandboxError(
      'tool_result_too_large',
      `Result from tool '${toolName}' exceeded the ${maxBytes}-byte intermediate limit`,
    );
  }
};

export const buildCodeModeMetaTools = (
  config: ResolvedCodeModeConfig,
  scopeDescription: string,
  serversList: string,
): any[] => {
  if (!config.enabled) {
    return [];
  }

  const codeSchema = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'Async JavaScript function body. Use `await tools.search(query, { limit })`, `await tools.call(toolName, args)`, `console.log(...)`, and `return value;`.',
      },
    },
    required: ['code'],
  };

  const tools: any[] = [
    {
      name: 'execute_code',
      description: `Run an async JavaScript function body in an isolated sandbox to orchestrate multiple tool calls across ${scopeDescription} in a single turn.

Available sandbox API:
- await tools.search(query, { limit? }) — semantic search for tools in your scope
- await tools.call(toolName, args?) — invoke any authorized tool in your scope (returns unwrapped JSON/structuredContent or throws on isError)
- console.log / info / warn / error — captured and returned alongside your return value

Limits: ${config.timeoutMs}ms timeout, ${config.cpuTimeoutMs}ms JS CPU, ${config.memoryLimitMb}MB memory, max ${config.maxToolCalls} tool calls. No network, filesystem, or process access.

Available servers: ${serversList}`,
      inputSchema: codeSchema,
      annotations: {
        title: 'Execute Code',
        openWorldHint: true,
      },
    },
  ];

  if (config.readOnlyVariantEnabled) {
    tools.push({
      name: 'execute_code_read',
      description: `Read-only variant of execute_code for ${scopeDescription}. Runs an async JavaScript function body in the same isolated sandbox, but tools.call() is restricted to tools whose descriptors declare readOnlyHint: true (and not destructiveHint: true).

Note: read-only annotations are advisory hints declared by upstream servers.

Available servers: ${serversList}`,
      inputSchema: codeSchema,
      annotations: {
        title: 'Execute Code (Read-Only)',
        readOnlyHint: true,
        destructiveHint: false,
      },
    });
  }

  return tools;
};

export interface ExecuteCodeDependencies {
  searchTools: (query: string, limit: number) => Promise<any>;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<any>;
  resolveToolMetadata: (toolName: string) => Promise<Tool | undefined>;
  group?: string;
  runner?: CodeSandboxRunner;
}

export const handleExecuteCodeRequest = async (
  params: { code?: unknown; readOnly: boolean },
  deps: ExecuteCodeDependencies,
): Promise<any> => {
  const smartRoutingConfig = await getSmartRoutingConfig();
  const codeMode = normalizeCodeModeConfig(smartRoutingConfig.codeMode);

  if (!codeMode.enabled) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: {
              kind: 'disabled',
              message: 'Smart Routing Code Mode is not enabled on this server.',
            },
          }),
        },
      ],
    };
  }

  if (params.readOnly && !codeMode.readOnlyVariantEnabled) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: {
              kind: 'disabled',
              message: 'execute_code_read is disabled on this server.',
            },
          }),
        },
      ],
    };
  }

  if (typeof params.code !== 'string' || params.code.trim().length === 0) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: {
              kind: 'syntax_error',
              message: 'code parameter is required and must be a non-empty string.',
            },
          }),
        },
      ],
    };
  }

  const toolCalls: CodeModeToolCallSummary[] = [];
  let totalCalls = 0;

  const consumeBudget = () => {
    totalCalls += 1;
    if (totalCalls > codeMode.maxToolCalls) {
      throw new CodeSandboxError(
        'call_budget_exceeded',
        `Exceeded maximum tool calls per run (${codeMode.maxToolCalls})`,
      );
    }
  };

  const runner = deps.runner ?? getDefaultCodeSandboxRunner();

  try {
    const result = await runner.run({
      code: params.code,
      limits: {
        timeoutMs: codeMode.timeoutMs,
        cpuTimeoutMs: codeMode.cpuTimeoutMs,
        memoryLimitMb: codeMode.memoryLimitMb,
        maxSourceBytes: codeMode.maxSourceBytes,
        maxLogBytes: codeMode.maxLogBytes,
        maxOutputBytes: codeMode.maxOutputBytes,
        maxConcurrentRuns: codeMode.maxConcurrentRuns,
      },
      bridge: {
        search: async (query: string, options?: { limit?: number }) => {
          consumeBudget();
          if (typeof query !== 'string' || query.trim().length === 0) {
            throw new Error('tools.search requires a non-empty query string');
          }
          const limit =
            typeof options?.limit === 'number' && Number.isFinite(options.limit)
              ? options.limit
              : 10;
          const startedAt = Date.now();
          try {
            const raw = await deps.searchTools(query, limit);
            const unwrapped = unwrapToolCallResult(raw);
            assertResultWithinBytes(unwrapped, codeMode.maxToolResultBytes, 'search_tools');
            toolCalls.push({
              name: 'search_tools',
              ok: true,
              durationMs: Date.now() - startedAt,
            });
            return unwrapped;
          } catch (error) {
            toolCalls.push({
              name: 'search_tools',
              ok: false,
              durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        call: async (toolName: string, args?: Record<string, unknown>) => {
          consumeBudget();
          if (typeof toolName !== 'string' || toolName.trim().length === 0) {
            throw new Error('tools.call requires a non-empty toolName string');
          }
          if (isReservedStagingName(toolName) || RESERVED_META_TOOL_NAMES.has(toolName)) {
            throw new CodeSandboxError(
              'unauthorized',
              `Hub built-in tool '${toolName}' cannot be called from code mode`,
            );
          }

          const startedAt = Date.now();
          try {
            if (params.readOnly) {
              const tool = await deps.resolveToolMetadata(toolName);
              if (tool && !isToolReadOnly(tool)) {
                throw new CodeSandboxError(
                  'readonly_violation',
                  `Tool '${toolName}' is not permitted in execute_code_read (requires readOnlyHint: true and destructiveHint !== true)`,
                );
              }
            }

            const raw = await deps.callTool(toolName, args ?? {});
            const unwrapped = unwrapToolCallResult(raw);
            assertResultWithinBytes(unwrapped, codeMode.maxToolResultBytes, toolName);
            toolCalls.push({
              name: toolName,
              ok: true,
              durationMs: Date.now() - startedAt,
            });
            return unwrapped;
          } catch (error) {
            toolCalls.push({
              name: toolName,
              ok: false,
              durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      },
    });

    const payload: CodeModeExecutionResponse = {
      value: result.value,
      logs: result.logs,
      ...(result.truncatedLogs ? { truncatedLogs: true } : {}),
      toolCalls,
    };

    return await maybeCompressToolResult(
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload),
          },
        ],
      },
      {
        serverName: 'mcphub',
        toolName: params.readOnly ? 'execute_code_read' : 'execute_code',
        group: deps.group,
      },
    );
  } catch (error) {
    const kind = error instanceof CodeSandboxError ? error.kind : 'runtime_error';
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: { kind, message },
            toolCalls,
          }),
        },
      ],
    };
  }
};
