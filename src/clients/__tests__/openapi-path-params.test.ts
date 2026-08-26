import { OpenAPIClient } from '../openapi.js';
import type { ServerConfig } from '../../types/index.js';

type TestClient = OpenAPIClient & {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    operationId: string;
    method: string;
    path: string;
    parameters?: unknown[];
  }>;
  httpClient: {
    request: jest.Mock;
  };
};

function createClient(tools: TestClient['tools']): TestClient {
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

  const client = new OpenAPIClient(config) as TestClient;
  client.tools = tools;
  client.httpClient = {
    request: jest.fn().mockResolvedValue({ data: { ok: true } }),
  };
  return client;
}

const pathParam = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
});

describe('OpenAPIClient - path parameter encoding (#1083)', () => {
  test('encodes URL-significant characters so the value cannot change the endpoint', async () => {
    const client = createClient([
      {
        name: 'get_record',
        description: 'Get a record by id',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'get_record',
        method: 'get',
        path: '/records/{id}',
        parameters: [pathParam('id')],
      },
    ]);

    const cases: Array<[unknown, string]> = [
      ['../../admin/config', '/records/..%2F..%2Fadmin%2Fconfig'],
      ['a?x=1', '/records/a%3Fx%3D1'],
      ['a#frag', '/records/a%23frag'],
      ['a b', '/records/a%20b'],
      ['100%', '/records/100%25'],
      [42, '/records/42'],
    ];

    for (const [id, expectedUrl] of cases) {
      await client.callTool('get_record', { id });
      const requestConfig = client.httpClient.request.mock.calls.at(-1)[0];
      expect(requestConfig.url).toBe(expectedUrl);
    }
  });

  test('encodes array values part by part, joining with literal commas', async () => {
    const client = createClient([
      {
        name: 'list_by_tags',
        description: 'List records by tags',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'list_by_tags',
        method: 'get',
        path: '/records/tags/{tags}',
        parameters: [pathParam('tags')],
      },
    ]);

    await client.callTool('list_by_tags', { tags: ['a/b', 'c'] });

    const requestConfig = client.httpClient.request.mock.calls[0][0];
    expect(requestConfig.url).toBe('/records/tags/a%2Fb,c');
  });

  test('encodes object values as comma-joined key,value pairs', async () => {
    const client = createClient([
      {
        name: 'find_user',
        description: 'Find a user',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'find_user',
        method: 'get',
        path: '/users/{filter}',
        parameters: [pathParam('filter')],
      },
    ]);

    await client.callTool('find_user', { filter: { role: 'admin' } });

    const requestConfig = client.httpClient.request.mock.calls[0][0];
    expect(requestConfig.url).toBe('/users/role,admin');
  });

  test('substitutes every path parameter when several are present', async () => {
    const client = createClient([
      {
        name: 'get_tenant_record',
        description: 'Get a record within a tenant',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'get_tenant_record',
        method: 'get',
        path: '/tenants/{tenant}/records/{id}',
        parameters: [pathParam('tenant'), pathParam('id')],
      },
    ]);

    await client.callTool('get_tenant_record', { tenant: 'acme/eu', id: 'r?1' });

    const requestConfig = client.httpClient.request.mock.calls[0][0];
    expect(requestConfig.url).toBe('/tenants/acme%2Feu/records/r%3F1');
  });

  test('fails fast instead of sending an unsubstituted placeholder upstream', async () => {
    const client = createClient([
      {
        name: 'get_record',
        description: 'Get a record by id',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'get_record',
        method: 'get',
        path: '/records/{id}',
        parameters: [pathParam('id')],
      },
    ]);

    await expect(client.callTool('get_record', {})).rejects.toThrow(
      "Required path parameter 'id' is missing",
    );
    expect(client.httpClient.request).not.toHaveBeenCalled();
  });

  test('treats a null value as a missing path parameter', async () => {
    const client = createClient([
      {
        name: 'get_record',
        description: 'Get a record by id',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'get_record',
        method: 'get',
        path: '/records/{id}',
        parameters: [pathParam('id')],
      },
    ]);

    await expect(client.callTool('get_record', { id: null })).rejects.toThrow(
      "Required path parameter 'id' is missing",
    );
    expect(client.httpClient.request).not.toHaveBeenCalled();
  });
});
