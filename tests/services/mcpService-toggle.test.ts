// Mock dependencies before importing mcpService
const mockRemoveServerToolEmbeddings = jest.fn().mockResolvedValue(undefined);
const mockSaveToolsAsVectorEmbeddings = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  registerOAuthClient: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(),
}));

const mockServerDao = {
  findById: jest.fn(),
  findAll: jest.fn(() => Promise.resolve([] as any[])),
  setEnabled: jest.fn().mockResolvedValue(true),
};

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(),
  })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(),
  getSmartRoutingTools: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: jest.fn(),
  saveToolsAsVectorEmbeddings: mockSaveToolsAsVectorEmbeddings,
  removeServerToolEmbeddings: mockRemoveServerToolEmbeddings,
}));

jest.mock('../../src/config/index.js', () => ({
  loadSettings: jest.fn(),
  expandEnvVars: jest.fn((val: string) => val),
  replaceEnvVars: jest.fn((val: any) => val),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
  },
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn(),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logActivity: jest.fn(),
  })),
}));

// Import after mocks
import { toggleServerStatus } from '../../src/services/mcpService.js';

describe('mcpService toggleServerStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when disabling a server', () => {
    it('should remove tool embeddings when server is disabled', async () => {
      const result = await toggleServerStatus('test-server', false);

      expect(result.success).toBe(true);
      expect(result.message).toContain('disabled');
      expect(mockServerDao.setEnabled).toHaveBeenCalledWith('test-server', false);
      expect(mockRemoveServerToolEmbeddings).toHaveBeenCalledWith('test-server');
    });

    it('should succeed even if embedding removal fails', async () => {
      mockRemoveServerToolEmbeddings.mockRejectedValueOnce(new Error('Embedding removal failed'));

      const result = await toggleServerStatus('test-server', false);

      expect(result.success).toBe(true);
      expect(mockRemoveServerToolEmbeddings).toHaveBeenCalledWith('test-server');
    });
  });

  describe('when enabling a server', () => {
    it('should trigger server re-initialization when enabled', async () => {
      // Server DAO should return the server config for re-initialization
      mockServerDao.findAll.mockResolvedValueOnce([
        {
          name: 'test-server',
          enabled: true,
          command: 'node',
          args: ['server.js'],
        },
      ]);

      const result = await toggleServerStatus('test-server', true);

      expect(result.success).toBe(true);
      expect(result.message).toContain('enabled');
      expect(mockServerDao.setEnabled).toHaveBeenCalledWith('test-server', true);
      // initializeClientsFromSettings will be called internally, which triggers saveToolsAsVectorEmbeddings
    });

    it('should succeed even if re-initialization fails', async () => {
      mockServerDao.findAll.mockRejectedValueOnce(new Error('Reconnect failed'));

      const result = await toggleServerStatus('test-server', true);

      expect(result.success).toBe(true);
      expect(result.message).toContain('enabled');
    });
  });

  describe('error handling', () => {
    it('should return failure if DAO setEnabled fails', async () => {
      mockServerDao.setEnabled.mockRejectedValueOnce(new Error('DAO error'));

      const result = await toggleServerStatus('test-server', false);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to toggle server status');
    });
  });
});
