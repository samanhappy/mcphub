/**
 * Per-tool / per-server file-staging PATCH endpoints (#1056, design §9.5, R13).
 *
 * Drives the real controller: authorization (owner-or-admin, admin-only
 * `shared`), validation (normalize + server consistency) and persistence.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';

const serverRow: any = {};

const controllerServerDao = {
  findById: jest.fn(async (name: string) => (name === 'sftp' ? serverRow : undefined)),
  updateTools: jest.fn(async (_name: string, tools: any) => {
    serverRow.tools = tools;
    return true;
  }),
  update: jest.fn(async (_name: string, updates: any) => {
    Object.assign(serverRow, updates);
    return serverRow;
  }),
};

const liveServer: any = { name: 'sftp', tools: [], config: {} };
const mockGetServerByName = jest.fn((name: string) => (name === 'sftp' ? liveServer : undefined));
const mockBroadcastToolListChanged = jest.fn();

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
jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: jest.fn(async () => []),
  getServerToolsForPrincipal: jest.fn(async () => []),
  addServer: jest.fn(),
  addOrUpdateServer: jest.fn(),
  removeServer: jest.fn(),
  closeServer: jest.fn(),
  getServerByName: (name: string) => mockGetServerByName(name),
  notifyToolChanged: jest.fn().mockResolvedValue(undefined),
  broadcastToolListChanged: () => mockBroadcastToolListChanged(),
  broadcastPromptListChanged: jest.fn(),
  broadcastResourceListChanged: jest.fn(),
  syncToolEmbedding: jest.fn(),
  toggleServerStatus: jest.fn(),
  reconnectServer: jest.fn().mockResolvedValue(undefined),
  waitForServerConnect: jest.fn(async () => true),
  reinstallServer: jest.fn(),
  updateServerInfoVisibility: jest.fn(),
}));

import {
  updateServerStaging,
  updateToolFileStaging,
} from '../../src/controllers/serverController.js';

const mockRes = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as any,
    json: jest.fn().mockReturnThis() as any,
  };
  return res as Response;
};

const request = (
  body: unknown,
  user: { username: string; isAdmin?: boolean } = { username: 'alice', isAdmin: false },
  name = 'sftp',
) =>
  ({
    params: { name },
    body,
    user,
  }) as unknown as Request;

const responseBody = (res: Response) =>
  (res.json as jest.Mock).mock.calls.at(-1)?.[0] as Record<string, unknown>;

const resetServer = (overrides: Record<string, unknown> = {}) => {
  Object.keys(serverRow).forEach((key) => delete serverRow[key]);
  Object.assign(serverRow, {
    name: 'sftp',
    owner: 'alice',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '{{args.ssh_host}}'],
    credentialTemplate: [{ target: 'args', name: 'ssh_host' }],
    staging: { adapter: 'ssh' },
    tools: {
      upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
    },
    ...overrides,
  });
  liveServer.config = JSON.parse(JSON.stringify(serverRow));
  // Runtime fields leak between tests otherwise; a stale error would make the
  // restart check report a failure that this test never produced.
  liveServer.status = 'connected';
  liveServer.error = null;
};

describe('updateToolFileStaging (PATCH /servers/:name/file-staging)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServer();
  });

  it('lets the owner disable a tool without losing its declared params', async () => {
    const res = mockRes();
    let reconnectSnapshot: any;
    const { reconnectServer: mockedReconnect } = await import('../../src/services/mcpService.js');
    (mockedReconnect as jest.Mock).mockImplementationOnce(async () => {
      reconnectSnapshot = JSON.parse(JSON.stringify(liveServer.config));
    });

    await updateToolFileStaging(request({ tool: 'upload', enabled: false }), res);

    expect(controllerServerDao.updateTools).toHaveBeenCalledWith('sftp', {
      upload: { enabled: true, fileStaging: { enabled: false, inputParams: ['localPath'] } },
    });
    expect(mockBroadcastToolListChanged).toHaveBeenCalledTimes(1);
    expect(responseBody(res)).toEqual({
      success: true,
      data: { enabled: true, fileStaging: { enabled: false, inputParams: ['localPath'] } },
    });
    // The child is rebuilt before the live config advertises the change, so no
    // call is dispatched to a child that still runs in the old cwd.
    expect(mockedReconnect).toHaveBeenCalledWith('sftp');
    // The old child is closed while the live config still says "staged", so a
    // call arriving during the reconnect cannot reach a hub-cwd child.
    expect(reconnectSnapshot?.tools.upload.fileStaging?.enabled).toBe(true);
    expect(liveServer.config.tools.upload.fileStaging).toEqual({
      enabled: false,
      inputParams: ['localPath'],
    });
  });

  it('reports a spawn failure the reconnect swallowed', async () => {
    // `initializeClientsFromSettings` records the failure on the entry instead
    // of throwing, so a resolved reconnect is not proof the child started.
    const { reconnectServer: mockedReconnect } = await import('../../src/services/mcpService.js');
    (mockedReconnect as jest.Mock).mockImplementationOnce(async () => {
      liveServer.status = 'disconnected';
      liveServer.error = 'File staging principal is unavailable';
    });
    const res = mockRes();

    await updateToolFileStaging(request({ tool: 'upload', enabled: false }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    // The raw runtime error is not echoed back to a non-admin owner; the route
    // only reports that the restart did not succeed.
    expect(responseBody(res)).toMatchObject({
      success: false,
      message: 'Saved, but the server did not start with the new staging setting',
    });
  });

  it('reports a restart failure instead of claiming the change is live', async () => {
    const { reconnectServer } = await import('../../src/services/mcpService.js');
    (reconnectServer as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const res = mockRes();

    await updateToolFileStaging(request({ tool: 'upload', enabled: false }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(responseBody(res)).toMatchObject({ success: false });
    // The stale live config is not published when the restart failed.
    expect(liveServer.config.tools.upload.fileStaging?.enabled).toBe(true);
  });

  it('rejects a non-owner', async () => {
    const res = mockRes();

    await updateToolFileStaging(
      request({ tool: 'upload', enabled: false }, { username: 'bob', isAdmin: false }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(controllerServerDao.updateTools).not.toHaveBeenCalled();
  });

  it('rejects invalid params with 400', async () => {
    const res = mockRes();

    await updateToolFileStaging(request({ tool: 'upload', enabled: true, inputParams: [] }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(String(responseBody(res).message)).toContain('non-empty array');
    expect(controllerServerDao.updateTools).not.toHaveBeenCalled();
  });

  it('rejects enabling staging without a server adapter', async () => {
    resetServer({ staging: undefined });
    const res = mockRes();

    await updateToolFileStaging(
      request({ tool: 'download', enabled: true, outputParams: ['dest'] }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(String(responseBody(res).message)).toContain('staging.adapter');
    expect(controllerServerDao.updateTools).not.toHaveBeenCalled();
  });

  it('rejects an unknown server with 404', async () => {
    const res = mockRes();

    await updateToolFileStaging(
      request({ tool: 'upload', enabled: false }, { username: 'alice' }, 'missing'),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('updateServerStaging (PATCH /servers/:name/staging)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServer();
  });

  it('lets the owner declare the adapter', async () => {
    resetServer({ staging: undefined });
    const res = mockRes();

    await updateServerStaging(request({ adapter: 'ssh' }), res);

    expect(controllerServerDao.update).toHaveBeenCalledWith('sftp', {
      staging: { adapter: 'ssh' },
    });
    expect(responseBody(res)).toEqual({ success: true, data: { adapter: 'ssh' } });
    expect(mockBroadcastToolListChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-owner', async () => {
    const res = mockRes();

    await updateServerStaging(
      request({ adapter: 'ssh' }, { username: 'bob', isAdmin: false }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(controllerServerDao.update).not.toHaveBeenCalled();
  });

  it('rejects the shared flag for a non-admin, even for the owner', async () => {
    const res = mockRes();

    await updateServerStaging(request({ shared: true, adapter: 'ssh' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(controllerServerDao.update).not.toHaveBeenCalled();
  });

  it('lets an admin enable shared staging when credential slots exist', async () => {
    const res = mockRes();

    await updateServerStaging(
      request({ shared: true, adapter: 'ssh' }, { username: 'admin', isAdmin: true }),
      res,
    );

    expect(controllerServerDao.update).toHaveBeenCalledWith('sftp', {
      staging: { shared: true, adapter: 'ssh' },
    });
    expect(responseBody(res)).toEqual({
      success: true,
      data: { shared: true, adapter: 'ssh' },
    });
  });

  it('reports a spawn failure for the server-level staging edit too', async () => {
    const { reconnectServer: mockedReconnect } = await import('../../src/services/mcpService.js');
    (mockedReconnect as jest.Mock).mockImplementationOnce(async () => {
      liveServer.status = 'disconnected';
      liveServer.error = 'Failed to connect: spawn npx ENOENT';
    });
    const res = mockRes();

    await updateServerStaging(request({ adapter: 'ssh' }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(responseBody(res)).toMatchObject({ success: false });
  });

  it('rejects an unknown adapter with 400', async () => {
    const res = mockRes();

    await updateServerStaging(request({ adapter: 'filesystem' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(String(responseBody(res).message)).toContain('staging.adapter');
    expect(controllerServerDao.update).not.toHaveBeenCalled();
  });

  it('rejects an empty body with 400', async () => {
    const res = mockRes();

    await updateServerStaging(request({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(controllerServerDao.update).not.toHaveBeenCalled();
  });
});
