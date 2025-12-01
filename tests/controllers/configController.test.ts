import { getMcpSettingsJson } from '../../src/controllers/configController.js';
import * as config from '../../src/config/index.js';
import * as DaoFactory from '../../src/dao/DaoFactory.js';
import { Request, Response } from 'express';

// Mock the config module
jest.mock('../../src/config/index.js');
// Mock the DaoFactory module
jest.mock('../../src/dao/DaoFactory.js');

describe('ConfigController - getMcpSettingsJson', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockServerDao: { findById: jest.Mock };

  beforeEach(() => {
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
    };

    // Setup ServerDao mock
    (DaoFactory.getServerDao as jest.Mock).mockReturnValue(mockServerDao);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('Full Settings Export', () => {
    it('should handle settings without users array', async () => {
      const mockSettings = {
        mcpServers: {
          'test-server': {
            command: 'test',
            args: ['--test'],
          },
        },
      };

      (config.loadOriginalSettings as jest.Mock).mockReturnValue(mockSettings);

      await getMcpSettingsJson(mockRequest as Request, mockResponse as Response);

      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data: {
          mcpServers: mockSettings.mcpServers,
          users: undefined,
        },
      });
    });
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
      const errorMessage = 'Failed to load settings';
      (config.loadOriginalSettings as jest.Mock).mockImplementation(() => {
        throw new Error(errorMessage);
      });

      await getMcpSettingsJson(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get MCP settings',
      });
    });
  });
});
