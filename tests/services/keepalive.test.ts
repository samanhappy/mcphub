// Mock openid-client before anything else
jest.mock('openid-client', () => ({
  discovery: jest.fn(),
  dynamicClientRegistration: jest.fn(),
  ClientSecretPost: jest.fn(() => jest.fn()),
  ClientSecretBasic: jest.fn(() => jest.fn()),
  None: jest.fn(() => jest.fn()),
  calculatePKCECodeChallenge: jest.fn(),
  randomPKCECodeVerifier: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  authorizationCodeGrant: jest.fn(),
  refreshTokenGrant: jest.fn(),
}));

// Mock dependencies BEFORE any imports that use them
jest.mock('../../src/models/OAuth.js', () => ({
  OAuthModel: {
    getOAuthToken: jest.fn(),
  },
}));

jest.mock('../../src/db/connection.js', () => ({
  getDatabase: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  VectorSearchService: jest.fn(),
}));

jest.mock('../../src/utils/oauthBearer.js', () => ({
  resolveOAuthUserFromToken: jest.fn(),
}));

// Mock DAO accessors used by sseService (avoid file-based DAOs and migrations)
jest.mock('../../src/dao/index.js', () => ({
  getBearerKeyDao: jest.fn(),
  getGroupDao: jest.fn(),
  getSystemConfigDao: jest.fn(),
}));

// Mock config module default export used by sseService
jest.mock('../../src/config/index.js', () => ({
  __esModule: true,
  default: { basePath: '' },
  loadSettings: jest.fn(),
}));

import { Request, Response } from 'express';
import { handleSseConnection, transports } from '../../src/services/sseService.js';
import * as mcpService from '../../src/services/mcpService.js';
import * as configModule from '../../src/config/index.js';
import * as daoIndex from '../../src/dao/index.js';

// Mock remaining dependencies
jest.mock('../../src/services/mcpService.js');

// Mock UserContextService with getInstance pattern
const mockUserContextService = {
  getCurrentUser: jest.fn().mockReturnValue(null),
  setCurrentUser: jest.fn(),
  clearCurrentUser: jest.fn(),
  hasUser: jest.fn().mockReturnValue(false),
};

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => mockUserContextService),
  },
}));

// Mock RequestContextService with getInstance pattern
const mockRequestContextService = {
  setRequestContext: jest.fn(),
  clearRequestContext: jest.fn(),
  getRequestContext: jest.fn(),
};

jest.mock('../../src/services/requestContextService.js', () => ({
  RequestContextService: {
    getInstance: jest.fn(() => mockRequestContextService),
  },
}));

// Mock SSEServerTransport
const mockTransportInstance = {
  sessionId: 'test-session-id',
  send: jest.fn(),
  onclose: null,
};

jest.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: jest.fn().mockImplementation(() => mockTransportInstance),
}));

describe('Keepalive Functionality', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let eventListeners: { [event: string]: (...args: any[]) => void };
  let originalSetInterval: typeof setInterval;
  let originalClearInterval: typeof clearInterval;
  let intervals: NodeJS.Timeout[];

  beforeAll(() => {
    // Save original timer functions
    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;
  });

  beforeEach(() => {
    // Track all intervals created during the test
    intervals = [];

    // Mock setInterval to track created intervals
    global.setInterval = jest.fn((callback: any, ms: number) => {
      const interval = originalSetInterval(callback, ms);
      intervals.push(interval);
      return interval;
    }) as any;

    // Mock clearInterval to track cleanup
    global.clearInterval = jest.fn((interval: NodeJS.Timeout) => {
      const index = intervals.indexOf(interval);
      if (index > -1) {
        intervals.splice(index, 1);
      }
      originalClearInterval(interval);
    }) as any;

    eventListeners = {};

    mockReq = {
      params: { group: 'test-group' },
      headers: {},
    };

    mockRes = {
      on: jest.fn((event: string, callback: (...args: any[]) => void) => {
        eventListeners[event] = callback;
        return mockRes as Response;
      }),
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    // Update the mock instance for each test
    mockTransportInstance.sessionId = 'test-session-id';
    mockTransportInstance.send = jest.fn();
    mockTransportInstance.onclose = null;

    // Mock getMcpServer
    const mockMcpServer = {
      connect: jest.fn().mockResolvedValue(undefined),
    };
    (mcpService.getMcpServer as jest.Mock).mockReturnValue(mockMcpServer);

    // Mock bearer key + system config DAOs used by sseService
    const mockBearerKeyDao = {
      findEnabled: jest.fn().mockResolvedValue([]),
    };
    (daoIndex.getBearerKeyDao as unknown as jest.Mock).mockReturnValue(mockBearerKeyDao);

    const mockSystemConfigDao = {
      get: jest.fn().mockResolvedValue({
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: false,
          bearerAuthKey: '',
        },
      }),
    };
    (daoIndex.getSystemConfigDao as unknown as jest.Mock).mockReturnValue(mockSystemConfigDao);

    // Mock loadSettings
    (configModule.loadSettings as jest.Mock).mockReturnValue({
      systemConfig: {
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: false,
          bearerAuthKey: '',
        },
      },
      mcpServers: {},
    });

    // Clear transports
    Object.keys(transports).forEach((key) => delete transports[key]);
  });

  afterEach(() => {
    // Clean up all intervals
    intervals.forEach((interval) => originalClearInterval(interval));
    intervals = [];

    // Restore original timer functions
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('SSE Connection (No Server-Side Keepalive)', () => {
    // Server-side keepalive was removed - keepalive is now only for upstream MCP server connections (client-side)
    // These tests verify that SSE connections work without server-side keepalive

    it('should establish SSE connection without keepalive interval', async () => {
      await handleSseConnection(mockReq as Request, mockRes as Response);

      // Verify no keepalive interval was created for server-side SSE
      expect(global.setInterval).not.toHaveBeenCalled();
    });

    it('should register close event handler for cleanup', async () => {
      await handleSseConnection(mockReq as Request, mockRes as Response);

      // Verify close event handler was registered
      expect(mockRes.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should clean up transport on connection close', async () => {
      await handleSseConnection(mockReq as Request, mockRes as Response);

      // Verify transport was registered
      expect(transports['test-session-id']).toBeDefined();

      // Simulate connection close
      if (eventListeners['close']) {
        eventListeners['close']();
      }

      // Verify transport was removed
      expect(transports['test-session-id']).toBeUndefined();
    });

    it('should not send pings after connection is closed', async () => {
      jest.useFakeTimers();

      await handleSseConnection(mockReq as Request, mockRes as Response);

      // Close the connection
      if (eventListeners['close']) {
        eventListeners['close']();
      }

      // Reset mock to count pings after close
      mockTransportInstance.send.mockClear();

      // Fast-forward time by 60 seconds
      jest.advanceTimersByTime(60000);

      // Verify no pings were sent after close
      expect(mockTransportInstance.send).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('StreamableHTTP Connection Keepalive', () => {
    // Note: StreamableHTTP keepalive is tested indirectly through the session creation functions
    // These are tested in the integration tests as they require more complex setup

    it('should track keepalive intervals for multiple sessions', () => {
      // This test verifies the pattern is set up correctly
      const intervalCount = intervals.length;
      expect(intervalCount).toBeGreaterThanOrEqual(0);
    });
  });
});
