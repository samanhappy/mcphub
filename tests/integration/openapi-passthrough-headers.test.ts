// Integration test for OpenAPI passthrough headers functionality
// Tests the complete flow from HTTP request to OpenAPI client

import request from 'supertest';
import AppServer from '../../src/server.js';
import { addServer, removeServer } from '../../src/services/mcpService.js';
import type { ServerConfig } from '../../src/types/index.js';

describe('OpenAPI Passthrough Headers Integration', () => {
  const testServerName = 'test-openapi-passthrough';
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
                    properties: { message: { type: 'string' } },
                  },
                },
              },
            },
            responses: { '200': { description: 'Success' } },
          },
        },
      },
    };

    jest.doMock('@apidevtools/swagger-parser', () => ({
      default: {
        dereference: jest.fn().mockResolvedValue(mockSpec),
      },
    }));

    // Add test OpenAPI server with passthrough headers
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: mockSpec,
        passthroughHeaders: ['Authorization', 'X-API-Key'],
      },
    };

    await addServer(testServerName, config);

    // Wait a bit for server to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    await removeServer(testServerName);
    jest.resetAllMocks();
  });

  it('should pass through headers when calling OpenAPI tools via HTTP endpoint', async () => {
    const response = await request(app)
      .post(`/api/tools/${testServerName}/testOperation`)
      .set('Authorization', 'Bearer test-token')
      .set('X-API-Key', 'test-api-key')
      .set('X-Ignored-Header', 'should-not-pass')
      .send({ message: 'test message' })
      .expect(200);

    // Verify the tool was called successfully
    expect(response.body).toHaveProperty('content');

    // Verify that axios was called with the correct headers
    expect(mockAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'X-API-Key': 'test-api-key',
        }),
      }),
    );

    // Verify that X-Ignored-Header was not passed through
    const axiosCall = mockAxios.request.mock.calls[0][0];
    expect(axiosCall.headers).not.toHaveProperty('X-Ignored-Header');
  });

  it('should work with case-insensitive header names', async () => {
    const response = await request(app)
      .post(`/api/tools/${testServerName}/testOperation`)
      .set('authorization', 'Bearer test-token') // lowercase
      .set('x-api-key', 'test-api-key') // lowercase
      .send({ message: 'test message' })
      .expect(200);

    expect(response.body).toHaveProperty('content');

    // Verify headers were passed through (Express normalizes to lowercase)
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
                requestBody: {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { message: { type: 'string' } },
                      },
                    },
                  },
                },
                responses: { '200': { description: 'Success' } },
              },
            },
          },
        },
        // No passthroughHeaders configured
      },
    };

    await addServer(testServerName, configWithoutPassthrough);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response = await request(app)
      .post(`/api/tools/${testServerName}/testOperation`)
      .set('Authorization', 'Bearer test-token')
      .set('X-API-Key', 'test-api-key')
      .send({ message: 'test message' })
      .expect(200);

    expect(response.body).toHaveProperty('content');

    // Verify that no headers were passed through
    const axiosCall = mockAxios.request.mock.calls[0][0];
    expect(axiosCall.headers).toBeUndefined();
  });

  it('should handle multiple header values correctly', async () => {
    const response = await request(app)
      .post(`/api/tools/${testServerName}/testOperation`)
      .set('Authorization', 'Bearer token1, Bearer token2') // Multiple values as comma-separated string
      .send({ message: 'test message' })
      .expect(200);

    expect(response.body).toHaveProperty('content');

    // Express should handle the header value as provided
    expect(mockAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token1, Bearer token2',
        }),
      }),
    );
  });
});
