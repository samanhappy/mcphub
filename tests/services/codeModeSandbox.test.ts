import { QuickJsWorkerSandboxRunner } from '../../src/services/codeMode/quickjsWorkerRunner.js';
import {
  isToolReadOnly,
  unwrapToolCallResult,
} from '../../src/services/codeMode/codeModeService.js';
import { generateToolTypeScriptSignature } from '../../src/services/codeMode/tsSignature.js';
import {
  CodeSandboxError,
  DEFAULT_CODE_MODE_CONFIG,
  type CodeSandboxBridge,
} from '../../src/services/codeMode/types.js';

const baseLimits = {
  timeoutMs: 10_000,
  cpuTimeoutMs: 2_000,
  memoryLimitMb: 32,
  maxSourceBytes: DEFAULT_CODE_MODE_CONFIG.maxSourceBytes,
  maxLogBytes: 1_024,
  maxOutputBytes: 4_096,
  maxConcurrentRuns: 2,
};

const noopBridge: CodeSandboxBridge = {
  search: async () => [],
  call: async () => ({}),
};

describe('QuickJsWorkerSandboxRunner', () => {
  const runner = new QuickJsWorkerSandboxRunner();

  it('executes async JS, bridges tools.search and tools.call, and captures logs', async () => {
    const seenCalls: Array<{ name: string; args: unknown }> = [];
    const bridge: CodeSandboxBridge = {
      search: async (query, options) => ({
        tools: [{ name: 'github-list_prs', query, limit: options?.limit ?? 10 }],
      }),
      call: async (name, args) => {
        seenCalls.push({ name, args });
        if (name === 'github-list_prs') {
          return [
            { number: 1, title: 'Fix A', sha: 'aaa' },
            { number: 2, title: 'Fix B', sha: 'bbb' },
          ];
        }
        if (name === 'github-status') {
          return { state: (args as any)?.sha === 'bbb' ? 'failure' : 'success' };
        }
        throw new Error(`Unknown tool: ${name}`);
      },
    };

    const result = await runner.run({
      code: `
        const hits = await tools.search("pull requests", { limit: 3 });
        const prs = await tools.call("github-list_prs", { state: "open" });
        const failing = [];
        for (const pr of prs) {
          const st = await tools.call("github-status", { sha: pr.sha });
          if (st.state === "failure") failing.push({ number: pr.number, title: pr.title });
        }
        console.log("hits", hits.tools.length);
        console.warn("failing", failing.length);
        return failing;
      `,
      limits: baseLimits,
      bridge,
    });

    expect(result.value).toEqual([{ number: 2, title: 'Fix B' }]);
    expect(result.logs).toEqual(['hits 1', '[warn] failing 1']);
    expect(result.truncatedLogs).toBe(false);
    expect(seenCalls).toHaveLength(3);
  });

  it('exposes zero ambient Node/Web capabilities and freezes tools/console', async () => {
    const result = await runner.run({
      code: `
        let mutated = false;
        try { tools.call = () => "hacked"; } catch {}
        mutated = typeof tools.call !== "function" || tools.call.toString().includes("hacked");
        return {
          hasFetch: typeof fetch !== "undefined",
          hasProcess: typeof process !== "undefined",
          hasRequire: typeof require !== "undefined",
          hasBuffer: typeof Buffer !== "undefined",
          hasSetTimeout: typeof setTimeout !== "undefined",
          hasFs: typeof fs !== "undefined",
          toolsFrozen: Object.isFrozen(tools),
          consoleFrozen: Object.isFrozen(console),
          mutated,
        };
      `,
      limits: baseLimits,
      bridge: noopBridge,
    });

    expect(result.value).toEqual({
      hasFetch: false,
      hasProcess: false,
      hasRequire: false,
      hasBuffer: false,
      hasSetTimeout: false,
      hasFs: false,
      toolsFrozen: true,
      consoleFrozen: true,
      mutated: false,
    });
  });

  it('aborts infinite loops via cpuTimeoutMs without blocking the main event loop', async () => {
    let eventLoopTicks = 0;
    const ticker = setInterval(() => {
      eventLoopTicks += 1;
    }, 20);

    try {
      await expect(
        runner.run({
          code: 'while (true) {}',
          limits: { ...baseLimits, cpuTimeoutMs: 250, timeoutMs: 5_000 },
          bridge: noopBridge,
        }),
      ).rejects.toMatchObject({
        name: 'CodeSandboxError',
        kind: 'cpu_timeout',
      });
      expect(eventLoopTicks).toBeGreaterThan(0);
    } finally {
      clearInterval(ticker);
    }
  });

  it('enforces wall-clock timeoutMs when an upstream call hangs', async () => {
    const hangingBridge: CodeSandboxBridge = {
      search: async () => new Promise(() => {}),
      call: async () => new Promise(() => {}),
    };

    await expect(
      runner.run({
        code: 'return await tools.call("hanging", {});',
        limits: { ...baseLimits, timeoutMs: 500, cpuTimeoutMs: 2_000 },
        bridge: hangingBridge,
      }),
    ).rejects.toMatchObject({
      name: 'CodeSandboxError',
      kind: 'timeout',
    });
  });

  it('enforces memoryLimitMb on excessive allocations', async () => {
    await expect(
      runner.run({
        code: `
          const items = [];
          for (let i = 0; i < 500000; i++) {
            items.push({ i, payload: "item-" + i + "-" + "x".repeat(32) });
          }
          return items.length;
        `,
        limits: { ...baseLimits, memoryLimitMb: 8 },
        bridge: noopBridge,
      }),
    ).rejects.toMatchObject({
      name: 'CodeSandboxError',
      kind: 'memory_limit',
    });
  });

  it('enforces maxSourceBytes, maxOutputBytes, maxLogBytes, and syntax_error', async () => {
    await expect(
      runner.run({
        code: 'a'.repeat(500),
        limits: { ...baseLimits, maxSourceBytes: 256 },
        bridge: noopBridge,
      }),
    ).rejects.toMatchObject({ kind: 'source_too_large' });

    await expect(
      runner.run({
        code: 'return "x".repeat(2048);',
        limits: { ...baseLimits, maxOutputBytes: 1_024 },
        bridge: noopBridge,
      }),
    ).rejects.toMatchObject({ kind: 'output_too_large' });

    await expect(
      runner.run({
        code: 'const = ;',
        limits: baseLimits,
        bridge: noopBridge,
      }),
    ).rejects.toMatchObject({ kind: 'syntax_error' });

    const truncated = await runner.run({
      code: `
        for (let i = 0; i < 50; i++) console.log("line-" + i + "-" + "z".repeat(40));
        return "ok";
      `,
      limits: { ...baseLimits, maxLogBytes: 256 },
      bridge: noopBridge,
    });
    expect(truncated.value).toBe('ok');
    expect(truncated.truncatedLogs).toBe(true);
    expect(truncated.logs.length).toBeLessThan(50);
  });

  it('enforces maxConcurrentRuns', async () => {
    let releaseFirst!: () => void;
    const blockingBridge: CodeSandboxBridge = {
      search: async () => [],
      call: async () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ done: true });
        }),
    };

    const firstRun = runner.run({
      code: 'return await tools.call("wait", {});',
      limits: { ...baseLimits, maxConcurrentRuns: 1 },
      bridge: blockingBridge,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));

    await expect(
      runner.run({
        code: 'return 1;',
        limits: { ...baseLimits, maxConcurrentRuns: 1 },
        bridge: noopBridge,
      }),
    ).rejects.toMatchObject({
      name: 'CodeSandboxError',
      kind: 'concurrency_limit',
    });

    releaseFirst?.();
    const res = await firstRun;
    expect(res.value).toEqual({ done: true });
  });
});

