import { getMcpSettingsJson } from '../../src/controllers/configController.js';
import * as DaoFactory from '../../src/dao/DaoFactory.js';
import { Request, Response } from 'express';

jest.mock('../../src/dao/DaoFactory.js');

describe('ConfigController - getMcpSettingsJson', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockServerDao: { findById: jest.Mock; findAll: jest.Mock };
  let mockUserDao: { findAll: jest.Mock };
  let mockGroupDao: { findAll: jest.Mock };
  let mockSystemConfigDao: { get: jest.Mock };
  let mockUserConfigDao: { getAll: jest.Mock };
  let mockOAuthClientDao: { findAll: jest.Mock };
  let mockOAuthTokenDao: { findAll: jest.Mock };
  let mockBearerKeyDao: { findAll: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();
    mockRequest = {
      query: {},
    };
    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockServerDao = {
      findById: jest.fn(),
      findAll: jest.fn(),
    };
    mockUserDao = { findAll: jest.fn() };
    mockGroupDao = { findAll: jest.fn() };
    mockSystemConfigDao = { get: jest.fn() };
    mockUserConfigDao = { getAll: jest.fn() };
    mockOAuthClientDao = { findAll: jest.fn() };
    mockOAuthTokenDao = { findAll: jest.fn() };
    mockBearerKeyDao = { findAll: jest.fn() };

    // Wire DaoFactory convenience functions to our mocks
    (DaoFactory.getServerDao as unknown as jest.Mock).mockReturnValue(mockServerDao);
    (DaoFactory.getUserDao as unknown as jest.Mock).mockReturnValue(mockUserDao);
    (DaoFactory.getGroupDao as unknown as jest.Mock).mockReturnValue(mockGroupDao);
    (DaoFactory.getSystemConfigDao as unknown as jest.Mock).mockReturnValue(mockSystemConfigDao);
    (DaoFactory.getUserConfigDao as unknown as jest.Mock).mockReturnValue(mockUserConfigDao);
    (DaoFactory.getOAuthClientDao as unknown as jest.Mock).mockReturnValue(mockOAuthClientDao);
    (DaoFactory.getOAuthTokenDao as unknown as jest.Mock).mockReturnValue(mockOAuthTokenDao);
    (DaoFactory.getBearerKeyDao as unknown as jest.Mock).mockReturnValue(mockBearerKeyDao);
  });

  describe('Individual Server Export', () => {
    it('should return individual server configuration when serverName is specified', async () => {
      const serverConfig = {
        name: 'test-server',
        command: 'test',
        args: ['--test'],
        env: {
          TEST_VAR: 'test-value',
        },
      };

      mockRequest.query = { serverName: 'test-server' };
      mockServerDao.findById.mockResolvedValue(serverConfig);

      await getMcpSettingsJson(mockRequest as Request, mockResponse as Response);

      expect(mockServerDao.findById).toHaveBeenCalledWith('test-server');
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data: {
          mcpServers: {
            'test-server': {
              command: 'test',
              args: ['--test'],
              env: {
                TEST_VAR: 'test-value',
              },
            },
          },
        },
      });
    });

    it('should return 404 when server does not exist', async () => {
      mockRequest.query = { serverName: 'non-existent-server' };
      mockServerDao.findById.mockResolvedValue(null);

      await getMcpSettingsJson(mockRequest as Request, mockResponse as Response);

      expect(mockServerDao.findById).toHaveBeenCalledWith('non-existent-server');
      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        message: "Server 'non-existent-server' not found",
      });
    });

    it('should remove null values from server configuration', async () => {
      const serverConfig = {
        name: 'test-server',
        command: 'test',
        args: ['--test'],
        url: null,
        env: null,
        headers: null,
        options: {
          timeout: 30,
          retries: null,
        },
      };

      mockRequest.query = { serverName: 'test-server' };
      mockServerDao.findById.mockResolvedValue(serverConfig);

      await getMcpSettingsJson(mockRequest as Request, mockResponse as Response);

      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data: {
          mcpServers: {
            'test-server': {
              command: 'test',
              args: ['--test'],
              options: {
                timeout: 30,
              },
            },
          },
        },
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully and return 500', async () => {
      mockServerDao.findAll.mockRejectedValue(new Error('boom'));
      mockUserDao.findAll.mockResolvedValue([]);
      mockGroupDao.findAll.mockResolvedValue([]);
      mockSystemConfigDao.get.mockResolvedValue({});
      mockUserConfigDao.getAll.mockResolvedValue({});
      mockOAuthClientDao.findAll.mockResolvedValue([]);
      mockOAuthTokenDao.findAll.mockResolvedValue([]);
      mockBearerKeyDao.findAll.mockResolvedValue([]);

      await getMcpSettingsJson(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get MCP settings',
      });
    });
  });
});
