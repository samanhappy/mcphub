/**
 * Regression test for a critical security bug: a tool disabled via
 * POST /api/servers/:server/tools/:tool/toggle (enabled: false) was still
 * callable via tools/call — the flag only ever filtered tools/list
 * (discovery), never gated execution. findToolOnServer resolved the tool
 * from the live runtime cache (serverInfo.tools, built by
 * normalizeToolForCache) without ever consulting the per-tool config, so a
 * caller who already knew (or guessed) the exact tool name — e.g. a write or
 * destructive tool on gmail/ms365/nextcloud deliberately disabled to keep a
 * connection read-only — could invoke it exactly as if it were still
 * enabled. Confirmed live against gmail's `send_email`: disabled via the
 * toggle endpoint, still present in tools/list, and still executed
 * end-to-end against the real upstream server.
 *
 * The toggle endpoint (serverController.ts toggleTool) stores
 * `tools[toolName] = { enabled }` under whatever string the caller passed as
 * :toolName, with no normalization — the dashboard sends the already
 * server-prefixed `tool.name`, but a direct API/script caller can just as
 * validly pass the bare upstream name. Both are exercised below.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ServerInfo } from '../../src/types/index.js';

const mockLogToolCall = jest.fn().mockResolvedValue(undefined);
const mockCallTool = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => ({
    findByName: jest.fn(async () => undefined),
    findById: jest.fn(async () => undefined),
  })),
  getServerDao: jest.fn(() => ({
    findAll: jest.fn(async () => []),
    findById: jest.fn(async () => undefined),
  })),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(() => Promise.resolve({})) })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
    findByName: jest.fn(async () => undefined),
  })),
  getBuiltinResourceDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
  getUserDao: jest.fn(() => ({ findByUsername: jest.fn(async () => undefined) })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({ filterData: (data: any) => data })),
}));

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({
      getCurrentUser: jest.fn(() => ({ username: 'admin', isAdmin: true })),
      hasUser: jest.fn(() => true),
      isAdmin: jest.fn(() => true),
      setCurrentUser: jest.fn(),
      clearCurrentUser: jest.fn(),
      runWithContext: jest.fn(),
    })),
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

jest.mock('../../src/services/sseService.js', () => ({ getGroup: jest.fn() }));
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
jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({ createOAuthProvider: jest.fn() }));
jest.mock('../../src/services/hostedAuthService.js', () => ({
  assertHostedToolAllowed: jest.fn(),
  filterHostedTools: jest.fn((_ctx: any, _name: string, tools: any[]) => tools),
  reserveHostedToolCall: jest.fn(),
  settleHostedToolCall: jest.fn(),
}));
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({ logToolCall: mockLogToolCall })),
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
  normalizeGroupServers: jest.fn((servers: any[]) => servers),
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
  getNameSeparator: jest.fn(() => '-'),
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
jest.mock('../../src/clients/openapi.js', () => ({ OpenAPIClient: jest.fn() }));
jest.mock('../../src/services/cloudService.js', () => ({ getCloudService: jest.fn(() => ({ isEnabled: false })) }));
jest.mock('../../src/services/changelogService.js', () => ({
  getChangelogService: jest.fn(() => ({ getChangelog: jest.fn() })),
}));
jest.mock('../../src/services/hostedMode.js', () => ({ isHostedModeEnabled: jest.fn(() => false) }));
jest.mock('../../src/services/hostedControlPlaneClient.js', () => ({ getHostedControlPlaneClient: jest.fn() }));

import * as mcpService from '../../src/services/mcpService.js';

const baseServer = (overrides: Partial<ServerInfo>): ServerInfo => ({
  name: 'gmail',
  owner: 'admin',
  visibility: 'public',
  status: 'connected',
  error: null,
  tools: [
    { name: 'gmail-send_email', description: 'Send an email', inputSchema: { type: 'object' } },
    { name: 'gmail-list_accounts', description: 'List accounts', inputSchema: { type: 'object' } },
  ],
  prompts: [],
  resources: [],
  createTime: Date.now(),
  enabled: true,
  client: { callTool: mockCallTool } as any,
  ...overrides,
});

describe('disabled tool must be unresolvable for execution, not just discovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogToolCall.mockResolvedValue(undefined);
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('rejects a disabled tool addressed by its bare name, and never reaches the upstream client', async () => {
    mcpService.setServerInfosForTest([
      baseServer({ config: { tools: { send_email: { enabled: false } } } as any }),
    ]);

    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'gmail-send_email', arguments: { to: ['x@example.com'] } } },
      { sessionId: 'session-1' },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: Tool not available: gmail-send_email');
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it('rejects a disabled tool addressed by its server-prefixed config key (dashboard convention)', async () => {
    mcpService.setServerInfosForTest([
      baseServer({ config: { tools: { 'gmail-send_email': { enabled: false } } } as any }),
    ]);

    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'gmail-send_email', arguments: {} } },
      { sessionId: 'session-1' },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: Tool not available: gmail-send_email');
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it('still allows an enabled tool on the same server to execute normally', async () => {
    mcpService.setServerInfosForTest([
      baseServer({ config: { tools: { send_email: { enabled: false } } } as any }),
    ]);

    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'gmail-list_accounts', arguments: {} } },
      { sessionId: 'session-1' },
    );

    expect(result.isError).toBeFalsy();
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });

  it('does not reject a tool with no per-tool config entry at all', async () => {
    mcpService.setServerInfosForTest([baseServer({ config: { tools: {} } as any })]);

    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'gmail-list_accounts', arguments: {} } },
      { sessionId: 'session-1' },
    );

    expect(result.isError).toBeFalsy();
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });
});
