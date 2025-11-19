import { Request, Response } from 'express';
import { jest } from '@jest/globals';
import {
  handleSseConnection,
  handleSseMessage,
  handleMcpPostRequest,
  handleMcpOtherRequest,
  getGroup,
  getConnectionCount,
  transports,
} from './sseService.js';

// Mock dependencies
jest.mock('./mcpService.js', () => ({
  deleteMcpServer: jest.fn(),
  getMcpServer: jest.fn(() => ({
    connect: jest.fn(),
  })),
}));

jest.mock('../config/index.js', () => {
  const config = {
    basePath: '/test',
  };
  return {
    __esModule: true,
    default: config,
    loadSettings: jest.fn(() => ({
      mcpServers: {},
      systemConfig: {
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: false,
          bearerAuthKey: 'test-key',
        },
        enableSessionRebuild: false, // Default to false for tests
      },
    })),
  };
});

jest.mock('./userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({
      getCurrentUser: jest.fn(() => ({ username: 'testuser' })),
    })),
  },
}));

jest.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: jest.fn().mockImplementation((_path, _res) => ({
    sessionId: 'test-session-id',
    connect: jest.fn(),
    handlePostMessage: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn().mockImplementation(() => mockStreamableHTTPServerTransport),
}));

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  isInitializeRequest: jest.fn(() => true),
}));

// Import mocked modules
import { getMcpServer } from './mcpService.js';
import { loadSettings } from '../config/index.js';
import { UserContextService } from './userContextService.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

type MockResponse = Response & {
  status: jest.Mock;
  send: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  headersStore: Record<string, string>;
};

const EXPECTED_METADATA_URL =
  'http://localhost:3000/.well-known/oauth-protected-resource/test';

// Create mock instances for testing
const mockStreamableHTTPServerTransport = {
  sessionId: 'test-session-id',
  connect: jest.fn(),
  handleRequest: jest.fn(),
  onclose: null,
};

// Mock Express Request and Response
const createMockRequest = (overrides: Partial<Request> = {}): Request => {
  const { headers: overrideHeaders, ...restOverrides } = overrides;

  const headers = {
    host: 'localhost:3000',
    ...(overrideHeaders as Record<string, unknown>),
  };

  const req = {
    headers,
    params: {},
    query: {},
    body: {},
    protocol: 'http',
    originalUrl: '/test/sse',
    ...restOverrides,
  } as Request;

  req.params = req.params || {};
  req.query = req.query || {};
  req.body = req.body || {};
  req.protocol = req.protocol || 'http';
  req.originalUrl = req.originalUrl || '/test/sse';

  return req;
};

const createMockResponse = (): MockResponse => {
  const headers: Record<string, string> = {};

  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
      return res;
    }),
    on: jest.fn(),
    headersStore: headers,
  } as unknown as MockResponse;

  return res;
};

const expectBearerUnauthorized = (
  res: MockResponse,
  description: 'No authorization provided' | 'Invalid bearer token',
): void => {
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({
    error: 'invalid_token',
    error_description: description,
    resource_metadata: EXPECTED_METADATA_URL,
  });
  expect(res.setHeader).toHaveBeenCalledWith(
    'WWW-Authenticate',
    `Bearer error="invalid_token", error_description="${description}", resource_metadata="${EXPECTED_METADATA_URL}"`,
  );
};

