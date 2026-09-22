import type { Request, Response } from 'express';

const mockGetSmartRoutingConfig = jest.fn();
const mockGetDatabaseHealth = jest.fn();
const mockIsDatabaseConnected = jest.fn();
const mockInitializeDatabase = jest.fn();
const mockGetAppDataSource = jest.fn();
const mockSaveToolsAsVectorEmbeddings = jest.fn();
const mockGetServersInfo = jest.fn();
const mockGetServerToolsForPrincipal = jest.fn();
const mockListBindingUsernames = jest.fn();
const mockFindUserByUsername = jest.fn();
const mockRequireAdmin = jest.fn();

jest.mock('../../src/utils/smartRouting.js', () => ({
  getSmartRoutingConfig: mockGetSmartRoutingConfig,
}));

jest.mock('../../src/utils/requireAdmin.js', () => ({
  requireAdmin: mockRequireAdmin,
}));

jest.mock('../../src/db/connection.js', () => ({
  getDatabaseHealth: mockGetDatabaseHealth,
  isDatabaseConnected: mockIsDatabaseConnected,
  initializeDatabase: mockInitializeDatabase,
  getAppDataSource: mockGetAppDataSource,
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  saveToolsAsVectorEmbeddings: mockSaveToolsAsVectorEmbeddings,
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: mockGetServersInfo,
  getServerToolsForPrincipal: mockGetServerToolsForPrincipal,
}));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: () => ({ listUsernames: mockListBindingUsernames }),
  getUserDao: () => ({ findByUsername: mockFindUserByUsername }),
}));

import {
  getSmartRoutingPerformance,
  reindexSmartRouting,
} from '../../src/controllers/smartRoutingController.js';

const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const baseConfig = {
  enabled: true,
  dbUrl: 'postgres://user:pass@localhost:5432/mcphub',
  embeddingProvider: 'openai' as const,
  llmProviderBaseUrl: '',
  llmProviderApiKey: '',
  embeddingModel: 'text-embedding-3-small',
};

const defaultServer = {
  name: 'fetch',
  status: 'connected' as const,
  enabled: true,
  tools: [{ name: 'fetch_html', description: 'Fetch HTML' }],
};

const credentialTemplate = [{ target: 'headers', name: 'Authorization' }];

const defaultDatabaseHealth = { connected: true, healthy: true, lastError: null };

const mockDataSourceQuery = jest.fn();
const mockDataSource = { query: mockDataSourceQuery };

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.DB_URL;
  mockGetSmartRoutingConfig.mockResolvedValue({ ...baseConfig });
  mockGetDatabaseHealth.mockReturnValue({ ...defaultDatabaseHealth });
  mockIsDatabaseConnected.mockReturnValue(true);
  mockInitializeDatabase.mockResolvedValue(undefined);
  mockGetAppDataSource.mockReturnValue(mockDataSource);
  mockSaveToolsAsVectorEmbeddings.mockResolvedValue(undefined);
  mockGetServersInfo.mockResolvedValue([defaultServer]);
  mockGetServerToolsForPrincipal.mockResolvedValue([]);
  mockListBindingUsernames.mockResolvedValue([]);
  mockFindUserByUsername.mockResolvedValue(null);
  mockRequireAdmin.mockResolvedValue(true);
});

// Mirrors the real gate: writes 403 and reports denial to the caller.
const denyAdmin = () =>
  mockRequireAdmin.mockImplementation(async (_req: Request, res: Response) => {
    res.status(403).json({ success: false, message: 'Admin privileges required' });
    return false;
  });

