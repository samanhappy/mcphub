import { OpenAPIClient } from '../openapi.js';
import { ServerConfig } from '../../types/index.js';
import { OpenAPIV3 } from 'openapi-types';

type TestClient = OpenAPIClient & {
  baseUrl: string;
  allowInternalNetworks: boolean;
  httpClient: { request: jest.Mock };
};

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

    const client = new OpenAPIClient(config) as TestClient;
    await client.initialize();

    // After substitution '{server}/api/v1' -> 'http://localhost:5055/api/v1',
    // the resolved base must be the substituted server URL — not the spec
    // source host (raw.githubusercontent.com) that 404'd before the fix.
    expect(client.baseUrl).toBe('http://localhost:5055/api/v1');

    // The axios instance carries no user-derived default baseURL: each
    // request's host is resolved and SSRF-validated explicitly in callTool, so
    // a user-supplied default must not taint the client (CodeQL tracks a
    // client's default baseURL as the host of every request it makes). Tool
    // calls resolve their relative path onto the substituted base with append
    // semantics — #1098 restored that after the #937 SSRF rework switched to
    // `new URL` reference resolution, which dropped the '/api/v1' base path.
    client.allowInternalNetworks = true;
    client.httpClient = { request: jest.fn().mockResolvedValue({ data: 'ok' }) };
    await expect(client.callTool('get_status', {})).resolves.toBe('ok');
    const requestConfig = client.httpClient.request.mock.calls[0][0];
    expect(requestConfig.baseURL).toBe('http://localhost:5055');
    expect(requestConfig.url).toBe('/api/v1/status');
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

    const client = new OpenAPIClient(config) as TestClient;
    await client.initialize();

    expect(client.baseUrl).toBe('https://api.example.com/v2');
  });
});