describe('sseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset settings cache
    (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
      mcpServers: {},
      systemConfig: {
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: false,
          bearerAuthKey: 'test-key',
        },
        enableSessionRebuild: false, // Default to false for tests
      },
    });
  });

  describe('bearer authentication', () => {
    it('should pass when bearer auth is disabled', async () => {
      const req = createMockRequest({
        params: { group: 'test-group' },
      });
      const res = createMockResponse();

      await handleSseConnection(req, res);

      expect(res.status).not.toHaveBeenCalledWith(401);
      expect(SSEServerTransport).toHaveBeenCalled();
    });

    it('should return 401 when bearer auth is enabled but no authorization header', async () => {
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'test-key',
          },
        },
      });

      const req = createMockRequest();
      const res = createMockResponse();

      await handleSseConnection(req, res);

      expectBearerUnauthorized(res, 'No authorization provided');
    });

    it('should return 401 when bearer auth is enabled with invalid token', async () => {
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'test-key',
          },
        },
      });

      const req = createMockRequest({
        headers: { authorization: 'Bearer invalid-token' },
      });
      const res = createMockResponse();

      await handleSseConnection(req, res);

      expectBearerUnauthorized(res, 'Invalid bearer token');
    });

    it('should pass when bearer auth is enabled with valid token', async () => {
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'test-key',
          },
        },
      });

      const req = createMockRequest({
        headers: { authorization: 'Bearer test-key' },
        params: { group: 'test-group' },
      });
      const res = createMockResponse();

      await handleSseConnection(req, res);

      expect(res.status).not.toHaveBeenCalledWith(401);
      expect(SSEServerTransport).toHaveBeenCalled();
    });
  });

  describe('getGroup', () => {
    it('should return empty string for non-existent session', () => {
      const result = getGroup('non-existent-session');
      expect(result).toBe('');
    });

    it('should return group for existing session', () => {
      // This would need to be tested after a connection is established
      // For now, testing the default behavior
      const result = getGroup('test-session');
      expect(result).toBe('');
    });
  });

  describe('getConnectionCount', () => {
    it('should return current number of connections', () => {
      const count = getConnectionCount();
      // The count may be > 0 due to previous tests since transports is module-level
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('handleSseConnection', () => {
    it('should reject global routes when disabled', async () => {
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: false,
            enableGroupNameRoute: true,
            enableBearerAuth: false,
            bearerAuthKey: '',
          },
        },
      });

      const req = createMockRequest(); // No group in params
      const res = createMockResponse();

      await handleSseConnection(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith(
        'Global routes are disabled. Please specify a group ID.',
      );
    });

    it('should create SSE transport for valid request', async () => {
      const req = createMockRequest({
        params: { group: 'test-group' },
      });
      const res = createMockResponse();

      await handleSseConnection(req, res);

      expect(SSEServerTransport).toHaveBeenCalledWith('/test/testuser/messages', res);
      expect(getMcpServer).toHaveBeenCalledWith('test-session-id', 'test-group');
    });

    it('should handle user context correctly', async () => {
      const mockGetCurrentUser = jest.fn(() => ({ username: 'testuser2' }));
      (UserContextService.getInstance as jest.MockedFunction<any>).mockReturnValue({
        getCurrentUser: mockGetCurrentUser,
      });

      const req = createMockRequest({
        params: { group: 'test-group' },
      });
      const res = createMockResponse();

      await handleSseConnection(req, res);

      expect(mockGetCurrentUser).toHaveBeenCalled();
      expect(SSEServerTransport).toHaveBeenCalledWith('/test/testuser2/messages', res);
    });

    it('should handle anonymous user correctly', async () => {
      const mockGetCurrentUser = jest.fn(() => null);
      (UserContextService.getInstance as jest.MockedFunction<any>).mockReturnValue({
        getCurrentUser: mockGetCurrentUser,
      });

      const req = createMockRequest({
        params: { group: 'test-group' },
      });
      const res = createMockResponse();

      await handleSseConnection(req, res);

      expect(mockGetCurrentUser).toHaveBeenCalled();
      expect(SSEServerTransport).toHaveBeenCalledWith('/test/messages', res);
    });
  });

  describe('handleSseMessage', () => {
    it('should return 400 when sessionId is missing', async () => {
      const req = createMockRequest({
        query: {}, // No sessionId
      });
      const res = createMockResponse();

      await handleSseMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith('Missing sessionId parameter');
    });

    it('should return 404 when transport not found', async () => {
      const req = createMockRequest({
        query: { sessionId: 'non-existent-session' },
      });
      const res = createMockResponse();

      await handleSseMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith('No transport found for sessionId');
    });

    it('should return 401 when bearer auth fails', async () => {
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'test-key',
          },
        },
      });

      const req = createMockRequest({
        query: { sessionId: 'test-session' },
      });
      const res = createMockResponse();

      await handleSseMessage(req, res);

      expectBearerUnauthorized(res, 'No authorization provided');
    });
  });

  describe('handleMcpPostRequest', () => {
    it('should reject global routes when disabled', async () => {
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: false,
            enableGroupNameRoute: true,
            enableBearerAuth: false,
            bearerAuthKey: '',
          },
        },
      });

      const req = createMockRequest({
        params: {}, // No group
        body: { method: 'initialize' },
      });
      const res = createMockResponse();

      await handleMcpPostRequest(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith(
        'Global routes are disabled. Please specify a group ID.',
      );
    });

    it('should create new transport for initialize request without sessionId', async () => {
      const req = createMockRequest({
        params: { group: 'test-group' },
        body: { method: 'initialize' },
      });
      const res = createMockResponse();

      await handleMcpPostRequest(req, res);

      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
      expect(getMcpServer).toHaveBeenCalled();
    });

    it('should return error when session rebuild is disabled and session is invalid', async () => {
      const req = createMockRequest({
        params: { group: 'test-group' },
        headers: { 'mcp-session-id': 'invalid-session' },
        body: { method: 'someMethod' },
      });
      const res = createMockResponse();

      await handleMcpPostRequest(req, res);

      // When session rebuild is disabled, invalid sessions should return an error
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
    });

    it('should transparently rebuild invalid session when enabled', async () => {
      // Enable session rebuild for this test
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: false,
            bearerAuthKey: 'test-key',
          },
          enableSessionRebuild: true, // Enable session rebuild
        },
      });

      const req = createMockRequest({
        params: { group: 'test-group' },
        headers: { 'mcp-session-id': 'invalid-session' },
        body: { method: 'someMethod' },
      });
      const res = createMockResponse();

      await handleMcpPostRequest(req, res);

      // With session rebuild enabled, invalid sessions should be transparently rebuilt
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
      const mockInstance = (StreamableHTTPServerTransport as jest.MockedClass<typeof StreamableHTTPServerTransport>).mock.results[0].value;
      expect(mockInstance.handleRequest).toHaveBeenCalledWith(req, res, req.body);
    });

    it('should return 401 when bearer auth fails', async () => {
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'test-key',
          },
        },
      });

      const req = createMockRequest({
        params: { group: 'test-group' },
        body: { method: 'initialize' },
      });
      const res = createMockResponse();

      await handleMcpPostRequest(req, res);

      expectBearerUnauthorized(res, 'No authorization provided');
    });
  });

  describe('handleMcpOtherRequest', () => {
    it('should return 400 for missing session ID', async () => {
      const req = createMockRequest({
        headers: {}, // No mcp-session-id
      });
      const res = createMockResponse();

      await handleMcpOtherRequest(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith('Invalid or missing session ID');
    });
    it('should return error when session rebuild is disabled in handleMcpOtherRequest', async () => {
      // Clear transports before test
      Object.keys(transports).forEach(key => delete transports[key]);
      
      // Enable bearer auth for this test
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'test-key',
          },
          enableSessionRebuild: false, // Disable session rebuild
        },
      });

      // Mock user context to exist
      const mockGetCurrentUser = jest.fn(() => ({ username: 'testuser' }));
      (UserContextService.getInstance as jest.MockedFunction<any>).mockReturnValue({
        getCurrentUser: mockGetCurrentUser,
      });

      const req = createMockRequest({
        headers: {
          'mcp-session-id': 'invalid-session',
          'authorization': 'Bearer test-key'
        },
        params: { group: 'test-group' },
      });
      const res = createMockResponse();

      await handleMcpOtherRequest(req, res);

      // Should return 400 error when session rebuild is disabled
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith('Invalid or missing session ID');
    });

    it('should transparently rebuild invalid session in handleMcpOtherRequest when enabled', async () => {
      // Enable bearer auth and session rebuild for this test
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'test-key',
          },
          enableSessionRebuild: true, // Enable session rebuild
        },
      });

      const req = createMockRequest({
        headers: {
          'mcp-session-id': 'invalid-session',
          'authorization': 'Bearer test-key'
        },
      });
      const res = createMockResponse();

      await handleMcpOtherRequest(req, res);

      // Should not return 400 error, but instead transparently rebuild the session
      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(res.send).not.toHaveBeenCalledWith('Invalid or missing session ID');
      
      // Should attempt to handle the request (session was rebuilt)
      expect(mockStreamableHTTPServerTransport.handleRequest).toHaveBeenCalled();
    });

    it('should return 401 when bearer auth fails', async () => {
      (loadSettings as jest.MockedFunction<typeof loadSettings>).mockReturnValue({
        mcpServers: {},
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'test-key',
          },
        },
      });

      const req = createMockRequest({
        headers: { 'mcp-session-id': 'test-session' },
      });
      const res = createMockResponse();

      await handleMcpOtherRequest(req, res);

      expectBearerUnauthorized(res, 'No authorization provided');
    });
  });
});
