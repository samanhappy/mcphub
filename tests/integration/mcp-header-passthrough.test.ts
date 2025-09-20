// Integration test for MCP header passthrough functionality using request context
// Tests that headers are properly passed through MCP protocol using RequestContextService

import request from 'supertest';
import AppServer from '../../src/server.js';
import { addServer, removeServer } from '../../src/services/mcpService.js';
import { RequestContextService } from '../../src/services/requestContextService.js';
import type { ServerConfig } from '../../src/types/index.js';

describe('MCP Header Passthrough via Request Context', () => {
  const testServerName = 'test-mcp-passthrough';
  let mockAxios: any;
  let appServer: AppServer;
  let app: any;

  beforeAll(() => {
    appServer = new AppServer();
    app = appServer.getApp();
  });

  beforeEach(async () => {
    // Mock axios for OpenAPI client
    mockAxios = {
      create: jest.fn().mockReturnThis(),
      request: jest.fn().mockResolvedValue({ data: { result: 'success' } }),
      defaults: {
        headers: { common: {} },
        baseURL: 'https://api.example.com',
      },
      interceptors: {
        request: { use: jest.fn() },
      },
    };

    jest.doMock('axios', () => ({
      default: mockAxios,
      isAxiosError: jest.fn().mockReturnValue(false),
    }));

    // Mock swagger parser
    const mockSpec = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/test-endpoint': {
          post: {
            operationId: 'testOperation',
            summary: 'Test operation',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        result: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    jest.doMock('@apidevtools/swagger-parser', () => ({
      default: {
        dereference: jest.fn().mockResolvedValue(mockSpec),
      },
    }));

    // Add test server with passthrough headers configuration
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: mockSpec,
        version: '3.1.0',
        passthroughHeaders: ['Authorization', 'X-API-Key', 'X-Custom-Header'],
      },
    };

    await addServer(testServerName, config);
  });

  afterEach(async () => {
    await removeServer(testServerName);
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('should pass headers through MCP protocol via request context', async () => {
    // Test via MCP protocol (StreamableHTTP)
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-token')
      .set('X-API-Key', 'test-api-key')
      .set('X-Custom-Header', 'custom-value')
      .set('X-Ignored-Header', 'should-not-be-passed')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: `${testServerName}-testOperation`,
          arguments: {
            body: { message: 'test message' },
          },
        },
      })
      .expect(200);

    // Verify the response
    expect(response.body).toHaveProperty('result');

    // Verify that axios was called with the correct headers
    expect(mockAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'X-API-Key': 'test-api-key',
          'X-Custom-Header': 'custom-value',
        }),
      }),
    );

    // Verify that X-Ignored-Header was not passed through
    const axiosCall = mockAxios.request.mock.calls[0][0];
    expect(axiosCall.headers).not.toHaveProperty('X-Ignored-Header');
  });

  it('should work with SSE protocol', async () => {
    // Test via SSE protocol
    await request(app)
      .post('/messages')
      .set('Authorization', 'Bearer test-token')
      .set('X-API-Key', 'test-api-key')
      .query({ sessionId: 'test-session-123' })
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: `${testServerName}-testOperation`,
          arguments: {
            body: { message: 'test message via SSE' },
          },
        },
      });

    // Note: This test verifies that the request doesn't fail with headers
    // The actual SSE behavior would need a more complex test setup
  });

  it('should handle case-insensitive header names', async () => {
    await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer test-token') // lowercase
      .set('x-api-key', 'test-api-key') // lowercase
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: `${testServerName}-testOperation`,
          arguments: {
            body: { message: 'test message' },
          },
        },
      })
      .expect(200);

    // Verify headers were passed through correctly
    expect(mockAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'X-API-Key': 'test-api-key',
        }),
      }),
    );
  });

  it('should not pass headers when none are configured for passthrough', async () => {
    // Remove the existing server and add one without passthrough headers
    await removeServer(testServerName);

    const configWithoutPassthrough: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.1.0',
          info: { title: 'Test API', version: '1.0.0' },
          servers: [{ url: 'https://api.example.com' }],
          paths: {
            '/test-endpoint': {
              post: {
                operationId: 'testOperation',
                summary: 'Test operation',
                responses: {
                  '200': {
                    description: 'Success',
                  },
                },
              },
            },
          },
        },
        version: '3.1.0',
        // No passthroughHeaders configured
      },
    };

    await addServer(testServerName, configWithoutPassthrough);

    await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-token')
      .set('X-API-Key', 'test-api-key')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: `${testServerName}-testOperation`,
          arguments: {},
        },
      })
      .expect(200);

    // Verify that no passthrough headers were included
    const axiosCall = mockAxios.request.mock.calls[0][0];
    expect(axiosCall.headers || {}).not.toHaveProperty('Authorization');
    expect(axiosCall.headers || {}).not.toHaveProperty('X-API-Key');
  });

  it('should work with request context service directly', () => {
    const requestContextService = RequestContextService.getInstance();

    // Mock a request with headers
    const mockReq = {
      headers: {
        authorization: 'Bearer direct-test',
        'x-custom-header': 'direct-value',
      },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    } as any;

    requestContextService.setRequestContext(mockReq);

    // Verify context was set correctly
    const context = requestContextService.getRequestContext();
    expect(context?.headers['authorization']).toBe('Bearer direct-test');
    expect(context?.headers['x-custom-header']).toBe('direct-value');

    // Test case-insensitive header retrieval
    expect(requestContextService.getHeader('Authorization')).toBe('Bearer direct-test');
    expect(requestContextService.getHeader('X-Custom-Header')).toBe('direct-value');

    requestContextService.clearRequestContext();
  });
});
