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
});
