/**
 * Hub built-in staging tools (#1056) must be dispatched outside the upstream
 * call path: no replica scope, no tool policy, no per-user runtime, no
 * upstream client call. These tests pin that boundary at the public entry
 * points rather than at the dispatch seam (which has its own suite).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetSystemConfig = jest.fn(async () => ({ normalizeToolNames: true }));
const mockAliceUser = {
  username: 'alice',
  isAdmin: false,
  id: '11111111-1111-1111-1111-111111111111',
};
const mockCallTool = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'upstream' }] });
const mockGetFileStagingSettings = jest.fn(async () => ({ enabled: false }));
const mockGetStagingStateStore = jest.fn(async () => ({}));

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => ({
    findByName: jest.fn(async () => undefined),
    findById: jest.fn(async () => undefined),
  })),
  getServerDao: jest.fn(() => ({
    findAll: jest.fn(async () => []),
    findById: jest.fn(async () => undefined),
  })),
  getSystemConfigDao: jest.fn(() => ({ get: mockGetSystemConfig })),
  getBuiltinPromptDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
  getBuiltinResourceDao: jest.fn(() => ({ findEnabled: jest.fn(async () => []) })),
  getUserDao: jest.fn(() => ({
    findByUsername: jest.fn(async () => mockAliceUser),
  })),
}));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getUserDao: jest.fn(() => ({
    findByUsername: jest.fn(async () => mockAliceUser),
  })),
  getServerDao: jest.fn(() => ({ findAll: jest.fn(async () => []), findById: jest.fn(async () => undefined) })),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(async () => ({})) })),
}));

jest.mock('../../src/services/fileStaging/settings.js', () => ({
  getFileStagingSettings: (...args: unknown[]) => mockGetFileStagingSettings(...(args as [])),
  getStagingStateStore: (...args: unknown[]) => mockGetStagingStateStore(...(args as [])),
  isStagingRuntimeSupported: () => true,
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({ filterData: (data: any) => data })),
}));

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({
      getCurrentUser: jest.fn(() => ({ username: 'alice', isAdmin: false })),
      hasUser: jest.fn(() => true),
      isAdmin: jest.fn(() => false),
      setCurrentUser: jest.fn(),
      clearCurrentUser: jest.fn(),
      runWithContext: jest.fn((action: () => unknown) => action()),
    })),
  },
}));

jest.mock('../../src/services/requestContextService.js', () => ({
  RequestContextService: {
    getInstance: jest.fn(() => ({
      getHostedAuthContext: jest.fn(() => null),
      getBearerKeyContext: jest.fn(() => ({})),
      getGroupContext: jest.fn(),
      getUsernameContext: jest.fn(() => 'alice'),
      getKeyKindContext: jest.fn(() => 'user'),
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
  saveToolsAsVectorEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(async () => ({ tools: [] })),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => true),
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
  getActivityLoggingService: jest.fn(() => ({ logToolCall: jest.fn() })),
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

const textOf = (result: any): string => result?.content?.[0]?.text ?? '';

const makeSshStagingServer = (version: string | undefined): any => ({
  name: 'shared-cred',
  owner: 'admin',
  visibility: 'public',
  status: 'connected',
  enabled: true,
  error: null,
  version,
  tools: [
    {
      name: 'shared-cred-upload',
      description: 'upload',
      inputSchema: {
        type: 'object',
        properties: {
          localPath: { type: 'string' },
          remotePath: { type: 'string' },
        },
      },
    },
  ],
  prompts: [],
  resources: [],
  config: {
    id: '22222222-2222-2222-2222-222222222222',
    type: 'stdio',
    command: 'npx',
    args: [
      '-y',
      '@fangjunjie/ssh-mcp-server@1.11.0',
      '--host', '{{args.ssh_host}}',
      '--port', '{{args.ssh_port}}',
      '--username', '{{args.ssh_user}}',
      '--privateKey', '{{args.ssh_key}}',
    ],
    enabled: true,
    visibility: 'public',
    staging: { adapter: 'ssh', shared: true },
    credentialTemplate: [
      { target: 'args', name: 'ssh_host' },
      { target: 'args', name: 'ssh_port' },
      { target: 'args', name: 'ssh_user' },
      { target: 'args', name: 'ssh_key' },
    ],
    tools: {
      upload: {
        enabled: true,
        fileStaging: { enabled: true, inputParams: ['localPath'] },
      },
    },
  },
});

const enableStaging = () => {
  mockGetFileStagingSettings.mockResolvedValue({
    enabled: true,
    maxFileBytes: 104857600,
    inlineMaxBytes: 1048576,
    perUserQuotaBytes: 1073741824,
  } as any);
  const createReadyRef = jest.fn(async () => ({
    ref: 'mcpfile://aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    state: 'ready',
    size: 1,
  }));
  mockGetStagingStateStore.mockResolvedValue({ createReadyRef } as any);
  return createReadyRef;
};

const callUpload = () =>
  mcpService.handleCallToolRequest(
    {
      params: {
        name: 'mcphub_file_upload',
        arguments: { filename: 'a.txt', content_base64: 'YQ==' },
      },
    },
    { sessionId: 's1' },
  );

describe('hub staging tools at the public MCP entry points', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFileStagingSettings.mockResolvedValue({ enabled: false } as any);
  });

  afterEach(() => {
    mcpService.setServerInfosForTest([]);
  });

  it('answers a reserved hub name without touching an upstream client', async () => {
    const result = await mcpService.handleCallToolRequest(
      { params: { name: 'mcphub_file_status', arguments: { ref: 'mcpfile://x' } } },
      { sessionId: 's1' },
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not enabled/i);
    expect(mockGetSystemConfig).not.toHaveBeenCalled();
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it('rejects a reserved hub name smuggled through a nested call_tool', async () => {
    const result = await mcpService.handleCallToolRequest(
      {
        params: {
          name: 'call_tool',
          arguments: { toolName: 'mcphub_file_upload', arguments: { filename: 'a.txt' } },
        },
      },
      { sessionId: 's1' },
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/cannot be called through call_tool/i);
    expect(mockGetSystemConfig).not.toHaveBeenCalled();
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it('does not advertise hub tools on a $smart route when staging is disabled', async () => {
    const listed = await mcpService.handleListToolsRequest({}, { sessionId: 's1' });
    expect(listed.tools.some((tool: any) => tool.name.startsWith('mcphub_file_'))).toBe(false);
  });

  it('resolves a shared credential server before its per-user runtime reports a version', async () => {
    const createReadyRef = enableStaging();
    mcpService.setServerInfosForTest([makeSshStagingServer(undefined)]);

    const result = await callUpload();

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('mcpfile://');
    expect(createReadyRef).toHaveBeenCalledTimes(1);
  });

  it('does not resolve a connected shared server whose reported version is not pinned', async () => {
    // Target resolution only; dispatch.test.ts covers the call-time version check.
    const createReadyRef = enableStaging();
    mcpService.setServerInfosForTest([makeSshStagingServer('1.11.1')]);

    const result = await callUpload();

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no staging-enabled/i);
    expect(createReadyRef).not.toHaveBeenCalled();
  });

  it('does not resolve a non-credential server before it reports a version', async () => {
    const createReadyRef = enableStaging();
    const server = makeSshStagingServer(undefined);
    server.name = 'plain-ssh';
    server.visibility = 'private';
    server.owner = 'alice';
    server.config.visibility = 'private';
    server.config.staging = { adapter: 'ssh' };
    server.config.credentialTemplate = undefined;
    server.config.startOnDemand = true;
    mcpService.setServerInfosForTest([server]);

    const result = await callUpload();

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no staging-enabled/i);
    expect(createReadyRef).not.toHaveBeenCalled();
  });

  it('lists the hub tools on a $smart route when a staging target exists', async () => {
    enableStaging();
    mcpService.setServerInfosForTest([makeSshStagingServer(undefined)]);

    const listed = await mcpService.handleListToolsRequest({}, { sessionId: 's1' });
    const names = listed.tools.map((tool: any) => tool.name);

    // The route is a $smart route in this harness, so the meta-tools and the
    // hub built-ins must both be present.
    expect(names).toContain('mcphub_file_upload');
    expect(names).toContain('mcphub_file_request_upload');
    expect((listed as { stagingTools?: boolean }).stagingTools).toBe(true);
  });
});
