import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock dependencies before importing mcpService
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
  getServersInGroup: jest.fn((groupId: string) => {
    if (groupId === 'test-group') {
      return ['server1', 'server2'];
    }
    if (groupId === 'empty-group') {
      return [];
    }
    return undefined;
  }),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn((sessionId: string) => {
    if (sessionId === 'session-smart') return '$smart';
    if (sessionId === 'session-smart-group') return '$smart/test-group';
    if (sessionId === 'session-smart-empty') return '$smart/empty-group';
    return '';
  }),
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findById: jest.fn(),
    findAll: jest.fn(() => Promise.resolve([])),
  })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
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

// Import after mocks are set up
import { handleListToolsRequest, handleCallToolRequest } from '../../src/services/mcpService.js';
import { getServersInGroup } from '../../src/services/groupService.js';
import { getGroup } from '../../src/services/sseService.js';
import { searchToolsByVector } from '../../src/services/vectorSearchService.js';

describe('MCP Service - Smart Routing with Group Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleListToolsRequest', () => {
    it('should return search_tools and call_tool for $smart group', async () => {
      const result = await handleListToolsRequest({}, { sessionId: 'session-smart' });

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe('search_tools');
      expect(result.tools[1].name).toBe('call_tool');
      expect(result.tools[0].description).toContain('all available servers');
    });

    it('should return filtered tools for $smart/{group} pattern', async () => {
      const result = await handleListToolsRequest({}, { sessionId: 'session-smart-group' });

      expect(getGroup).toHaveBeenCalledWith('session-smart-group');
      expect(getServersInGroup).toHaveBeenCalledWith('test-group');

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe('search_tools');
      expect(result.tools[1].name).toBe('call_tool');
      expect(result.tools[0].description).toContain('servers in the "test-group" group');
    });

    it('should handle $smart with empty group', async () => {
      const result = await handleListToolsRequest({}, { sessionId: 'session-smart-empty' });

      expect(getGroup).toHaveBeenCalledWith('session-smart-empty');
      expect(getServersInGroup).toHaveBeenCalledWith('empty-group');

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe('search_tools');
      expect(result.tools[1].name).toBe('call_tool');
      // Should still show group-scoped message even if group is empty
      expect(result.tools[0].description).toContain('servers in the "empty-group" group');
    });
  });

  describe('handleCallToolRequest - search_tools', () => {
    it('should search across all servers when using $smart', async () => {
      const mockSearchResults = [
        {
          serverName: 'server1',
          toolName: 'server1::tool1',
          description: 'Test tool 1',
          inputSchema: {},
        },
      ];
      (searchToolsByVector as jest.Mock).mockResolvedValue(mockSearchResults);

      const request = {
        params: {
          name: 'search_tools',
          arguments: {
            query: 'test query',
            limit: 10,
          },
        },
      };

      await handleCallToolRequest(request, { sessionId: 'session-smart' });

      expect(searchToolsByVector).toHaveBeenCalledWith(
        'test query',
        10,
        expect.any(Number),
        undefined, // No server filtering
      );
    });

    it('should filter servers when using $smart/{group}', async () => {
      const mockSearchResults = [
        {
          serverName: 'server1',
          toolName: 'server1::tool1',
          description: 'Test tool 1',
          inputSchema: {},
        },
      ];
      (searchToolsByVector as jest.Mock).mockResolvedValue(mockSearchResults);

      const request = {
        params: {
          name: 'search_tools',
          arguments: {
            query: 'test query',
            limit: 10,
          },
        },
      };

      await handleCallToolRequest(request, { sessionId: 'session-smart-group' });

      expect(getGroup).toHaveBeenCalledWith('session-smart-group');
      expect(getServersInGroup).toHaveBeenCalledWith('test-group');
      expect(searchToolsByVector).toHaveBeenCalledWith(
        'test query',
        10,
        expect.any(Number),
        ['server1', 'server2'], // Filtered to group servers
      );
    });

    it('should handle empty group in $smart/{group}', async () => {
      const mockSearchResults: any[] = [];
      (searchToolsByVector as jest.Mock).mockResolvedValue(mockSearchResults);

      const request = {
        params: {
          name: 'search_tools',
          arguments: {
            query: 'test query',
            limit: 10,
          },
        },
      };

      await handleCallToolRequest(request, { sessionId: 'session-smart-empty' });

      expect(getGroup).toHaveBeenCalledWith('session-smart-empty');
      expect(getServersInGroup).toHaveBeenCalledWith('empty-group');
      // Empty group returns empty array, which should still be passed to search
      expect(searchToolsByVector).toHaveBeenCalledWith(
        'test query',
        10,
        expect.any(Number),
        [], // Empty group
      );
    });

    it('should validate query parameter', async () => {
      const request = {
        params: {
          name: 'search_tools',
          arguments: {
            limit: 10,
          },
        },
      };

      const result = await handleCallToolRequest(request, { sessionId: 'session-smart' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Query parameter is required');
    });
  });
});
