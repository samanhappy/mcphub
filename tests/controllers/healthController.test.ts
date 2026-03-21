import { Request, Response } from 'express';

const mockGetServerConnectionStats = jest.fn();
const mockGetDatabaseHealth = jest.fn();

jest.mock('../../src/services/mcpService.js', () => ({
  getServerConnectionStats: jest.fn(() => mockGetServerConnectionStats()),
}));

jest.mock('../../src/db/connection.js', () => ({
  getDatabaseHealth: jest.fn(() => mockGetDatabaseHealth()),
}));

import { healthCheck } from '../../src/controllers/healthController.js';

describe('healthController', () => {
  const originalUseDb = process.env.USE_DB;
  const originalDbUrl = process.env.DB_URL;

  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    if (originalUseDb === undefined) {
      delete process.env.USE_DB;
    } else {
      process.env.USE_DB = originalUseDb;
    }

    if (originalDbUrl === undefined) {
      delete process.env.DB_URL;
    } else {
      process.env.DB_URL = originalDbUrl;
    }

    mockRequest = {};
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();
    mockResponse = {
      status: mockStatus,
      json: mockJson,
    };

    mockGetServerConnectionStats.mockReturnValue({
      total: 0,
      connected: 0,
      disconnected: 0,
    });
    mockGetDatabaseHealth.mockReturnValue({
      connected: true,
      healthy: true,
      lastError: null,
      reconnecting: false,
    });
  });

  afterAll(() => {
    if (originalUseDb === undefined) {
      delete process.env.USE_DB;
    } else {
      process.env.USE_DB = originalUseDb;
    }

    if (originalDbUrl === undefined) {
      delete process.env.DB_URL;
    } else {
      process.env.DB_URL = originalDbUrl;
    }
  });

  it('returns healthy when all enabled servers are connected', () => {
    mockGetServerConnectionStats.mockReturnValue({
      total: 3,
      connected: 3,
      disconnected: 0,
    });

    healthCheck(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'healthy',
        message: 'All enabled MCP servers are ready',
        servers: {
          total: 3,
          connected: 3,
          disconnected: 0,
        },
        timestamp: expect.any(String),
      }),
    );
  });

  it('returns degraded when some enabled servers are disconnected', () => {
    mockGetServerConnectionStats.mockReturnValue({
      total: 3,
      connected: 2,
      disconnected: 1,
    });

    healthCheck(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
        message: 'Some enabled MCP servers are not ready',
        servers: {
          total: 3,
          connected: 2,
          disconnected: 1,
        },
        timestamp: expect.any(String),
      }),
    );
  });

  it('returns unhealthy when database mode is enabled and database health fails', () => {
    process.env.USE_DB = 'true';
    mockGetServerConnectionStats.mockReturnValue({
      total: 2,
      connected: 2,
      disconnected: 0,
    });
    mockGetDatabaseHealth.mockReturnValue({
      connected: false,
      healthy: false,
      lastError: 'Database not initialized',
      reconnecting: false,
    });

    healthCheck(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(503);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unhealthy',
        message: 'Database not initialized',
        servers: {
          total: 2,
          connected: 2,
          disconnected: 0,
        },
        timestamp: expect.any(String),
      }),
    );
  });

  it('returns unhealthy on internal error', () => {
    mockGetServerConnectionStats.mockImplementation(() => {
      throw new Error('Internal test error');
    });

    healthCheck(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(503);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unhealthy',
        message: 'Internal server error during health check',
        timestamp: expect.any(String),
      }),
    );
  });
});