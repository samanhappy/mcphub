import { OpenAPIClient } from '../openapi.js';
import { ServerConfig } from '../../types/index.js';
import { OpenAPIV3 } from 'openapi-types';

describe('OpenAPIClient - server URL template variables', () => {
  // Regression: specs like seerr's declare
  //   servers:
  //     - url: '{server}/api/v1'
  //       variables:
  //         server:
  //           default: http://localhost:5055
  // The OpenAPI spec requires {variable} templates in a server URL to be
  // substituted with the variable's `default` (or an override). mcphub took
  // server.url literally, so '{server}/api/v1' was misclassified as a relative
  // path and glued onto the spec source host (e.g. raw.githubusercontent.com),
  // making every tool call 404. See issue #959 follow-up.
  test('substitutes server URL template variables with their defaults', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Templated API', version: '1.0.0' },
          paths: {
            '/status': {
              get: {
                operationId: 'get_status',
                summary: 'Get status',
                responses: { '200': { description: 'ok' } },
              },
            },
          },
          servers: [
            {
              url: '{server}/api/v1',
              variables: {
                server: { default: 'http://localhost:5055' },
              },
            },
          ],
        } as OpenAPIV3.Document,
      },
    };

    const client = new OpenAPIClient(config) as OpenAPIClient & {
      httpClient: { defaults: { baseURL: string } };
    };
    await client.initialize();

    // After substitution '{server}/api/v1' -> 'http://localhost:5055/api/v1',
    // which is an absolute URL and must become the axios baseURL verbatim.
    expect(client.httpClient.defaults.baseURL).toBe('http://localhost:5055/api/v1');

    const tool = client.getTools().find((t) => t.name === 'get_status');
    expect(tool).toBeDefined();
    expect(tool!.path).toBe('/status');
    // Axios concatenates baseURL + relative path (preserving the /api/v1 prefix),
    // so the upstream target is http://localhost:5055/api/v1/status — not the
    // spec source host (raw.githubusercontent.com) that 404'd before the fix.
  });

  // A non-templated server URL must keep working unchanged.
  test('leaves absolute server URLs without variables untouched', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Abs API', version: '1.0.0' },
          paths: {
            '/ping': {
              get: {
                operationId: 'ping',
                responses: { '200': { description: 'ok' } },
              },
            },
          },
          servers: [{ url: 'https://api.example.com/v2' }],
        } as OpenAPIV3.Document,
      },
    };

    const client = new OpenAPIClient(config) as OpenAPIClient & {
      httpClient: { defaults: { baseURL: string } };
    };
    await client.initialize();

    expect(client.httpClient.defaults.baseURL).toBe('https://api.example.com/v2');
  });
});
