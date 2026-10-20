/**
 * The hidden-params endpoint drives the live config, like toggleTool, so the
 * next call already drops a hidden argument without a reconnect.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';

const toolsStore: Record<string, Record<string, any>> = {
  firecrawl: {},
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
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn().mockResolvedValue(undefined),
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
  filterModelVisibleTools: jest.fn((tools: any[]) => tools),
  hasMcpAppsCapability: jest.fn(() => false),
  isAppOnlyTool: jest.fn(() => false),
  stripMcpAppsMetadata: jest.fn((t: any) => t),
}));
jest.mock('../../src/clients/openapi.js', () => ({ OpenAPIClient: jest.fn() }));
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
    syncToolEmbedding: jest.fn(),
  };
});

import {
  resetToolDescription,
  toggleTool,
  updateToolDescription,
  updateToolHiddenParams,
} from '../../src/controllers/serverController.js';
import * as mcpService from '../../src/services/mcpService.js';

const mockRes = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as any,
    json: jest.fn().mockReturnThis() as any,
  };
  return res as Response;
};

const request = (toolName: string, body: unknown) =>
  ({
    params: { serverName: 'firecrawl', toolName },
    body,
    user: { username: 'admin', isAdmin: true },
  }) as unknown as Request;

const scrapeSchema = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    alexandria: { type: 'object' },
    profile: { type: 'object' },
  },
  required: ['url'],
};

describe('updateToolHiddenParams', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    toolsStore.firecrawl = {};
    mcpService.setServerInfosForTest([
      {
        name: 'firecrawl',
        owner: 'admin',
        visibility: 'public',
        status: 'connected',
        error: null,
        tools: [{ name: 'firecrawl-scrape', description: 'Scrape', inputSchema: scrapeSchema }],
        prompts: [],
        resources: [],
        createTime: Date.now(),
        enabled: true,
        client: { callTool: mockCallTool } as any,
        config: { tools: {} } as any,
      } as any,
    ]);
  });

  it('stores the list and drops the argument from the very next call', async () => {
    const res = mockRes();
    await updateToolHiddenParams(
      request('firecrawl-scrape', { hiddenParams: ['alexandria'] }),
      res,
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { hiddenParams: ['alexandria'] } }),
    );
    expect(toolsStore.firecrawl).toEqual({
      'firecrawl-scrape': { enabled: true, hiddenParams: ['alexandria'] },
    });

    await mcpService.handleCallToolRequest(
      { params: { name: 'firecrawl-scrape', arguments: { url: 'u', alexandria: {} } } },
      { sessionId: 'session-1' },
    );
    expect((mockCallTool.mock.calls[0] as any[])[0]).toEqual({
      name: 'scrape',
      arguments: { url: 'u' },
    });
  });

  it('writes into an existing bare-name entry instead of shadowing it', async () => {
    toolsStore.firecrawl = { scrape: { enabled: true, description: 'Short.' } };

    await updateToolHiddenParams(
      request('firecrawl-scrape', { hiddenParams: ['profile', 'profile'] }),
      mockRes(),
    );

    expect(toolsStore.firecrawl).toEqual({
      scrape: { enabled: true, description: 'Short.', hiddenParams: ['profile'] },
    });
  });

  it.each([
    [['url'], "Parameter 'url' is required and cannot be hidden"],
    [['nope'], "Tool scrape has no parameter 'nope'"],
    ['alexandria', 'hiddenParams must be an array of parameter names'],
    [[''], 'hiddenParams must be an array of parameter names'],
  ])('rejects %j', async (hiddenParams, message) => {
    const res = mockRes();
    await updateToolHiddenParams(request('scrape', { hiddenParams }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message });
    expect(controllerServerDao.updateTools).not.toHaveBeenCalled();
  });

  it('removes the setting with an empty list, and the entry when nothing else is left', async () => {
    toolsStore.firecrawl = {
      scrape: { enabled: true, hiddenParams: ['profile'] },
      other: { enabled: true, description: 'Kept.', hiddenParams: ['x'] },
    };

    await updateToolHiddenParams(request('scrape', { hiddenParams: [] }), mockRes());
    expect(toolsStore.firecrawl).toEqual({
      other: { enabled: true, description: 'Kept.', hiddenParams: ['x'] },
    });
  });

  it('keeps hidden parameters when the description is reset', async () => {
    toolsStore.firecrawl = {
      'firecrawl-scrape': { enabled: true, description: 'Short.', hiddenParams: ['profile'] },
    };

    await resetToolDescription(request('firecrawl-scrape', {}), mockRes());

    expect(toolsStore.firecrawl).toEqual({
      'firecrawl-scrape': { enabled: true, hiddenParams: ['profile'] },
    });
  });

  it('keeps one entry and its hidden parameters through dashboard edits in sequence', async () => {
    // Declared in a settings file under the bare name; the dashboard addresses
    // the tool by its runtime (prefixed) name.
    toolsStore.firecrawl = { scrape: { enabled: true, hiddenParams: ['profile'] } };

    await updateToolDescription(request('firecrawl-scrape', { description: 'Short.' }), mockRes());
    await toggleTool(request('firecrawl-scrape', { enabled: false }), mockRes());
    await toggleTool(request('firecrawl-scrape', { enabled: true }), mockRes());
    expect(toolsStore.firecrawl).toEqual({
      scrape: { enabled: true, description: 'Short.', hiddenParams: ['profile'] },
    });

    await resetToolDescription(request('firecrawl-scrape', {}), mockRes());
    expect(toolsStore.firecrawl).toEqual({ scrape: { enabled: true, hiddenParams: ['profile'] } });

    await mcpService.handleCallToolRequest(
      { params: { name: 'firecrawl-scrape', arguments: { url: 'u', profile: { name: 'p' } } } },
      { sessionId: 'session-1' },
    );
    expect((mockCallTool.mock.calls[0] as any[])[0]).toEqual({
      name: 'scrape',
      arguments: { url: 'u' },
    });
  });

  it('rejects a reserved tool name', async () => {
    const res = mockRes();
    await updateToolHiddenParams(request('__proto__', { hiddenParams: [] }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(controllerServerDao.updateTools).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown server', async () => {
    controllerServerDao.findById.mockResolvedValueOnce(null as any);
    const res = mockRes();
    await updateToolHiddenParams(request('scrape', { hiddenParams: ['profile'] }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(controllerServerDao.updateTools).not.toHaveBeenCalled();
  });

  it('stores the list as given while the server is not connected', async () => {
    mcpService.setServerInfosForTest([]);
    const res = mockRes();
    await updateToolHiddenParams(request('scrape', { hiddenParams: ['not_known_yet'] }), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(toolsStore.firecrawl).toEqual({
      scrape: { enabled: true, hiddenParams: ['not_known_yet'] },
    });
  });

  it('answers 500 when the settings cannot be saved', async () => {
    controllerServerDao.updateTools.mockResolvedValueOnce(false);
    const failed = mockRes();
    await updateToolHiddenParams(request('scrape', { hiddenParams: ['profile'] }), failed);
    expect(failed.status).toHaveBeenCalledWith(500);
    expect(failed.json).toHaveBeenCalledWith({
      success: false,
      message: 'Failed to save settings',
    });

    controllerServerDao.updateTools.mockRejectedValueOnce(new Error('db down'));
    const thrown = mockRes();
    await updateToolHiddenParams(request('scrape', { hiddenParams: ['profile'] }), thrown);
    expect(thrown.status).toHaveBeenCalledWith(500);
    expect(thrown.json).toHaveBeenCalledWith({ success: false, message: 'Internal server error' });
  });
});
