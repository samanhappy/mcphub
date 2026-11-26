import { jest } from '@jest/globals';

const mockGetSmartRoutingConfig = jest.fn<any>();
const mockMaybeCompressToolResult = jest.fn<any>();
const mockSearchToolsByVector = jest.fn<any>();
const mockGetToolPolicy = jest.fn<any>();
const mockGetServerDao = jest.fn<any>();

jest.mock('../../src/utils/smartRouting.js', () => ({
  getSmartRoutingConfig: (...args: any[]) => mockGetSmartRoutingConfig(...args),
}));

jest.mock('../../src/services/toolResultCompressionService.js', () => ({
  maybeCompressToolResult: (...args: any[]) => mockMaybeCompressToolResult(...args),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: (...args: any[]) => mockSearchToolsByVector(...args),
}));

jest.mock('../../src/services/toolPolicyService.js', () => ({
  getToolPolicy: (...args: any[]) => mockGetToolPolicy(...args),
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: (...args: any[]) => mockGetServerDao(...args),
  getSystemConfigDao: () => ({ get: async () => ({}) }),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: () => ({
    logToolCall: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getGroupServerExposedName: (cfg: any) => cfg?.alias || cfg?.name,
  getServerConfigsInGroup: async () => [],
  getServersInGroup: async () => [],
}));

jest.mock('../../src/services/mcpConnectionLifecycle.js', () => ({
  isStdioServer: () => false,
}));

jest.mock('../../src/utils/mcpRequestGroup.js', () => ({
  getMcpRequestGroup: (extra?: { group?: string }) => extra?.group,
}));

import {
  buildSmartRoutingMetaTools,
  handleDescribeToolRequest,
  initSmartRoutingService,
} from '../../src/services/smartRoutingService.js';
import { handleExecuteCodeRequest } from '../../src/services/codeMode/codeModeService.js';
import { createToolHandlers } from '../../src/services/mcpTools.js';
import { DEFAULT_CODE_MODE_CONFIG } from '../../src/services/codeMode/types.js';

const enabledSmartRoutingConfig = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  dbUrl: 'postgres://localhost/test',
  llmProviderBaseUrl: 'https://api.openai.com/v1',
  llmProviderApiKey: 'test',
  embeddingModel: 'text-embedding-3-small',
  progressiveDisclosure: false,
  codeMode: {
    ...DEFAULT_CODE_MODE_CONFIG,
    enabled: true,
    readOnlyVariantEnabled: true,
    ...overrides,
  },
});

