import { OpenAPIClient } from '../openapi.js';
import type { ServerConfig } from '../../types/index.js';

describe('OpenAPIClient - error handling', () => {
  test('should include upstream response data when an API call fails', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {},
        },
      },
    };

    const client = new OpenAPIClient(config) as OpenAPIClient & {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        operationId: string;
        method: string;
        path: string;
      }>;
      httpClient: {
        request: jest.Mock;
      };
    };

    client.tools = [
      {
        name: 'get_users',
        description: 'Get users',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'get_users',
        method: 'get',
        path: '/users',
      },
    ];

    client.httpClient = {
      request: jest.fn().mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {
            message: 'upstream validation failed',
            code: 'INVALID_INPUT',
          },
        },
      }),
    };

    await expect(client.callTool('get_users', {})).rejects.toThrow(
      'API call failed: 400 Bad Request {"message":"upstream validation failed","code":"INVALID_INPUT"}',
    );
  });

  test('redacts OAuth error fields from surfaced upstream response details', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {},
        },
      },
    };

    const client = new OpenAPIClient(config) as OpenAPIClient & {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        operationId: string;
        method: string;
        path: string;
      }>;
      httpClient: {
        request: jest.Mock;
      };
    };

    client.tools = [
      {
        name: 'get_users',
        description: 'Get users',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'get_users',
        method: 'get',
        path: '/users',
      },
    ];

    client.httpClient = {
      request: jest.fn().mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: {
            error: 'invalid_token',
            error_description: 'JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 leaked',
          },
        },
      }),
    };

    await expect(client.callTool('get_users', {})).rejects.toThrow(
      'API call failed: 401 Unauthorized {"error":"invalid_token","error_description":"[REDACTED]"}',
    );
    await expect(client.callTool('get_users', {})).rejects.not.toThrow('eyJhbGciOiJIUzI1NiI');
  });
});
