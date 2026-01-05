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

// Mock smartRoutingService to initialize with test functions
const mockHandleSearchToolsRequest = jest.fn();
jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  handleSearchToolsRequest: mockHandleSearchToolsRequest,
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn((group: string) => group?.startsWith('$smart')),
  getSmartRoutingTools: jest.fn(async (group: string) => {
    const targetGroup = group?.startsWith('$smart/') ? group.substring(7) : undefined;
    const scopeDescription = targetGroup
      ? `servers in the "${targetGroup}" group`
      : 'all available servers';

    return {
      tools: [
        {
          name: 'search_tools',
          description: `Search for relevant tools across ${scopeDescription}.`,
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'integer' } },
            required: ['query'],
          },
        },
        {
          name: 'call_tool',
          description: 'Execute a tool by name',
          inputSchema: {
            type: 'object',
            properties: { toolName: { type: 'string' } },
            required: ['toolName'],
          },
        },
      ],
    };
  }),
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
import { getGroup } from '../../src/services/sseService.js';
import { handleSearchToolsRequest } from '../../src/services/smartRoutingService.js';

describe('MCP Service - Smart Routing with Group Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup mock return for handleSearchToolsRequest
    mockHandleSearchToolsRequest.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ tools: [], guideline: 'test', nextSteps: 'test' }),
        },
      ],
    });
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
      // Note: getServersInGroup is now called inside the mocked getSmartRoutingTools

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe('search_tools');
      expect(result.tools[1].name).toBe('call_tool');
      expect(result.tools[0].description).toContain('servers in the "test-group" group');
    });

    it('should handle $smart with empty group', async () => {
      const result = await handleListToolsRequest({}, { sessionId: 'session-smart-empty' });

      expect(getGroup).toHaveBeenCalledWith('session-smart-empty');
      // Note: getServersInGroup is now called inside the mocked getSmartRoutingTools

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe('search_tools');
      expect(result.tools[1].name).toBe('call_tool');
      // Should still show group-scoped message even if group is empty
      expect(result.tools[0].description).toContain('servers in the "empty-group" group');
    });
  });

  describe('handleCallToolRequest - search_tools', () => {
    it('should search across all servers when using $smart', async () => {
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

      // handleSearchToolsRequest should be called with the query, limit, and sessionId
      expect(handleSearchToolsRequest).toHaveBeenCalledWith('test query', 10, 'session-smart');
    });

    it('should filter servers when using $smart/{group}', async () => {
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

      // handleSearchToolsRequest should be called with the sessionId that contains group info
      // The group filtering happens inside handleSearchToolsRequest, not in handleCallToolRequest
      expect(handleSearchToolsRequest).toHaveBeenCalledWith(
        'test query',
        10,
        'session-smart-group',
      );
    });

    it('should handle empty group in $smart/{group}', async () => {
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

      expect(handleSearchToolsRequest).toHaveBeenCalledWith(
        'test query',
        10,
        'session-smart-empty',
      );
    });

    it('should validate query parameter', async () => {
      // Mock handleSearchToolsRequest to return an error result when query is missing
      mockHandleSearchToolsRequest.mockImplementationOnce(() => {
        return Promise.reject(new Error('Query parameter is required and must be a string'));
      });

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