describe('Code Mode smart routing & dispatch integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMaybeCompressToolResult.mockImplementation(async (result: any) => result);
    mockGetToolPolicy.mockResolvedValue({
      active: false,
      groupId: undefined,
      serverId: () => undefined,
      authorize: () => ({ decision: 'allow' }),
      filterTools: (_name: string, tools: any[]) => tools,
    });
    mockGetServerDao.mockReturnValue({
      findById: async () => undefined,
    });
  });

  it('keeps meta-tools unchanged when codeMode is off and exposes execute_code variants when on', () => {
    const offTools = buildSmartRoutingMetaTools('all available servers', 'github', false);
    expect(offTools.map((t) => t.name)).toEqual(['search_tools', 'call_tool']);

    const onBoth = buildSmartRoutingMetaTools('all available servers', 'github', false, undefined, {
      ...DEFAULT_CODE_MODE_CONFIG,
      enabled: true,
      readOnlyVariantEnabled: true,
    });
    expect(onBoth.map((t) => t.name)).toEqual([
      'search_tools',
      'call_tool',
      'execute_code',
      'execute_code_read',
    ]);

    const onWriteOnly = buildSmartRoutingMetaTools(
      'all available servers',
      'github',
      false,
      undefined,
      {
        ...DEFAULT_CODE_MODE_CONFIG,
        enabled: true,
        readOnlyVariantEnabled: false,
      },
    );
    expect(onWriteOnly.map((t) => t.name)).toEqual(['search_tools', 'call_tool', 'execute_code']);
  });

  it('adds typescriptSignature to describe_tool responses', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue(enabledSmartRoutingConfig());
    initSmartRoutingService(
      () => [
        {
          name: 'github',
          status: 'connected',
          enabled: true,
          tools: [
            {
              name: 'github-list_issues',
              description: 'List repository issues',
              inputSchema: {
                type: 'object',
                properties: {
                  owner: { type: 'string' },
                  repo: { type: 'string' },
                },
                required: ['owner', 'repo'],
              },
            },
          ],
        } as any,
      ],
      async (_server, tools) => tools,
      async (_group, _server, tools) => tools,
    );

    const res = await handleDescribeToolRequest('github-list_issues', 'sess-1', '$smart');
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.tool.name).toBe('github-list_issues');
    expect(parsed.tool.typescriptSignature).toContain('await tools.call("github-list_issues"');
    expect(parsed.tool.typescriptSignature).toContain('owner: string; repo: string');
  });

  it('refuses execute_code when disabled and enforces hub built-in, call budget, and read-only rules', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue(enabledSmartRoutingConfig({ enabled: false }));
    const disabledRes = await handleExecuteCodeRequest(
      { code: 'return 1;', readOnly: false },
      {
        searchTools: async () => ({ content: [{ type: 'text', text: '{"tools":[]}' }] }),
        callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
        resolveToolMetadata: async () => undefined,
      },
    );
    expect(disabledRes.isError).toBe(true);
    expect(JSON.parse(disabledRes.content[0].text).error.kind).toBe('disabled');

    // Enable with maxToolCalls: 2
    mockGetSmartRoutingConfig.mockResolvedValue(enabledSmartRoutingConfig({ maxToolCalls: 2 }));

    // Hub built-in and recursive execute_code refusal
    const builtinRes = await handleExecuteCodeRequest(
      {
        code: `
          const errors = [];
          for (const name of ["mcphub_file_upload", "execute_code", "call_tool"]) {
            try {
              await tools.call(name, {});
            } catch (e) {
              errors.push(e.message);
            }
          }
          return errors;
        `,
        readOnly: false,
      },
      {
        searchTools: async () => ({ content: [{ type: 'text', text: '{"tools":[]}' }] }),
        callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
        resolveToolMetadata: async () => undefined,
      },
    );
    const builtinBody = JSON.parse(builtinRes.content[0].text);
    // First 2 fail with hub built-in refusal, 3rd hits call_budget_exceeded
    expect(builtinBody.value[0]).toMatch(/cannot be called from code mode/i);
    expect(builtinBody.value[1]).toMatch(/cannot be called from code mode/i);
    expect(builtinBody.value[2]).toMatch(/maximum tool calls/i);

    // Read-only variant refuses mutating/unannotated tools and allows readOnlyHint: true
    const roRes = await handleExecuteCodeRequest(
      {
        code: `
          const ok = await tools.call("github-list_prs", {});
          let blocked = "";
          try {
            await tools.call("github-delete_repo", {});
          } catch (e) {
            blocked = e.message;
          }
          return { ok, blocked };
        `,
        readOnly: true,
      },
      {
        searchTools: async () => ({ content: [{ type: 'text', text: '{"tools":[]}' }] }),
        callTool: async (name) => ({
          content: [{ type: 'text', text: JSON.stringify({ called: name }) }],
        }),
        resolveToolMetadata: async (name) =>
          name === 'github-list_prs'
            ? ({ name, description: '', inputSchema: {}, annotations: { readOnlyHint: true } } as any)
            : ({
                name,
                description: '',
                inputSchema: {},
                annotations: { readOnlyHint: false, destructiveHint: true },
              } as any),
      },
    );
    const roBody = JSON.parse(roRes.content[0].text);
    expect(roBody.value.ok).toEqual({ called: 'github-list_prs' });
    expect(roBody.value.blocked).toMatch(/not permitted in execute_code_read/i);
  });

  it('reuses call_tool dispatch with toolCallGuard, skips intermediate compression, and rejects elicitation', async () => {
    const prevGuard = process.env.TOOL_CALL_GUARD_ENABLED;
    process.env.TOOL_CALL_GUARD_ENABLED = 'true';
    mockGetSmartRoutingConfig.mockResolvedValue(enabledSmartRoutingConfig());

    try {
      const serverInfo = {
        name: 'demo',
        status: 'connected',
        enabled: true,
        client: {},
        tools: [
          {
            name: 'demo-echo',
            description: 'Echo',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
          },
          {
            name: 'demo-elicit',
            description: 'Elicit',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
          },
        ],
      } as any;

      const capturedHandlers: ReturnType<typeof createToolHandlers> = createToolHandlers({
        getVisibleServerInfos: () => [serverInfo],
        getVisibleServerByName: (name) => (name === 'demo' ? serverInfo : undefined),
        getServerByName: (name) => (name === 'demo' ? serverInfo : undefined),
        getDownstreamServer: () => undefined,
        getMcpAppsRouteContext: async () => ({ enabled: false }),
        getFilteredServerInfosForGroup: async () => ({
          filteredServerInfos: [serverInfo],
          serverConfigsByName: new Map(),
        }),
        findRouteGroup: async () => null,
        filterToolsByConfig: async (_s, tools) => tools,
        filterToolsByGroup: async (_g, _s, tools) => tools,
        resolveDescriptionOverride: (d) => d || '',
        classifyUnavailableReason: () => 'tool-not-found',
        beginOnDemandToolCall: () => undefined,
        ensureServerReady: async () => undefined,
        acquireClientState: () => ({ id: 'state-1', release: () => undefined }),
        getOrCreateIsolatedClient: async () => ({ client: {} as any, transport: {} as any }),
        callToolWithReconnect: async (_info, params, _opts, _retries, _iso, extra) => {
          if (params.name === 'elicit') {
            await extra?.mcpReq?.send({ method: 'elicitation/create', params: {} } as any);
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({ echoed: params.arguments }) }],
          } as any;
        },
        withoutHiddenArguments: (_info, _toolName, args) => args,
        withStagingTools: async (_g, tools) => tools,
        dispatchCodeModeToolCall: (req, extra) =>
          capturedHandlers.handleCallToolRequestImpl(req, extra),
      });

      const response = await capturedHandlers.handleCallToolRequestImpl(
        {
          params: {
            name: 'execute_code',
            arguments: {
              // Template literal with $ and / must NOT be falsely blocked on outer execute_code
              code: `
                const tag = \`PR #\${42}/check\`;
                const okRes = await tools.call("demo-echo", { msg: tag });

                let guardBlocked = "";
                try {
                  await tools.call("demo-echo", { command: "echo hi; cat /etc/passwd" });
                } catch (e) {
                  guardBlocked = e.message;
                }

                let elicitBlocked = "";
                try {
                  await tools.call("demo-elicit", {});
                } catch (e) {
                  elicitBlocked = e.message;
                }

                let missingBlocked = "";
                try {
                  await tools.call("other-secret_tool", {});
                } catch (e) {
                  missingBlocked = e.message;
                }

                return { okRes, guardBlocked, elicitBlocked, missingBlocked };
              `,
            },
          },
        },
        {
          sessionId: 'sess-1',
          group: '$smart',
          mcpReq: {
            send: async () => ({ action: 'accept' }),
            signal: new AbortController().signal,
          },
        },
      );

      expect(response.isError).not.toBe(true);
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.value.okRes).toEqual({ echoed: { msg: 'PR #42/check' } });
      expect(parsed.value.guardBlocked).toMatch(/blocked|Error/i);
      expect(parsed.value.elicitBlocked).toMatch(/elicitation/i);
      expect(parsed.value.missingBlocked).toMatch(/Tool not available/i);
      // maybeCompressToolResult should be called ONCE (on the outer execute_code result),
      // NOT on intermediate inner tools.call() results.
      expect(mockMaybeCompressToolResult).toHaveBeenCalledTimes(1);
    } finally {
      if (prevGuard === undefined) {
        delete process.env.TOOL_CALL_GUARD_ENABLED;
      } else {
        process.env.TOOL_CALL_GUARD_ENABLED = prevGuard;
      }
    }
  });
});
