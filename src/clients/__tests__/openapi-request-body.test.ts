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
    requestBody?: Record<string, unknown> | null;
  }>;
  httpClient: {
    request: jest.Mock;
  };
};

const jsonRequestBody = {
  required: true,
  content: {
    'application/json': {
      schema: { type: 'array', items: { type: 'string' } },
    },
  },
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

describe('OpenAPIClient - request body handling (#1084)', () => {
  test('sends the request body on DELETE when the operation declares one', async () => {
    const client = createClient([
      {
        name: 'delete_objects',
        description: 'Bulk delete objects',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'delete_objects',
        method: 'delete',
        path: '/objects',
        requestBody: jsonRequestBody,
      },
    ]);

    await client.callTool('delete_objects', { body: ['id-1', 'id-2'] });

    expect(client.httpClient.request).toHaveBeenCalledTimes(1);
    const requestConfig = client.httpClient.request.mock.calls[0][0];
    expect(requestConfig.method).toBe('delete');
    expect(requestConfig.url).toBe('/objects');
    expect(requestConfig.data).toEqual(['id-1', 'id-2']);
  });

  test('does not attach a body on DELETE when the spec declares none', async () => {
    const client = createClient([
      {
        name: 'delete_object',
        description: 'Delete object by id',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'delete_object',
        method: 'delete',
        path: '/objects/{id}',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: null,
      },
    ]);

    await client.callTool('delete_object', { id: 'id-1', body: ['unexpected'] });

    const requestConfig = client.httpClient.request.mock.calls[0][0];
    expect(requestConfig.method).toBe('delete');
    expect(requestConfig.url).toBe('/objects/id-1');
    expect(requestConfig.data).toBeUndefined();
  });

  test('still attaches the request body on POST operations', async () => {
    const client = createClient([
      {
        name: 'create_object',
        description: 'Create object',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'create_object',
        method: 'post',
        path: '/objects',
        requestBody: jsonRequestBody,
      },
    ]);

    await client.callTool('create_object', { body: { name: 'x' } });

    const requestConfig = client.httpClient.request.mock.calls[0][0];
    expect(requestConfig.method).toBe('post');
    expect(requestConfig.data).toEqual({ name: 'x' });
  });

  test('sends a declared body even when its value is falsy but present', async () => {
    const client = createClient([
      {
        name: 'replace_flags',
        description: 'Replace flags',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'replace_flags',
        method: 'put',
        path: '/flags',
        requestBody: jsonRequestBody,
      },
    ]);

    await client.callTool('replace_flags', { body: [] });

    const requestConfig = client.httpClient.request.mock.calls[0][0];
    expect(requestConfig.data).toEqual([]);
  });
});
