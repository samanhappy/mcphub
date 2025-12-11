import { getMcpSettingsJson } from '../../src/controllers/configController.js';
import * as DaoFactory from '../../src/dao/DaoFactory.js';
import { Request, Response } from 'express';

// Mock the DaoFactory module
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

    // Setup ServerDao mock
    (DaoFactory.getServerDao as jest.Mock).mockReturnValue(mockServerDao);
    (DaoFactory.getUserDao as jest.Mock).mockReturnValue(mockUserDao);
    (DaoFactory.getGroupDao as jest.Mock).mockReturnValue(mockGroupDao);
    (DaoFactory.getSystemConfigDao as jest.Mock).mockReturnValue(mockSystemConfigDao);
    (DaoFactory.getUserConfigDao as jest.Mock).mockReturnValue(mockUserConfigDao);
    (DaoFactory.getOAuthClientDao as jest.Mock).mockReturnValue(mockOAuthClientDao);
    (DaoFactory.getOAuthTokenDao as jest.Mock).mockReturnValue(mockOAuthTokenDao);
  });

  describe('Full Settings Export', () => {
    it('should return settings aggregated from DAOs', async () => {
      mockServerDao.findAll.mockResolvedValue([
        { name: 'server-a', command: 'node', args: ['index.js'], env: { A: '1' } },
        { name: 'server-b', command: 'npx', args: ['run'], env: null },
      ]);
      mockUserDao.findAll.mockResolvedValue([
        { username: 'admin', password: 'hash', isAdmin: true },
      ]);
      mockGroupDao.findAll.mockResolvedValue([{ id: 'g1', name: 'Group', servers: [] }]);
      mockSystemConfigDao.get.mockResolvedValue({ routing: { skipAuth: false } });
      mockUserConfigDao.getAll.mockResolvedValue({ admin: { routing: {} } });
      mockOAuthClientDao.findAll.mockResolvedValue([
        { clientId: 'c1', clientSecret: 's', name: 'client' },
      ]);
      mockOAuthTokenDao.findAll.mockResolvedValue([
        {
          accessToken: 'a',
          accessTokenExpiresAt: new Date('2024-01-01T00:00:00Z'),
          clientId: 'c1',
          username: 'admin',
        },
      ]);

      await getMcpSettingsJson(mockRequest as Request, mockResponse as Response);

      expect(mockServerDao.findAll).toHaveBeenCalled();
      expect(mockUserDao.findAll).toHaveBeenCalled();
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data: {
          mcpServers: {
            'server-a': { command: 'node', args: ['index.js'], env: { A: '1' } },
            'server-b': { command: 'npx', args: ['run'] },
          },
          users: [{ username: 'admin', password: 'hash', isAdmin: true }],
          groups: [{ id: 'g1', name: 'Group', servers: [] }],
          systemConfig: { routing: { skipAuth: false } },
          userConfigs: { admin: { routing: {} } },
          oauthClients: [{ clientId: 'c1', clientSecret: 's', name: 'client' }],
          oauthTokens: [
            {
              accessToken: 'a',
              accessTokenExpiresAt: new Date('2024-01-01T00:00:00Z'),
              clientId: 'c1',
              username: 'admin',
            },
          ],
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
      mockServerDao.findAll.mockRejectedValue(new Error('boom'));
      mockUserDao.findAll.mockResolvedValue([]);
      mockGroupDao.findAll.mockResolvedValue([]);
      mockSystemConfigDao.get.mockResolvedValue({});
      mockUserConfigDao.getAll.mockResolvedValue({});
      mockOAuthClientDao.findAll.mockResolvedValue([]);
      mockOAuthTokenDao.findAll.mockResolvedValue([]);

      await getMcpSettingsJson(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get MCP settings',
      });
    });
  });
});
