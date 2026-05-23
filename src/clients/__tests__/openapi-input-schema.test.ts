import { OpenAPIClient } from '../openapi.js';
import { ServerConfig } from '../../types/index.js';
import { OpenAPIV3 } from 'openapi-types';

describe('OpenAPIClient - Input Schema Generation', () => {
  test('should preserve query parameter description and example when schema is present', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {
            '/users': {
              get: {
                operationId: 'listUsers',
                parameters: [
                  {
                    name: 'limit',
                    in: 'query',
                    required: true,
                    description: 'Maximum number of users to return',
                    example: 50,
                    schema: {
                      type: 'integer',
                      minimum: 1,
                    },
                  },
                ],
                responses: { '200': { description: 'Success' } },
              },
            },
          },
        } as OpenAPIV3.Document,
      },
    };

    const client = new OpenAPIClient(config);
    await client.initialize();

    const tool = client.getTools()[0];

    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum number of users to return',
          example: 50,
        },
      },
      required: ['limit'],
    });
  });
});
