import { previewOpenApiToolStats } from '../../src/services/openApiToolStatsService.js';
import { ServerConfig } from '../../src/types/index.js';
import { OpenAPIV3 } from 'openapi-types';

const buildConfig = (schema: OpenAPIV3.Document): ServerConfig => ({
  type: 'openapi',
  openapi: { schema },
});

const baseSchema = (): OpenAPIV3.Document => ({
  openapi: '3.0.0',
  info: { title: 'Preview API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users',
        responses: { '200': { description: 'Success' } },
      },
    },
    '/users/{id}': {
      delete: {
        operationId: 'deleteUser',
        summary: 'Delete a user',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: { '204': { description: 'Deleted' } },
      },
    },
  },
});

describe('previewOpenApiToolStats', () => {
  test('counts tools and measures the generated definitions for an inline schema', async () => {
    const stats = await previewOpenApiToolStats(buildConfig(baseSchema()));

    expect(stats.toolCount).toBe(2);
    expect(stats.definitionsBytes).toBeGreaterThan(0);
    expect(stats.estimatedTokens).toBeGreaterThan(0);

    // Deterministic: an identical spec yields identical numbers.
    const again = await previewOpenApiToolStats(buildConfig(baseSchema()));
    expect(again).toEqual(stats);
  });

  test('reports zeros for a spec without paths', async () => {
    const schema = baseSchema();
    schema.paths = {};
    const stats = await previewOpenApiToolStats(buildConfig(schema));

    expect(stats.toolCount).toBe(0);
    expect(stats.definitionsBytes).toBeGreaterThan(0); // "[]" still serializes
    expect(stats.estimatedTokens).toBe(0);
  });

  test('scales with the number of operations', async () => {
    const small = await previewOpenApiToolStats(buildConfig(baseSchema()));

    const bigger = baseSchema();
    for (let i = 0; i < 5; i++) {
      bigger.paths![`/items/${i}`] = {
        get: {
          operationId: `getItem${i}`,
          summary: `Get item ${i}`,
          responses: { '200': { description: 'Success' } },
        },
      };
    }
    const large = await previewOpenApiToolStats(buildConfig(bigger));

    expect(large.toolCount).toBe(small.toolCount + 5);
    expect(large.estimatedTokens).toBeGreaterThanOrEqual(small.estimatedTokens);
  });

  test('reports the declared security requirement for form prefill (#1077)', async () => {
    const schema = baseSchema();
    schema.security = [{ 'Bearer Auth': [] }];
    schema.components = {
      securitySchemes: {
        'Bearer Auth': { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    };

    const stats = await previewOpenApiToolStats(buildConfig(schema));

    expect(stats.declaredSecurity).toEqual(
      expect.objectContaining({
        declared: true,
        supported: true,
        summary: 'HTTP bearer (JWT)',
        prefill: { type: 'http', http: { scheme: 'bearer', bearerFormat: 'JWT' } },
      }),
    );
  });

  test('rejects when the schema cannot be parsed', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        // Missing the required openapi/info fields — SwaggerParser rejects it.
        schema: {} as OpenAPIV3.Document,
      },
    };

    await expect(previewOpenApiToolStats(config)).rejects.toThrow();
  });

  test('rejects when neither url nor schema is provided', async () => {
    const config: ServerConfig = { type: 'openapi', openapi: {} as any };
    await expect(previewOpenApiToolStats(config)).rejects.toThrow(
      'OpenAPI URL or schema is required',
    );
  });
});
