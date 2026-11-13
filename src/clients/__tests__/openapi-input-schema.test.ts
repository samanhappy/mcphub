import { OpenAPIClient } from '../openapi.js';
import { ServerConfig } from '../../types/index.js';
import { OpenAPIV3 } from 'openapi-types';
import { itemCostForTool } from '../../utils/tokenCost.js';

describe('OpenAPIClient - Input Schema Generation', () => {
  test.each(['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'])(
    'normalizes nullable parameters and nested %s body schemas without changing the source',
    async (contentType) => {
      const nullableInteger = { type: 'integer', format: 'int64', nullable: true };
      const bodySchema = {
        type: 'object',
        required: ['parent_story_id'],
        properties: {
          parent_story_id: nullableInteger,
          labels: { type: 'array', nullable: true, items: { type: 'string', nullable: true } },
        },
        additionalProperties: { type: 'string', nullable: true },
      };
      const client = new OpenAPIClient({
        type: 'openapi',
        openapi: {
          schema: {
            openapi: '3.0.0',
            info: { title: 'Nullable API', version: '1.0.0' },
            paths: {
              '/stories': {
                patch: {
                  operationId: 'updateStory',
                  parameters: ['query', 'header'].map((location) => ({
                    name: location,
                    in: location,
                    schema: nullableInteger,
                  })),
                  requestBody: {
                    required: true,
                    content: { [contentType]: { schema: bodySchema } },
                  },
                  responses: { '200': { description: 'Success' } },
                },
              },
            },
          } as OpenAPIV3.Document,
        },
      });
      await client.initialize();

      expect(client.getTools()[0].inputSchema).toMatchObject({
        required: ['body'],
        properties: {
          query: { type: ['integer', 'null'], format: 'int64' },
          header: { type: ['integer', 'null'], format: 'int64' },
          body: {
            required: ['parent_story_id'],
            properties: {
              parent_story_id: { type: ['integer', 'null'] },
              labels: { type: ['array', 'null'], items: { type: ['string', 'null'] } },
            },
            additionalProperties: { type: ['string', 'null'] },
          },
        },
      });
      expect(nullableInteger).toEqual({ type: 'integer', format: 'int64', nullable: true });
      expect(client.getTools()[0].requestBody?.content[contentType].schema).toEqual(bodySchema);
    },
  );

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
  // Header parameters must reach the generated inputSchema. callTool() already
  // reads `in: header` parameters back out of the tool arguments, but
  // generateInputSchema only emitted path/query/body, so an operation whose
  // per-call credential is a header (Authorization, X-API-Key, ...) was exposed
  // to the model as a zero-argument tool with no way to supply it.
  test('should expose header parameters in the generated input schema', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Header API', version: '1.0.0' },
          paths: {
            '/bearer/protected': {
              get: {
                operationId: 'bearerProtected',
                parameters: [
                  {
                    name: 'Authorization',
                    in: 'header',
                    required: true,
                    description: 'Bearer token in the form: Bearer <accessToken>',
                    schema: { type: 'string' },
                  },
                  {
                    name: 'X-Tenant-Id',
                    in: 'header',
                    required: false,
                    schema: { type: 'string' },
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
        Authorization: {
          type: 'string',
          description: 'Bearer token in the form: Bearer <accessToken>',
        },
        'X-Tenant-Id': {
          type: 'string',
          description: 'Header parameter: X-Tenant-Id',
        },
      },
      required: ['Authorization'],
    });
  });

  test('applies path-level parameters to every operation under the path', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {
            '/users/{userId}': {
              parameters: [
                {
                  name: 'userId',
                  in: 'path',
                  required: true,
                  description: 'User id',
                  schema: { type: 'string' },
                },
              ],
              get: {
                operationId: 'getUser',
                responses: { '200': { description: 'Success' } },
              },
              delete: {
                operationId: 'deleteUser',
                parameters: [{ name: 'force', in: 'query', schema: { type: 'boolean' } }],
                responses: { '204': { description: 'Deleted' } },
              },
            },
          },
        } as OpenAPIV3.Document,
      },
    };

    const client = new OpenAPIClient(config);
    await client.initialize();

    const [getUser, deleteUser] = client.getTools();
    expect(getUser.inputSchema).toEqual({
      type: 'object',
      properties: { userId: { type: 'string', description: 'User id' } },
      required: ['userId'],
    });
    expect(deleteUser.inputSchema).toEqual({
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User id' },
        force: { type: 'boolean', description: 'Query parameter: force' },
      },
      required: ['userId'],
    });

    const request = jest.fn().mockResolvedValue({ data: { ok: true } });
    (client as unknown as { httpClient: { request: jest.Mock } }).httpClient = { request };
    await client.callTool('deleteUser', { userId: 'u/1', force: true });
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'delete',
      url: '/users/u%2F1',
      params: { force: true },
    });
  });

  test('lets an operation parameter override a path-level one with the same name and location', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {
            '/reports': {
              parameters: [
                { name: 'format', in: 'query', description: 'Shared', schema: { type: 'string' } },
                { name: 'X-Tenant-Id', in: 'header', schema: { type: 'string' } },
              ],
              get: {
                operationId: 'listReports',
                parameters: [
                  {
                    name: 'format',
                    in: 'query',
                    required: true,
                    description: 'Report format',
                    schema: { type: 'string', enum: ['csv', 'json'] },
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
    expect(tool.parameters).toHaveLength(2);
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['csv', 'json'], description: 'Report format' },
        'X-Tenant-Id': { type: 'string', description: 'Header parameter: X-Tenant-Id' },
      },
      required: ['format'],
    });
  });
});