describe('getSmartRoutingPerformance', () => {
  const setupVectorRows = () => {
    mockDataSourceQuery
      .mockResolvedValueOnce([
        {
          tool_rows: 2,
          server_rows: 1,
          total_rows: 3,
          distinct_servers: '1',
        },
      ])
      .mockResolvedValueOnce([
        { model: 'text-embedding-3-small', tool_count: 2, server_count: 1 },
      ])
      .mockResolvedValueOnce([
        { server_name: 'fetch', tool_count: 2 },
      ])
      .mockResolvedValueOnce([{ oldest: '2026-01-01T00:00:00.000Z', newest: '2026-01-02T00:00:00.000Z' }])
      .mockResolvedValueOnce([{ dimensions: 1536 }]);
  };

  it('reports the disabled state without touching the database', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({ ...baseConfig, enabled: false, dbUrl: '' });
    const res = mockRes();
    await getSmartRoutingPerformance({} as Request, res);

    expect(mockDataSourceQuery).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.enabled).toBe(false);
    expect(payload.data.vectorStore.available).toBe(false);
    expect(payload.data.database.connected).toBe(true);
  });

  it('returns vector store stats when smart routing is enabled and DB is connected', async () => {
    setupVectorRows();
    const res = mockRes();
    await getSmartRoutingPerformance({} as Request, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(payload.data.config).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      configuredDimensions: null,
    });
    expect(payload.data.vectorStore).toMatchObject({
      available: true,
      totalRows: 3,
      toolRows: 2,
      serverRows: 1,
      distinctServers: 1,
      dimensions: 1536,
      byModel: [{ model: 'text-embedding-3-small', toolCount: 2, serverCount: 1 }],
      byServer: [{ serverName: 'fetch', toolCount: 2 }],
    });
    expect(payload.data.coverage).toEqual({
      totalServers: 1,
      connectedServers: 1,
      personalCredentialServers: 0,
      indexedServers: 1,
      missingIndexServerCount: 0,
      missingIndexServers: [],
    });
  });

  it('counts personal-credential servers in coverage even while disconnected', async () => {
    setupVectorRows();
    mockGetServersInfo.mockResolvedValue([
      defaultServer,
      {
        name: 'private-api',
        status: 'disconnected',
        enabled: true,
        tools: [],
        config: { credentialTemplate },
      },
    ]);
    const res = mockRes();
    await getSmartRoutingPerformance({} as Request, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.coverage).toEqual({
      totalServers: 2,
      connectedServers: 1,
      personalCredentialServers: 1,
      indexedServers: 1,
      missingIndexServerCount: 1,
      missingIndexServers: ['private-api'],
    });
  });

  it('initializes the database when it is not connected yet', async () => {
    mockIsDatabaseConnected.mockReturnValue(false);
    setupVectorRows();
    const res = mockRes();
    await getSmartRoutingPerformance({} as Request, res);

    expect(mockIsDatabaseConnected).toHaveBeenCalledTimes(2);
    expect(mockInitializeDatabase).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it('reports unavailable vector store when DB queries fail', async () => {
    mockDataSourceQuery.mockRejectedValue(new Error('pg timer cache is empty'));
    const res = mockRes();
    await getSmartRoutingPerformance({} as Request, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.vectorStore.available).toBe(false);
  });

  it('responds 500 when config resolution throws', async () => {
    mockGetSmartRoutingConfig.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await getSmartRoutingPerformance({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('rejects non-admin callers without touching the database', async () => {
    denyAdmin();
    const res = mockRes();
    await getSmartRoutingPerformance({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Admin privileges required',
    });
    expect(mockDataSourceQuery).not.toHaveBeenCalled();
    expect(mockGetServersInfo).not.toHaveBeenCalled();
  });
});

describe('reindexSmartRouting', () => {
  it('rejects non-admin callers without clearing the index', async () => {
    denyAdmin();
    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockDataSourceQuery).not.toHaveBeenCalled();
    expect(mockSaveToolsAsVectorEmbeddings).not.toHaveBeenCalled();
  });

  it('rejects a second pass while one is already running', async () => {
    mockDataSourceQuery.mockResolvedValue([]); // DELETE
    mockGetServersInfo.mockResolvedValue([
      { name: 'fetch', status: 'connected', enabled: true, tools: [{ name: 'a' }] },
    ]);
    let releaseWrite: () => void = () => {};
    mockSaveToolsAsVectorEmbeddings.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );

    const firstRes = mockRes();
    const firstPass = reindexSmartRouting({} as Request, firstRes);
    // Let the first pass reach the embedding write before racing it.
    await new Promise((resolve) => setImmediate(resolve));

    const secondRes = mockRes();
    await reindexSmartRouting({} as Request, secondRes);

    expect(secondRes.status).toHaveBeenCalledWith(409);
    expect(secondRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'A reindex pass is already running',
    });
    expect(mockDataSourceQuery).toHaveBeenCalledTimes(1);
    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(1);

    releaseWrite();
    await firstPass;
    expect(firstRes.json.mock.calls[0][0].success).toBe(true);
  });

  it('accepts a new pass once the previous one finished', async () => {
    mockDataSourceQuery.mockResolvedValue([]); // DELETE
    mockGetServersInfo.mockResolvedValue([
      { name: 'fetch', status: 'connected', enabled: true, tools: [{ name: 'a' }] },
    ]);

    await reindexSmartRouting({} as Request, mockRes());
    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it('releases the guard when a pass fails', async () => {
    mockGetSmartRoutingConfig.mockRejectedValueOnce(new Error('boom'));
    const failed = mockRes();
    await reindexSmartRouting({} as Request, failed);
    expect(failed.status).toHaveBeenCalledWith(500);

    mockGetSmartRoutingConfig.mockResolvedValue({ ...baseConfig });
    mockDataSourceQuery.mockResolvedValue([]);
    mockGetServersInfo.mockResolvedValue([
      { name: 'fetch', status: 'connected', enabled: true, tools: [{ name: 'a' }] },
    ]);
    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it('rejects when smart routing is disabled', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({ ...baseConfig, enabled: false });
    const res = mockRes();
    await reindexSmartRouting({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockDataSourceQuery).not.toHaveBeenCalled();
  });

  it('rejects when no DB URL is configured', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({ ...baseConfig, dbUrl: '' });
    const res = mockRes();
    await reindexSmartRouting({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('clears all embeddings then rebuilds every connected server', async () => {
    mockDataSourceQuery.mockResolvedValueOnce([]); // DELETE
    mockGetServersInfo.mockResolvedValue([
      { name: 'fetch', status: 'connected', enabled: true, tools: [{ name: 'a' }] },
      { name: 'timeout', status: 'connected', enabled: true, tools: [{ name: 'b' }] },
    ]);
    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    expect(mockDataSourceQuery).toHaveBeenCalledWith('DELETE FROM vector_embeddings');
    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledTimes(2);
    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledWith(
      'fetch',
      [{ name: 'a' }],
      { reportProgress: true },
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({
      syncedServers: 2,
      failedServers: 0,
      skippedServers: 0,
      totalTools: 2,
      results: [
        { serverName: 'fetch', toolCount: 1, ok: true },
        { serverName: 'timeout', toolCount: 1, ok: true },
      ],
    });
  });

  it('indexes a personal-credential server on behalf of its binding users', async () => {
    mockDataSourceQuery.mockResolvedValueOnce([]); // DELETE
    mockGetServersInfo.mockResolvedValue([
      {
        name: 'private-api',
        status: 'disconnected',
        enabled: true,
        tools: [],
        config: { credentialTemplate, owner: 'alice' },
      },
    ]);
    mockListBindingUsernames.mockResolvedValue(['bob', 'alice']);
    mockFindUserByUsername.mockImplementation(async (username: string) => ({
      username,
      isAdmin: username === 'alice',
    }));
    mockGetServerToolsForPrincipal.mockImplementation(
      async (_server: string, principal: { username: string }) =>
        principal.username === 'alice'
          ? [
              { name: 'shared-tool' },
              { name: 'admin-only-tool' },
            ]
          : [{ name: 'shared-tool' }],
    );

    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    // Owner binding is tried first, and the union of both principals is indexed.
    expect(mockGetServerToolsForPrincipal).toHaveBeenNthCalledWith(
      1,
      'private-api',
      expect.objectContaining({ username: 'alice', isAdmin: true }),
    );
    expect(mockGetServerToolsForPrincipal).toHaveBeenNthCalledWith(
      2,
      'private-api',
      expect.objectContaining({ username: 'bob', isAdmin: false }),
    );
    expect(mockSaveToolsAsVectorEmbeddings).toHaveBeenCalledWith(
      'private-api',
      [{ name: 'shared-tool' }, { name: 'admin-only-tool' }],
      { reportProgress: true },
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toMatchObject({
      syncedServers: 1,
      failedServers: 0,
      skippedServers: 0,
      totalTools: 2,
    });
    expect(payload.data.results[0]).toEqual({
      serverName: 'private-api',
      toolCount: 2,
      ok: true,
      principals: ['alice', 'bob'],
    });
  });

  it('skips a personal-credential server nobody bound credentials for', async () => {
    mockDataSourceQuery.mockResolvedValueOnce([]); // DELETE
    mockGetServersInfo.mockResolvedValue([
      {
        name: 'private-api',
        status: 'disconnected',
        enabled: true,
        tools: [],
        config: { credentialTemplate },
      },
    ]);
    mockListBindingUsernames.mockResolvedValue([]);

    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    expect(mockGetServerToolsForPrincipal).not.toHaveBeenCalled();
    expect(mockSaveToolsAsVectorEmbeddings).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.skippedServers).toBe(1);
    expect(payload.data.results[0]).toMatchObject({
      serverName: 'private-api',
      skipped: true,
      ok: false,
    });
  });

  it('reports a personal-credential server as failed when no principal resolves tools', async () => {
    mockDataSourceQuery.mockResolvedValueOnce([]); // DELETE
    mockGetServersInfo.mockResolvedValue([
      {
        name: 'private-api',
        status: 'disconnected',
        enabled: true,
        tools: [],
        config: { credentialTemplate },
      },
    ]);
    mockListBindingUsernames.mockResolvedValue(['bob']);
    mockFindUserByUsername.mockResolvedValue({ username: 'bob', isAdmin: false });
    mockGetServerToolsForPrincipal.mockRejectedValue(
      new Error("Unable to connect 'private-api' with your personal credentials."),
    );

    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.failedServers).toBe(1);
    expect(payload.data.skippedServers).toBe(0);
    expect(payload.data.results[0]).toMatchObject({
      serverName: 'private-api',
      ok: false,
      principals: [],
    });
    expect(payload.data.results[0].error).toContain('personal credentials');
  });

  it('reports disconnected servers as skipped instead of dropping them silently', async () => {
    mockDataSourceQuery.mockResolvedValueOnce([]); // DELETE
    mockGetServersInfo.mockResolvedValue([
      { name: 'fetch', status: 'connected', enabled: true, tools: [{ name: 'a' }] },
      { name: 'down', status: 'error', enabled: true, tools: [{ name: 'c' }] },
    ]);

    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.syncedServers).toBe(1);
    expect(payload.data.skippedServers).toBe(1);
    expect(payload.data.results[1]).toMatchObject({
      serverName: 'down',
      skipped: true,
      ok: false,
    });
    expect(payload.data.results[1].error).toContain('not connected');
  });

  it('ignores disabled servers', async () => {
    mockDataSourceQuery.mockResolvedValueOnce([]); // DELETE
    mockGetServersInfo.mockResolvedValue([
      { name: 'fetch', status: 'connected', enabled: true, tools: [{ name: 'a' }] },
      { name: 'off', status: 'disconnected', enabled: false, tools: [] },
    ]);

    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.results.map((item: any) => item.serverName)).toEqual(['fetch']);
  });

  it('counts per-server failures without aborting the batch', async () => {
    mockDataSourceQuery.mockResolvedValueOnce([]); // DELETE
    mockSaveToolsAsVectorEmbeddings
      .mockRejectedValueOnce(new Error('embedding provider rate limited'))
      .mockResolvedValueOnce(undefined);
    mockGetServersInfo.mockResolvedValue([
      { name: 'fetch', status: 'connected', enabled: true, tools: [{ name: 'a' }] },
      { name: 'timeout', status: 'connected', enabled: true, tools: [{ name: 'b' }] },
    ]);
    const res = mockRes();
    await reindexSmartRouting({} as Request, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.syncedServers).toBe(1);
    expect(payload.data.failedServers).toBe(1);
    expect(payload.data.results[0]).toMatchObject({
      serverName: 'fetch',
      ok: false,
      error: 'embedding provider rate limited',
    });
    expect(payload.data.results[1]).toMatchObject({ serverName: 'timeout', ok: true });
  });

  it('responds 500 when the initial config resolution throws', async () => {
    mockGetSmartRoutingConfig.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await reindexSmartRouting({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
