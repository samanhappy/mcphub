import { OpenAPIClient } from '../openapi.js';
import { ServerConfig } from '../../types/index.js';
import { OpenAPIV3 } from 'openapi-types';
import { itemCostForTool } from '../../utils/tokenCost.js';

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

  // Regression for #959: SwaggerParser.dereference resolves recursive $ref
  // schemas into live circular object references. Tools built from such a spec
  // must expose a JSON-serializable inputSchema, otherwise every downstream
  // serializer (tokenCost, getServerConfig, MCP ListTools, embeddings) throws
  // "Converting circular structure to JSON".
  test('should produce JSON-serializable inputSchema for recursive $ref schemas', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Recursive API', version: '1.0.0' },
          paths: {
            '/media': {
              post: {
                operationId: 'createMedia',
                requestBody: {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/media' },
                    },
                  },
                },
                responses: { '200': { description: 'Success' } },
              },
            },
          },
          components: {
            schemas: {
              // media -> requests -> media forms a cycle after dereference.
              media: {
                type: 'object',
                properties: { requests: { $ref: '#/components/schemas/requests' } },
              },
              requests: {
                type: 'object',
                properties: { media: { $ref: '#/components/schemas/media' } },
              },
            },
          },
        } as OpenAPIV3.Document,
      },
    };

    const client = new OpenAPIClient(config);
    await client.initialize();

    const tool = client.getTools()[0];
    expect(tool).toBeDefined();
    expect(() => JSON.stringify(tool.inputSchema)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(tool.inputSchema));
    expect(parsed.properties.body).toBeDefined();
  });

  // Regression for #959 (token-cost path): contextCostService calls
  // itemCostForTool → serializeToolDefinition → JSON.stringify(inputSchema),
  // which threw "Converting circular structure to JSON" for recursive specs.
  // The source fix in extractTools must make inputSchema safe for that path.
  test('exposes inputSchema that survives token-cost serialization', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Recursive API', version: '1.0.0' },
          paths: {
            '/media': {
              post: {
                operationId: 'createMedia',
                requestBody: {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/media' },
                    },
                  },
                },
                responses: { '200': { description: 'Success' } },
              },
            },
          },
          components: {
            schemas: {
              media: {
                type: 'object',
                properties: { requests: { $ref: '#/components/schemas/requests' } },
              },
              requests: {
                type: 'object',
                properties: { media: { $ref: '#/components/schemas/media' } },
              },
            },
          },
        } as OpenAPIV3.Document,
      },
    };

    const client = new OpenAPIClient(config);
    await client.initialize();

    const tool = client.getTools()[0];
    // Mirror what mcpService does: build an MCP tool whose inputSchema is the
    // (cleaned) OpenAPI inputSchema, then run it through the token-cost path.
    const item = await itemCostForTool({
      name: `repro-${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
    expect(item.kind).toBe('tool');
    expect(item.cost).toBeGreaterThan(0);
  });
});
