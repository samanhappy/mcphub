/**
 * Regression tests for #1103: a tool/prompt call addressed to a server that
 * exists but is hidden from the caller (private / unshared) must fail with the
 * SAME protocol-appropriate response as one addressed to a target that does
 * not exist at all — no distinguishable authorization error that leaks hidden
 * server/tool existence. The internal reason is still recorded in activity
 * logs for operators.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ServerInfo } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Mocks (must be declared before any import that touches them)
// ---------------------------------------------------------------------------

const mockLogToolCall = jest.fn().mockResolvedValue(undefined);

const mockUserContextService = {
  getCurrentUser: jest.fn<() => any>(),
  hasUser: jest.fn<() => boolean>(),
  isAdmin: jest.fn<() => boolean>(),
  setCurrentUser: jest.fn(),
  clearCurrentUser: jest.fn(),
  runWithContext: jest.fn(),
};

// Mutable state: updated per-test via beforeEach so clearAllMocks doesn't wipe
// the return value (mockReturnValue is reset by clearAllMocks in some Jest
// versions when set inside the factory).
let currentUserForFilter: any = null;

// Same visibility logic as DataService.filterData in src/services/dataService.ts:
// non-admin sees own + public servers (and group-shared, not exercised here).
const realFilterData = (data: any[], user?: any) => {
  const currentUser = user || currentUserForFilter;
  if (!currentUser || currentUser.isAdmin) {
    return data;
  }
  return data.filter((item) => {
    if (item.owner === currentUser.username) return true;
    if (item.visibility === 'public') return true;
    return false;
  });
};

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => ({
    findByName: jest.fn(async () => undefined),
    findById: jest.fn(async () => undefined),
  })),
  getServerDao: jest.fn(() => ({
    findAll: jest.fn(async () => []),
    findById: jest.fn(async () => undefined),
  })),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(() => Promise.resolve({})),
  })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
    findByName: jest.fn(async () => undefined),
  })),
  getBuiltinResourceDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
  getUserDao: jest.fn(() => ({
    findByUsername: jest.fn(async () => undefined),
  })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: realFilterData,
  })),
}));

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => mockUserContextService),
  },
}));

jest.mock('../../src/services/requestContextService.js', () => ({
  RequestContextService: {
    getInstance: jest.fn(() => ({
      getHostedAuthContext: jest.fn(() => null),
      getBearerKeyContext: jest.fn(() => ({})),
      getGroupContext: jest.fn(),
      getUsernameContext: jest.fn(),
      getKeyKindContext: jest.fn(),
      getRequestContext: jest.fn(() => ({})),
      getSessionId: jest.fn(),
      getHeaders: jest.fn(() => undefined),
    })),
  },
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));

jest.mock('../../src/services/hostedAuthService.js', () => ({
  assertHostedToolAllowed: jest.fn(),
  filterHostedTools: jest.fn((_ctx: any, _name: string, tools: any[]) => tools),
  reserveHostedToolCall: jest.fn(),
  settleHostedToolCall: jest.fn(),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: mockLogToolCall,
  })),
}));

jest.mock('../../src/services/toolResultCompressionService.js', () => ({
  maybeCompressToolResult: jest.fn((r: any) => r),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServerConfigsInGroup: jest.fn(async () => []),
  getServerConfigInGroup: jest.fn(async () => undefined),
  getServersInGroup: jest.fn(async () => []),
  normalizeGroupServers: jest.fn((servers: any[]) =>
    servers.map((s: any) =>
      typeof s === 'string'
        ? { name: s, tools: 'all', prompts: 'all', resources: 'all' }
        : {
            name: s.name,
            tools: s.tools || 'all',
            prompts: s.prompts || 'all',
            resources: s.resources || 'all',
          },
    ),
  ),
  notifyToolChanged: jest.fn(),
}));

jest.mock('../../src/services/proxy.js', () => ({
  normalizeHeaders: jest.fn((h: any) => h),
  createFetchWithProxy: jest.fn(),
  getProxyConfigFromEnv: jest.fn(),
}));

jest.mock('../../src/config/index.js', () => ({
  __esModule: true,
  default: { mcpHubName: 'test', mcpHubVersion: '1.0.0', basePath: '' },
  expandEnvVars: jest.fn((v: string) => v),
  replaceEnvVars: jest.fn((v: any) => v),
  getNameSeparator: jest.fn(() => '::'),
  loadSettings: jest.fn(),
  getSettingsPath: jest.fn(),
}));

jest.mock('../../src/utils/mcpApps.js', () => ({
  MCP_APPS_CAPABILITIES: {},
  filterModelVisibleTools: jest.fn((_: any, tools: any[]) => tools),
  hasMcpAppsCapability: jest.fn(() => false),
  isAppOnlyTool: jest.fn(() => false),
  stripMcpAppsMetadata: jest.fn((t: any) => t),
}));

jest.mock('../../src/clients/openapi.js', () => ({
  OpenAPIClient: jest.fn(),
}));

jest.mock('../../src/services/cloudService.js', () => ({
  getCloudService: jest.fn(() => ({ isEnabled: false })),
}));

jest.mock('../../src/services/changelogService.js', () => ({
  getChangelogService: jest.fn(() => ({ getChangelog: jest.fn() })),
}));

jest.mock('../../src/services/hostedMode.js', () => ({
  isHostedModeEnabled: jest.fn(() => false),
}));

jest.mock('../../src/services/hostedControlPlaneClient.js', () => ({
  getHostedControlPlaneClient: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import * as mcpService from '../../src/services/mcpService.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const aliceUser = { username: 'alice', isAdmin: false, password: '' };

const serverInfosFixture: ServerInfo[] = [
  {
    name: 'PublicServer',
    owner: 'admin',
    visibility: 'public',
    status: 'connected',
    error: null,
    tools: [
      {
        name: 'PublicServer::publicPing',
        description: 'Public ping',
        inputSchema: { type: 'object' },
      },
    ],
    prompts: [],
    resources: [],
    createTime: Date.now(),
    enabled: true,
  },
  {
    name: 'SecretSauce',
    owner: 'admin',
    visibility: 'private',
    status: 'connected',
    error: null,
    tools: [
      {
        name: 'SecretSauce::secretPing',
        description: 'Secret ping',
        inputSchema: { type: 'object' },
      },
    ],
    prompts: [],
    resources: [],
    createTime: Date.now(),
    enabled: true,
  },
  {
    name: 'DisabledSauce',
    owner: 'admin',
    visibility: 'public',
    status: 'disconnected',
    error: null,
    tools: [
      {
        name: 'DisabledSauce::offlinePing',
        description: 'Offline ping',
        inputSchema: { type: 'object' },
      },
    ],
    prompts: [],
    resources: [],
    createTime: Date.now(),
    enabled: false,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hidden-server tool/prompt errors (issue #1103)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogToolCall.mockResolvedValue(undefined);
    setFixture();
  });

  const setFixture = () => {
    mcpService.setServerInfosForTest(serverInfosFixture);
    currentUserForFilter = aliceUser;
  };

  it('returns a unified "Tool not available" result for a hidden server tool, identical to a nonexistent one', async () => {
    const toolName = 'SecretSauce::secretPing';

    // 1) Server exists but is hidden from alice (private, admin-owned).
    const hiddenResult = await mcpService.handleCallToolRequest(
      { params: { name: toolName, arguments: {} } },
      { sessionId: 'session-1' },
    );

    // 2) Server does not exist at all (same tool name).
    mcpService.setServerInfosForTest([]);
    const missingResult = await mcpService.handleCallToolRequest(
      { params: { name: toolName, arguments: {} } },
      { sessionId: 'session-1' },
    );

    expect(hiddenResult.isError).toBe(true);
    expect(missingResult.isError).toBe(true);
    // Indistinguishable: byte-identical response for hidden vs nonexistent.
    expect(hiddenResult).toEqual(missingResult);
    expect(hiddenResult.content[0].text).toBe(`Error: Tool not available: ${toolName}`);
    // The reason must never leak to the caller.
    expect(hiddenResult.content[0].text).not.toContain('reason');
    expect(hiddenResult.content[0].text).not.toContain('hidden');
    expect(hiddenResult.content[0].text).not.toContain('Server not found');
  });

  it('records a distinct internal reason in activity logs without leaking it to the caller', async () => {
    // Hidden target -> server-hidden-from-caller internally.
    await mcpService.handleCallToolRequest(
      { params: { name: 'SecretSauce::secretPing', arguments: {} } },
      { sessionId: 'session-1' },
    );
    expect(mockLogToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('(reason: server-hidden-from-caller)'),
      }),
    );

    // Nonexistent target -> server-or-name-not-found internally, same external text.
    mcpService.setServerInfosForTest([]);
    mockLogToolCall.mockClear();
    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'SecretSauce::secretPing', arguments: {} } },
      { sessionId: 'session-1' },
    );
    expect(mockLogToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('(reason: server-or-name-not-found)'),
      }),
    );
    expect(result.content[0].text).toBe('Error: Tool not available: SecretSauce::secretPing');
    expect(result.content[0].text).not.toContain('reason');
  });

  it('uses the same message for the $smart call_tool path targeting a hidden server', async () => {
    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'call_tool', arguments: { toolName: 'SecretSauce::secretPing' } } },
      { sessionId: 'session-1' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: Tool not available: SecretSauce::secretPing');
  });

  it('uses the unified message for a tool missing on a visible server', async () => {
    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'PublicServer::doesNotExist', arguments: {} } },
      { sessionId: 'session-1' },
    );
    expect(result.content[0].text).toBe('Error: Tool not available: PublicServer::doesNotExist');
    expect(mockLogToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('(reason: tool-or-prompt-not-found)'),
      }),
    );
  });

  it('uses the unified message for a disabled server tool', async () => {
    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'DisabledSauce::offlinePing', arguments: {} } },
      { sessionId: 'session-1' },
    );
    expect(result.content[0].text).toBe('Error: Tool not available: DisabledSauce::offlinePing');
    expect(mockLogToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('(reason: server-disabled)'),
      }),
    );
  });

  it('returns an indistinguishable "Prompt not available" for hidden vs nonexistent prompts', async () => {
    const promptName = 'SecretSauce::somePrompt';

    const hiddenResult = await mcpService.handleGetPromptRequest(
      { params: { name: promptName } },
      { sessionId: 'session-1' },
    );

    mcpService.setServerInfosForTest([]);
    const missingResult = await mcpService.handleGetPromptRequest(
      { params: { name: promptName } },
      { sessionId: 'session-1' },
    );

    expect(hiddenResult.isError).toBe(true);
    expect(missingResult.isError).toBe(true);
    expect(hiddenResult).toEqual(missingResult);
    expect(hiddenResult.content[0].text).toBe(`Error: Prompt not available: ${promptName}`);
  });

  it('still routes a visible public server tool to invocation (not "not available")', async () => {
    // The visibility filter is not broken: alice can call a public tool. With
    // no live client the invocation fails operationally ("Client not found"),
    // NOT with the unified unavailable error — a guard against over-broad
    // unification of unrelated failures.
    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'PublicServer::publicPing', arguments: {} } },
      { sessionId: 'session-1' },
    );
    expect(result.content[0].text).toContain('Client not found');
    expect(result.content[0].text).not.toContain('Tool not available');
  });
});
