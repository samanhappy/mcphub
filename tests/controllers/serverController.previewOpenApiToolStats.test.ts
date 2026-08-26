const mockPreviewOpenApiToolStats = jest.fn();

jest.mock('../../src/services/openApiToolStatsService.js', () => ({
  previewOpenApiToolStats: (...args: unknown[]) => mockPreviewOpenApiToolStats(...args),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: jest.fn(),
  addServer: jest.fn(),
  addOrUpdateServer: jest.fn(),
  removeServer: jest.fn(),
  closeServer: jest.fn(),
  getServerByName: jest.fn(),
  notifyToolChanged: jest.fn(),
  broadcastToolListChanged: jest.fn(),
  broadcastPromptListChanged: jest.fn(),
  broadcastResourceListChanged: jest.fn(),
  syncToolEmbedding: jest.fn(),
  toggleServerStatus: jest.fn(),
  reconnectServer: jest.fn(),
  updateServerInfoVisibility: jest.fn(),
}));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: jest.fn(() => ({ findById: jest.fn() })),
  getUserDao: jest.fn(() => ({ findAll: jest.fn() })),
  getGroupDao: jest.fn(() => ({ findAll: jest.fn() })),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn() })),
  getUserConfigDao: jest.fn(() => ({ getAll: jest.fn() })),
  getOAuthClientDao: jest.fn(() => ({ findAll: jest.fn() })),
  getOAuthTokenDao: jest.fn(() => ({ findAll: jest.fn() })),
  getBearerKeyDao: jest.fn(() => ({ findAll: jest.fn() })),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  syncAllServerToolsEmbeddings: jest.fn(),
  removeServerToolEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({
      getCurrentUser: jest.fn(),
    })),
  },
}));

jest.mock('../../src/services/upstreamOAuthDisconnectService.js', () => ({
  disconnectUpstreamOAuth: jest.fn(),
}));

import type { Request, Response } from 'express';
import { previewOpenApiToolStatsHandler } from '../../src/controllers/serverController.js';

const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('previewOpenApiToolStatsHandler', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns tool stats for a valid OpenAPI config', async () => {
    const stats = { toolCount: 684, definitionsBytes: 366457, estimatedTokens: 91600 };
    mockPreviewOpenApiToolStats.mockResolvedValue(stats);

    const req = {
      body: {
        name: 'big-api',
        config: { type: 'openapi', openapi: { url: 'https://example.com/openapi.json' } },
      },
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;
    const res = mockRes();

    await previewOpenApiToolStatsHandler(req, res);

    expect(mockPreviewOpenApiToolStats).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'openapi',
        // The requesting user is assigned as owner so SSRF scoping matches a
        // real add-server request from the same caller.
        owner: 'alice',
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: stats });
  });

  it('rejects requests without a config', async () => {
    const req = { body: {}, user: null } as unknown as Request;
    const res = mockRes();

    await previewOpenApiToolStatsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Server configuration is required' }),
    );
  });

  it('rejects configs without an OpenAPI url or schema', async () => {
    const req = {
      body: { config: { type: 'sse', url: 'https://example.com/sse' } },
      user: null,
    } as unknown as Request;
    const res = mockRes();

    await previewOpenApiToolStatsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'OpenAPI specification URL or schema is required',
      }),
    );
    expect(mockPreviewOpenApiToolStats).not.toHaveBeenCalled();
  });

  it('maps spec analysis failures to a 400 with the underlying message', async () => {
    mockPreviewOpenApiToolStats.mockRejectedValue(new Error('Failed to load OpenAPI specification'));

    const req = {
      body: {
        config: { type: 'openapi', openapi: { url: 'https://example.com/broken.json' } },
      },
      user: null,
    } as unknown as Request;
    const res = mockRes();

    await previewOpenApiToolStatsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Failed to load OpenAPI specification',
    });
  });
});