describe('Code Mode helpers', () => {
  it('evaluates isToolReadOnly with MCP-spec semantics', () => {
    expect(isToolReadOnly({ annotations: { readOnlyHint: true } })).toBe(true);
    expect(isToolReadOnly({ annotations: { readOnlyHint: true, destructiveHint: false } })).toBe(
      true,
    );
    expect(isToolReadOnly({ annotations: { readOnlyHint: true, destructiveHint: true } })).toBe(
      false,
    );
    expect(isToolReadOnly({ annotations: { readOnlyHint: false } })).toBe(false);
    expect(isToolReadOnly({ annotations: {} })).toBe(false);
    expect(isToolReadOnly(undefined)).toBe(false);
  });

  it('unwraps MCP CallToolResult values consistently', () => {
    expect(() =>
      unwrapToolCallResult({
        isError: true,
        content: [{ type: 'text', text: 'permission denied' }],
      }),
    ).toThrow('permission denied');

    expect(
      unwrapToolCallResult({
        structuredContent: { ok: true, items: [1, 2] },
        content: [{ type: 'text', text: 'ignored' }],
      }),
    ).toEqual({ ok: true, items: [1, 2] });

    expect(
      unwrapToolCallResult({
        content: [{ type: 'text', text: '{"count":3}' }],
      }),
    ).toEqual({ count: 3 });

    expect(
      unwrapToolCallResult({
        content: [{ type: 'text', text: 'plain text' }],
      }),
    ).toBe('plain text');

    const binary = { content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] };
    expect(unwrapToolCallResult(binary)).toBe(binary);
  });

  it('generates readable TypeScript signatures from JSON Schema', () => {
    const sig = generateToolTypeScriptSignature('github-list_pull_requests', {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed', 'all'] },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['owner', 'repo'],
    });

    expect(sig).toBe(
      'await tools.call("github-list_pull_requests", args: { owner: string; repo: string; state?: "open" | "closed" | "all"; labels?: string[] }): Promise<unknown>',
    );

    const emptySig = generateToolTypeScriptSignature('ping', { type: 'object' });
    expect(emptySig).toBe('await tools.call("ping", args?: Record<string, unknown>): Promise<unknown>');
  });

  it('preserves CodeSandboxError kind', () => {
    const err = new CodeSandboxError('readonly_violation', 'blocked');
    expect(err.kind).toBe('readonly_violation');
    expect(err.message).toBe('blocked');
  });
});
