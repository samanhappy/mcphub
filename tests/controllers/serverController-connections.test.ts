/**
 * Saving a tool, prompt or resource setting, or deleting a server, changes
 * what is exposed. It must not reconnect unrelated servers. An unscoped
 * notifyToolChanged() runs a full initializeClientsFromSettings pass, which
 * gives every enabled server that is not `connected` a new transport (a new
 * stdio child process) while the old one keeps running until its connect
 * attempt times out. Same pattern as #938 (server toggle) and #1426 (groups).
 *
 * Drives the real controllers and the real mcpService; only the MCP SDK
 * client/transport and persistence are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';

const mockClientConnect = jest.fn<(transport: any) => Promise<void>>();

jest.mock('@modelcontextprotocol/client', () => ({
  ...(jest.requireActual('@modelcontextprotocol/client') as object),
  Client: jest.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    close: jest.fn(),
    getServerCapabilities: jest.fn(() => ({ tools: {} })),
    getServerVersion: jest.fn(() => ({ name: 'upstream', version: '1.0.0' })),
    getInstructions: jest.fn(() => undefined),
    listTools: jest.fn(async () => ({
      tools: [
        {
          name: 'search',
          description: 'Search',
          inputSchema: { type: 'object', properties: { q: {}, secret: {} } },
        },
      ],
    })),
  })),
}));

jest.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: jest.fn().mockImplementation((params: any) => ({
    close: jest.fn(),
    stderr: { on: jest.fn() },
    script: params.args?.[0],
  })),
}));

const mockSettings: Record<string, any> = {};

const mockServerDao = {
  findAll: jest.fn(async () => Object.values(mockSettings)),
  findById: jest.fn(async (name: string) => mockSettings[name] ?? null),
  updateTools: jest.fn(async (name: string, tools: any) => {
    mockSettings[name] = { ...mockSettings[name], tools };
    return true;
  }),
  updatePrompts: jest.fn(async (name: string, prompts: any) => {
    mockSettings[name] = { ...mockSettings[name], prompts };
    return true;
  }),
  updateResources: jest.fn(async (name: string, resources: any) => {
    mockSettings[name] = { ...mockSettings[name], resources };
    return true;
  }),
  delete: jest.fn(async (name: string) => {
    delete mockSettings[name];
    return true;
  }),
};

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
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
  getServerDao: jest.fn(() => mockServerDao),
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
      getBearerKeyExclusions: jest.fn(() => undefined),
      getSessionId: jest.fn(),
      getHeaders: jest.fn(() => undefined),
    })),
  },
}));
jest.mock('../../src/services/sseService.js', () => ({ getGroup: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(async () => undefined),
  saveToolsAsVectorEmbeddings: jest.fn(async () => undefined),
  syncAllServerToolsEmbeddings: jest.fn(),
  searchToolsByVector: jest.fn(),
}));
jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));
jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  registerOAuthClient: jest.fn(),
}));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({ createOAuthProvider: jest.fn() }));
jest.mock('../../src/services/hostedAuthService.js', () => ({
  assertHostedToolAllowed: jest.fn(),
  filterHostedTools: jest.fn((_ctx: any, _name: string, tools: any[]) => tools),
  reserveHostedToolCall: jest.fn(),
  settleHostedToolCall: jest.fn(),
}));
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logActivity: jest.fn(),
    logToolCall: jest.fn(async () => undefined),
  })),
}));
jest.mock('../../src/services/toolResultCompressionService.js', () => ({
  maybeCompressToolResult: jest.fn((r: any) => r),
}));
jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn(async () => undefined),
}));
jest.mock('../../src/services/groupService.js', () => ({
  getServerConfigsInGroup: jest.fn(async () => []),
  getServerConfigInGroup: jest.fn(async () => undefined),
  getServersInGroup: jest.fn(async () => []),
  normalizeGroupServers: jest.fn((servers: any[]) => servers),
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

import {
  batchToggleTools,
  deleteServer,
  resetPromptDescription,
  resetResourceDescription,
  resetToolDescription,
  togglePrompt,
  toggleResource,
  toggleTool,
  updatePromptDescription,
  updateResourceDescription,
  updateToolDescription,
  updateToolHiddenParams,
} from '../../src/controllers/serverController.js';
import {
  getServerByName,
  initializeClientsFromSettings,
  setServerInfosForTest,
} from '../../src/services/mcpService.js';
import { mcpEventBus } from '../../src/services/mcpEventBus.js';

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const request = (params: Record<string, string>, body: unknown = {}) =>
  ({ params, body, user: { username: 'admin', isAdmin: true } }) as unknown as Request;

const response = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as any,
    json: jest.fn().mockReturnThis() as any,
  };
  return res as Response;
};

const tool = { serverName: 'alpha', toolName: 'alpha-search' };
const prompt = { serverName: 'alpha', promptName: 'draft' };
const resource = { serverName: 'alpha', resourceUri: 'resource://guide' };

describe('capability config changes do not reconnect other servers', () => {
  let publishSpy: ReturnType<typeof jest.spyOn>;
  const publishedKinds = () =>
    [...new Set(publishSpy.mock.calls.map(([event]) => (event as { kind: string }).kind))].sort();

  beforeEach(async () => {
    jest.clearAllMocks();
    setServerInfosForTest([]);
    for (const name of Object.keys(mockSettings)) delete mockSettings[name];
    // `alpha` connects and is the server every request edits. `beta` never
    // finishes initialization, like a slow or broken stdio server.
    for (const name of ['alpha', 'beta']) {
      mockSettings[name] = {
        name,
        owner: 'admin',
        enabled: true,
        command: 'node',
        args: [`${name}.js`],
      };
    }
    mockClientConnect.mockImplementation((transport: any) =>
      transport.script === 'beta.js' ? new Promise<void>(() => {}) : Promise.resolve(),
    );

    await initializeClientsFromSettings(true);
    await settle();

    expect(getServerByName('alpha')?.status).toBe('connected');
    expect(getServerByName('alpha')?.tools.map((t) => t.name)).toEqual(['alpha-search']);
    expect(getServerByName('beta')?.status).toBe('connecting');
    expect(mockClientConnect).toHaveBeenCalledTimes(2);
    publishSpy = jest.spyOn(mcpEventBus, 'publish');
  });

  afterEach(() => {
    publishSpy.mockRestore();
    setServerInfosForTest([]);
  });

  const TOOLS = 'tools_list_changed';
  const PROMPTS = 'prompts_list_changed';
  const RESOURCES = 'resources_list_changed';

  it.each([
    ['toggleTool', (res: Response) => toggleTool(request(tool, { enabled: false }), res), [TOOLS]],
    [
      'batchToggleTools',
      (res: Response) =>
        batchToggleTools(
          request({ serverName: 'alpha' }, { enabled: false, tools: ['search'] }),
          res,
        ),
      [TOOLS],
    ],
    [
      'updateToolDescription',
      (res: Response) => updateToolDescription(request(tool, { description: 'Custom' }), res),
      [TOOLS],
    ],
    [
      'updateToolHiddenParams',
      (res: Response) => updateToolHiddenParams(request(tool, { hiddenParams: ['secret'] }), res),
      [TOOLS],
    ],
    ['resetToolDescription', (res: Response) => resetToolDescription(request(tool), res), [TOOLS]],
    [
      'togglePrompt',
      (res: Response) => togglePrompt(request(prompt, { enabled: false }), res),
      [TOOLS, PROMPTS],
    ],
    [
      'updatePromptDescription',
      (res: Response) => updatePromptDescription(request(prompt, { description: 'Custom' }), res),
      [TOOLS, PROMPTS],
    ],
    [
      'resetPromptDescription',
      (res: Response) => resetPromptDescription(request(prompt), res),
      [TOOLS, PROMPTS],
    ],
    [
      'toggleResource',
      (res: Response) => toggleResource(request(resource, { enabled: false }), res),
      [TOOLS, RESOURCES],
    ],
    [
      'updateResourceDescription',
      (res: Response) =>
        updateResourceDescription(request(resource, { description: 'Custom' }), res),
      [TOOLS, RESOURCES],
    ],
    [
      'resetResourceDescription',
      (res: Response) => resetResourceDescription(request(resource), res),
      [TOOLS, RESOURCES],
    ],
  ])('%s keeps every upstream connection and broadcasts the change', async (_name, run, kinds) => {
    const alpha = getServerByName('alpha');
    const beta = getServerByName('beta');
    const res = response();

    await run(res);
    await settle();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(mockClientConnect).toHaveBeenCalledTimes(2);
    expect(getServerByName('alpha')).toBe(alpha);
    expect(getServerByName('beta')).toBe(beta);
    expect(publishedKinds()).toEqual([...kinds].sort());
  });

  it('deleteServer closes only the deleted server and broadcasts the change', async () => {
    const beta = getServerByName('beta');
    const res = response();

    await deleteServer(request({ name: 'alpha' }), res);
    await settle();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(getServerByName('alpha')).toBeUndefined();
    expect(mockClientConnect).toHaveBeenCalledTimes(2);
    expect(getServerByName('beta')).toBe(beta);
    expect(publishedKinds()).toEqual([PROMPTS, RESOURCES, TOOLS]);
  });
});
