import type { Request, Response } from 'express';

const mockGetSmartRoutingConfig = jest.fn();
const mockGetDatabaseHealth = jest.fn();
const mockIsDatabaseConnected = jest.fn();
const mockInitializeDatabase = jest.fn();
const mockGetAppDataSource = jest.fn();
const mockSaveToolsAsVectorEmbeddings = jest.fn();
const mockGetServersInfo = jest.fn();

jest.mock('../../src/utils/smartRouting.js', () => ({
  getSmartRoutingConfig: mockGetSmartRoutingConfig,
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
      connectedServers: 1,
      indexedServers: 1,
      missingIndexServerCount: 0,
      missingIndexServers: [],
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
});

describe('reindexSmartRouting', () => {
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
      { name: 'down', status: 'error', enabled: true, tools: [{ name: 'c' }] },
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
      totalTools: 2,
      results: [
        { serverName: 'fetch', toolCount: 1, ok: true },
        { serverName: 'timeout', toolCount: 1, ok: true },
      ],
    });
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
