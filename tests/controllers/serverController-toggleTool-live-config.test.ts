/**
 * End-to-end regression test for the review comment on PR #1178
 * (https://github.com/samanhappy/mcphub/pull/1178#issuecomment): the
 * findToolOnServer fix reads serverInfo.config, but toggleTool's
 * notifyToolChanged() call takes the "already connected" shortcut in
 * registerAllTools, which preserves the in-memory serverInfo verbatim
 * instead of applying the freshly-persisted tools config. So right after
 * disabling a tool on a healthy connected server, the live serverInfo.config
 * still lacked the disable and the tool executed anyway — exactly the gap
 * the maintainer reproduced.
 *
 * This test drives the REAL toggleTool controller and the REAL
 * handleCallToolRequest (not the synthetic setServerInfosForTest state used
 * in mcpService-disabled-tool-execution.test.ts), so it fails against the
 * pre-fix code and passes only because toggleTool now patches the live
 * config in place.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';

const toolsStore: Record<string, Record<string, { enabled: boolean; description?: string }>> = {
  gmail: {},
};

const mockCallTool = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

const controllerServerDao = {
  findById: jest.fn(async (name: string) => ({
    name,
    owner: 'admin',
    tools: toolsStore[name],
  })),
  updateTools: jest.fn(async (name: string, tools: any) => {
    toolsStore[name] = tools;
    return true;
  }),
};

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: jest.fn(() => controllerServerDao),
  getBearerKeyDao: jest.fn(),
  getGroupDao: jest.fn(() => ({ findByName: jest.fn(async () => undefined) })),
  getOAuthClientDao: jest.fn(),
  getOAuthTokenDao: jest.fn(),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(async () => ({})) })),
  getUserConfigDao: jest.fn(),
  getUserDao: jest.fn(),
}));
jest.mock('../../src/dao/SystemConfigDao.js', () => ({
  migrateLegacySmartRoutingConfig: jest.fn(),
}));
jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => ({
    findByName: jest.fn(async () => undefined),
    findById: jest.fn(async () => undefined),
  })),
  getServerDao: jest.fn(() => controllerServerDao),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(() => Promise.resolve({})) })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
    findByName: jest.fn(async () => undefined),
  })),
  getBuiltinResourceDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
  getUserDao: jest.fn(() => ({ findByUsername: jest.fn(async () => undefined) })),
}));
jest.mock('../../src/services/credentialBindingService.js', () => {
  const { EventEmitter } = jest.requireActual('node:events') as any;
  return {
    deleteCredentialBindings: jest.fn(),
    credentialBindingEvents: new EventEmitter(),
  };
});
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
  syncAllServerToolsEmbeddings: jest.fn(),
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
  getActivityLoggingService: jest.fn(() => ({ logToolCall: jest.fn().mockResolvedValue(undefined) })),
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
jest.mock('../../src/services/openApiToolStatsService.js', () => ({
  previewOpenApiToolStats: jest.fn(),
}));
jest.mock('../../src/services/upstreamOAuthDisconnectService.js', () => ({
  disconnectUpstreamOAuth: jest.fn(),
}));

jest.mock('../../src/services/mcpService.js', () => {
  const actual = jest.requireActual('../../src/services/mcpService.js') as any;
  return {
    ...actual,
    // Real notifyToolChanged triggers a full registerAllTools reconciliation
    // pass (server reconnection, embeddings, etc.) — irrelevant to this test
    // and heavy to stand up. getServerByName / handleCallToolRequest /
    // setServerInfosForTest stay real: they're what this test verifies.
    notifyToolChanged: jest.fn().mockResolvedValue(undefined),
  };
});

import { toggleTool } from '../../src/controllers/serverController.js';
import * as mcpService from '../../src/services/mcpService.js';

const mockRes = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as any,
    json: jest.fn().mockReturnThis() as any,
  };
  return res as Response;
};

describe('toggleTool -> handleCallToolRequest end-to-end (PR #1178 review gap)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    toolsStore.gmail = {};
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    mcpService.setServerInfosForTest([
      {
        name: 'gmail',
        owner: 'admin',
        visibility: 'public',
        status: 'connected',
        error: null,
        tools: [
          { name: 'gmail-send_email', description: 'Send an email', inputSchema: { type: 'object' } },
        ],
        prompts: [],
        resources: [],
        createTime: Date.now(),
        enabled: true,
        client: { callTool: mockCallTool } as any,
        config: { tools: {} } as any,
      } as any,
    ]);
  });

  it('blocks the very next call after a live toggle, without a reconnect', async () => {
    const req = {
      params: { serverName: 'gmail', toolName: 'gmail-send_email' },
      body: { enabled: false },
      user: { username: 'admin', isAdmin: true },
    } as unknown as Request;
    const res = mockRes();

    await toggleTool(req, res);

    expect((res.json as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );

    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'gmail-send_email', arguments: {} } },
      { sessionId: 'session-1' },
    );

    expect(result.isError).toBe(true);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it('still allows the call before any toggle happens', async () => {
    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'gmail-send_email', arguments: {} } },
      { sessionId: 'session-1' },
    );

    expect(result.isError).toBeFalsy();
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });
});
