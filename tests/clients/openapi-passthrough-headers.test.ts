// Test for OpenAPI passthrough headers functionality
// This test verifies that configured headers are properly passed through to upstream OpenAPI endpoints

import { OpenAPIClient } from '../../src/clients/openapi.js';
import type { ServerConfig } from '../../src/types/index.js';

describe('OpenAPI Passthrough Headers', () => {
  let mockAxios: any;
  let openApiClient: OpenAPIClient;

  const mockOpenAPISpec = {
    openapi: '3.1.0',
    info: {
      title: 'Test API',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'https://api.example.com',
      },
    ],
    paths: {
      '/test': {
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
            },
          },
        },
      },
    },
  };

  beforeEach(() => {
    // Mock axios
    mockAxios = {
      create: jest.fn().mockReturnThis(),
      request: jest.fn().mockResolvedValue({ data: { success: true } }),
      defaults: {
        headers: {
          common: {},
        },
      },
      interceptors: {
        request: {
          use: jest.fn(),
        },
      },
    };

    // Mock axios module
    jest.doMock('axios', () => ({
      default: mockAxios,
      isAxiosError: jest.fn().mockReturnValue(false),
    }));

    // Mock swagger parser
    jest.doMock('@apidevtools/swagger-parser', () => ({
      default: {
        dereference: jest.fn().mockResolvedValue(mockOpenAPISpec),
      },
    }));
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should pass through configured headers when calling tools', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: 'https://api.example.com/openapi.json',
        passthroughHeaders: ['Authorization', 'X-API-Key', 'X-Custom-Header'],
      },
    };

    openApiClient = new OpenAPIClient(config);
    await openApiClient.initialize();

    const passthroughHeaders = {
      Authorization: 'Bearer test-token',
      'X-API-Key': 'test-api-key',
      'X-Custom-Header': 'custom-value',
      'X-Ignored-Header': 'should-not-be-passed', // This should not be passed through
    };

    await openApiClient.callTool(
      'testOperation',
      { body: { message: 'test' } },
      passthroughHeaders,
    );

    expect(mockAxios.request).toHaveBeenCalledWith({
      method: 'post',
      url: '/test',
      params: {},
      data: { message: 'test' },
      headers: {
        Authorization: 'Bearer test-token',
        'X-API-Key': 'test-api-key',
        'X-Custom-Header': 'custom-value',
      },
    });
  });

  it('should not pass headers when passthroughHeaders is not configured', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: 'https://api.example.com/openapi.json',
        // No passthroughHeaders configured
      },
    };

    openApiClient = new OpenAPIClient(config);
    await openApiClient.initialize();

    const passthroughHeaders = {
      Authorization: 'Bearer test-token',
      'X-API-Key': 'test-api-key',
    };

    await openApiClient.callTool(
      'testOperation',
      { body: { message: 'test' } },
      passthroughHeaders,
    );

    expect(mockAxios.request).toHaveBeenCalledWith({
      method: 'post',
      url: '/test',
      params: {},
      data: { message: 'test' },
      // No headers should be passed since passthroughHeaders is not configured
    });
  });

  it('should only pass headers that are in the passthroughHeaders list', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: 'https://api.example.com/openapi.json',
        passthroughHeaders: ['Authorization'], // Only Authorization should be passed
      },
    };

    openApiClient = new OpenAPIClient(config);
    await openApiClient.initialize();

    const passthroughHeaders = {
      Authorization: 'Bearer test-token',
      'X-API-Key': 'test-api-key', // This should be ignored
    };

    await openApiClient.callTool(
      'testOperation',
      { body: { message: 'test' } },
      passthroughHeaders,
    );

    expect(mockAxios.request).toHaveBeenCalledWith({
      method: 'post',
      url: '/test',
      params: {},
      data: { message: 'test' },
      headers: {
        Authorization: 'Bearer test-token',
        // X-API-Key should not be included
      },
    });
  });

  it('should handle case-insensitive header names', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: 'https://api.example.com/openapi.json',
        passthroughHeaders: ['Authorization', 'x-api-key'], // Mixed case
      },
    };

    openApiClient = new OpenAPIClient(config);
    await openApiClient.initialize();

    const passthroughHeaders = {
      authorization: 'Bearer test-token', // lowercase
      'X-API-Key': 'test-api-key', // uppercase
    };

    await openApiClient.callTool(
      'testOperation',
      { body: { message: 'test' } },
      passthroughHeaders,
    );

    expect(mockAxios.request).toHaveBeenCalledWith({
      method: 'post',
      url: '/test',
      params: {},
      data: { message: 'test' },
      headers: {
        Authorization: 'Bearer test-token',
        'x-api-key': 'test-api-key',
      },
    });
  });

  it('should merge passthrough headers with operation-defined headers', async () => {
    // Mock an operation that defines header parameters
    const specWithHeaders = {
      ...mockOpenAPISpec,
      paths: {
        '/test': {
          post: {
            operationId: 'testOperation',
            summary: 'Test operation',
            parameters: [
              {
                name: 'Content-Type',
                in: 'header',
                required: true,
                schema: { type: 'string' },
              },
            ],
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
              '200': { description: 'Success' },
            },
          },
        },
      },
    };

    jest.doMock('@apidevtools/swagger-parser', () => ({
      default: {
        dereference: jest.fn().mockResolvedValue(specWithHeaders),
      },
    }));

    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: 'https://api.example.com/openapi.json',
        passthroughHeaders: ['Authorization'],
      },
    };

    openApiClient = new OpenAPIClient(config);
    await openApiClient.initialize();

    const passthroughHeaders = {
      Authorization: 'Bearer test-token',
    };

    await openApiClient.callTool(
      'testOperation',
      {
        'Content-Type': 'application/json',
        body: { message: 'test' },
      },
      passthroughHeaders,
    );

    expect(mockAxios.request).toHaveBeenCalledWith({
      method: 'post',
      url: '/test',
      params: {},
      data: { message: 'test' },
      headers: {
        'Content-Type': 'application/json', // From operation parameter
        Authorization: 'Bearer test-token', // From passthrough
      },
    });
  });
});
