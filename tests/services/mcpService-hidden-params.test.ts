/**
 * Per-tool hiddenParams: removed from what a model sees (tools/list, the
 * Smart Routing embedding) and from the arguments forwarded upstream.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ServerInfo } from '../../src/types/index.js';

const mockLogToolCall = jest.fn().mockResolvedValue(undefined);
const mockCallTool = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
const mockFindServerById = jest.fn(async (_name: string): Promise<any> => undefined);
const mockSaveEmbeddings = jest.fn(async (..._args: any[]) => undefined);

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => ({
    findByName: jest.fn(async () => undefined),
    findById: jest.fn(async () => undefined),
  })),
  getServerDao: jest.fn(() => ({
    findAll: jest.fn(async () => []),
    findById: mockFindServerById,
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
      getBearerKeyExclusions: jest.fn(() => undefined),
      getSessionId: jest.fn(),
      getHeaders: jest.fn(() => undefined),
    })),
  },
}));

jest.mock('../../src/services/sseService.js', () => ({ getGroup: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: mockSaveEmbeddings,
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

import * as mcpService from '../../src/services/mcpService.js';

// firecrawl-mcp's scrape tool, cut down: `url` is required, the rest are options.
const scrapeSchema = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    formats: { type: 'array' },
    alexandria: { type: 'object', description: 'Cloud-only catalogue execution' },
    profile: { type: 'object' },
  },
  required: ['url'],
};

const firecrawl = (tools: Record<string, any>): ServerInfo => ({
  name: 'firecrawl',
  owner: 'admin',
  visibility: 'public',
  status: 'connected',
  error: null,
  tools: [{ name: 'firecrawl-scrape', description: 'Scrape one URL', inputSchema: scrapeSchema }],
  prompts: [],
  resources: [],
  createTime: Date.now(),
  enabled: true,
  client: { callTool: mockCallTool } as any,
  config: { tools } as any,
});

describe('hidden tool parameters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogToolCall.mockResolvedValue(undefined);
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    mockFindServerById.mockResolvedValue(undefined);
  });

  it('drops hidden arguments before the upstream call, never a required one', async () => {
    // `url` is listed too: required parameters are never hidden
    const tools = { scrape: { enabled: true, hiddenParams: ['alexandria', 'profile', 'url'] } };
    mcpService.setServerInfosForTest([firecrawl(tools)]);

    await mcpService.handleCallToolRequest(
      {
        params: {
          name: 'firecrawl-scrape',
          arguments: { url: 'https://example.com', formats: ['markdown'], alexandria: { x: 1 } },
        },
      },
      { sessionId: 'session-1' },
    );

    expect(mockCallTool).toHaveBeenCalledTimes(1);
    expect((mockCallTool.mock.calls[0] as any[])[0]).toEqual({
      name: 'scrape',
      arguments: { url: 'https://example.com', formats: ['markdown'] },
    });
  });

  it('forwards arguments untouched without hidden parameters', async () => {
    mcpService.setServerInfosForTest([firecrawl({})]);
    const args = { url: 'https://example.com', profile: { name: 'p' } };

    await mcpService.handleCallToolRequest(
      { params: { name: 'firecrawl-scrape', arguments: args } },
      { sessionId: 'session-1' },
    );

    expect((mockCallTool.mock.calls[0] as any[])[0]).toEqual({ name: 'scrape', arguments: args });
  });

  it('lists the trimmed schema and a bare-name description override in tools/list', async () => {
    const tools = {
      scrape: { enabled: true, description: 'Short.', hiddenParams: ['alexandria', 'profile'] },
    };
    mcpService.setServerInfosForTest([firecrawl(tools)]);
    mockFindServerById.mockResolvedValue({ name: 'firecrawl', tools });

    const result: any = await mcpService.handleListToolsRequest({}, { group: 'firecrawl' } as any);
    const tool = result.tools.find((candidate: any) => candidate.name.endsWith('scrape'));

    expect(tool.description).toBe('Short.');
    expect(Object.keys(tool.inputSchema.properties)).toEqual(['url', 'formats']);
    expect(tool.inputSchema.required).toEqual(['url']);
  });

  it('embeds the trimmed schema for Smart Routing', async () => {
    const tools = { 'firecrawl-scrape': { enabled: true, hiddenParams: ['alexandria'] } };
    mockFindServerById.mockResolvedValue({ name: 'firecrawl', tools });

    await mcpService.syncToolsAsVectorEmbeddings('firecrawl', firecrawl(tools).tools);

    const embedded = (mockSaveEmbeddings.mock.calls[0] as any[])[1][0];
    expect(Object.keys(embedded.inputSchema.properties)).toEqual(['url', 'formats', 'profile']);
  });

  it.each([
    ['the bare upstream name', 'firecrawl-scrape'],
    ['the runtime name', 'firecrawl-firecrawl-scrape'],
  ])(
    'drops hidden arguments for an upstream name that starts with the server prefix (%s)',
    async (_label, key) => {
      // Upstream tool `firecrawl-scrape` on server `firecrawl`: runtime name
      // `firecrawl-firecrawl-scrape`, so one prefix removal is not the bare name.
      const server = firecrawl({ [key]: { enabled: true, hiddenParams: ['profile'] } });
      server.tools = [
        {
          name: 'firecrawl-firecrawl-scrape',
          description: 'Scrape one URL',
          inputSchema: scrapeSchema,
        },
      ];
      mcpService.setServerInfosForTest([server]);

      await mcpService.handleCallToolRequest(
        {
          params: {
            name: 'firecrawl-firecrawl-scrape',
            arguments: { url: 'u', profile: { name: 'p' } },
          },
        },
        { sessionId: 'session-1' },
      );

      expect((mockCallTool.mock.calls[0] as any[])[0]).toEqual({
        name: 'firecrawl-scrape',
        arguments: { url: 'u' },
      });
    },
  );
});
