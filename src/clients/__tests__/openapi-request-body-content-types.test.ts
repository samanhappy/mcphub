import { OpenAPIClient } from '../openapi.js';
import { ServerConfig } from '../../types/index.js';
import { OpenAPIV3 } from 'openapi-types';

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

async function createInitializedClient(spec: Record<string, unknown>): Promise<OpenAPIClient> {
  const config: ServerConfig = {
    type: 'openapi',
    openapi: {
      schema: {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        ...spec,
      } as OpenAPIV3.Document,
    },
  };

  const client = new OpenAPIClient(config);
  await client.initialize();
  return client;
}

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

describe('OpenAPIClient - non-JSON request body content types (#1078)', () => {
  describe('schema advertisement', () => {
    test('exposes multipart/form-data bodies with binary fields described as base64 strings', async () => {
      const client = await createInitializedClient({
        paths: {
          '/files': {
            post: {
              operationId: 'uploadFile',
              requestBody: {
                required: true,
                content: {
                  'multipart/form-data': {
                    schema: {
                      type: 'object',
                      properties: {
                        file: { type: 'string', format: 'binary', description: 'The file' },
                        comment: { type: 'string' },
                      },
                      required: ['file'],
                    },
                  },
                },
              },
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      });

      const tool = client.getTools()[0];
      const schema = JSON.parse(JSON.stringify(tool.inputSchema));
      const body = schema.properties.body;

      expect(schema.required).toContain('body');
      expect(body.type).toBe('object');
      expect(body.required).toEqual(['file']);
      expect(body.properties.comment).toEqual({ type: 'string' });
      expect(body.properties.file.type).toBe('string');
      expect(body.properties.file.format).toBeUndefined();
      expect(body.properties.file.description).toContain('The file');
      expect(body.properties.file.description).toContain('base64');
    });

    test('exposes application/x-www-form-urlencoded bodies like JSON ones', async () => {
      const client = await createInitializedClient({
        paths: {
          '/things': {
            post: {
              operationId: 'createThing',
              requestBody: {
                required: true,
                content: {
                  'application/x-www-form-urlencoded': {
                    schema: {
                      type: 'object',
                      properties: { name: { type: 'string' } },
                      required: ['name'],
                    },
                  },
                },
              },
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      });

      const tool = client.getTools()[0];
      const schema = JSON.parse(JSON.stringify(tool.inputSchema));

      expect(schema.required).toContain('body');
      expect(schema.properties.body).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      });
    });

    test('marks operations whose body content type is unsupported instead of staying silent', async () => {
      const client = await createInitializedClient({
        paths: {
          '/docs': {
            post: {
              operationId: 'uploadDoc',
              summary: 'Upload a doc',
              requestBody: {
                required: true,
                content: {
                  'text/xml': { schema: { type: 'string' } },
                },
              },
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      });

      const tool = client.getTools()[0];
      expect(tool.description).toContain('Upload a doc');
      expect(tool.description).toContain('[Unsupported request body content type(s): text/xml');

      const schema = JSON.parse(JSON.stringify(tool.inputSchema));
      expect(schema.properties.body).toBeUndefined();
    });

    test('still recognizes JSON media types declared with parameters', async () => {
      const client = await createInitializedClient({
        paths: {
          '/items': {
            post: {
              operationId: 'createItem',
              requestBody: {
                required: true,
                content: {
                  'application/json; charset=utf-8': {
                    schema: { type: 'object', properties: { id: { type: 'string' } } },
                  },
                },
              },
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      });

      const tool = client.getTools()[0];
      const schema = JSON.parse(JSON.stringify(tool.inputSchema));
      expect(schema.properties.body).toBeDefined();
      expect(tool.description).not.toContain('Unsupported');
    });
  });

  describe('outgoing serialization', () => {
    const urlencodedRequestBody = {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
    };

    const multipartRequestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              file: { type: 'string', format: 'binary' },
              comment: { type: 'string' },
            },
          },
        },
      },
    };

    test('sends urlencoded bodies as form data with the matching content type', async () => {
      const client = createClient([
        {
          name: 'create_thing',
          description: 'Create thing',
          inputSchema: { type: 'object', properties: {}, required: [] },
          operationId: 'create_thing',
          method: 'post',
          path: '/things',
          requestBody: urlencodedRequestBody,
        },
      ]);

      await client.callTool('create_thing', {
        body: { name: 'x y', tags: ['a', 'b'], meta: { k: 1 }, skip: null },
      });

      expect(client.httpClient.request).toHaveBeenCalledTimes(1);
      const requestConfig = client.httpClient.request.mock.calls[0][0];
      const expected = new URLSearchParams([
        ['name', 'x y'],
        ['tags', 'a'],
        ['tags', 'b'],
        ['meta', '{"k":1}'],
      ]).toString();
      expect(requestConfig.data).toBe(expected);
      expect(requestConfig.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    test('builds a real multipart body and decodes base64 file parts', async () => {
      const client = createClient([
        {
          name: 'upload_file',
          description: 'Upload a file',
          inputSchema: { type: 'object', properties: {}, required: [] },
          operationId: 'upload_file',
          method: 'post',
          path: '/files',
          requestBody: multipartRequestBody,
        },
      ]);

      await client.callTool('upload_file', {
        body: { file: Buffer.from('hello world').toString('base64'), comment: 'looks good' },
      });

      const requestConfig = client.httpClient.request.mock.calls[0][0];
      const contentType = requestConfig.headers['Content-Type'] as string;
      expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
      const boundary = contentType.split('boundary=')[1];

      const body = requestConfig.data as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      const text = body.toString('utf8');
      expect(text).toContain(`--${boundary}\r\n`);
      expect(text).toContain('Content-Disposition: form-data; name="file"; filename="upload"');
      expect(text).toContain('Content-Type: application/octet-stream');
      expect(text).toContain('hello world');
      expect(text).toContain('Content-Disposition: form-data; name="comment"');
      expect(text).toContain('\r\n\r\nlooks good\r\n');
      expect(text.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    });

    test('honors {content, filename, contentType} descriptors for multipart files', async () => {
      const client = createClient([
        {
          name: 'upload_file',
          description: 'Upload a file',
          inputSchema: { type: 'object', properties: {}, required: [] },
          operationId: 'upload_file',
          method: 'post',
          path: '/files',
          requestBody: multipartRequestBody,
        },
      ]);

      await client.callTool('upload_file', {
        body: {
          file: {
            content: Buffer.from('hello').toString('base64'),
            filename: 'a.png',
            contentType: 'image/png',
          },
        },
      });

      const requestConfig = client.httpClient.request.mock.calls[0][0];
      const text = (requestConfig.data as Buffer).toString('utf8');
      expect(text).toContain('Content-Disposition: form-data; name="file"; filename="a.png"');
      expect(text).toContain('Content-Type: image/png');
      expect(text).toContain('hello');
    });

    test('rejects invalid base64 in binary multipart fields', async () => {
      const client = createClient([
        {
          name: 'upload_file',
          description: 'Upload a file',
          inputSchema: { type: 'object', properties: {}, required: [] },
          operationId: 'upload_file',
          method: 'post',
          path: '/files',
          requestBody: multipartRequestBody,
        },
      ]);

      await expect(client.callTool('upload_file', { body: { file: 'not base64!!' } })).rejects.toThrow(
        /'file'.*base64/i,
      );
      expect(client.httpClient.request).not.toHaveBeenCalled();
    });

    test('fails fast with a clear error when the declared body content type is unsupported', async () => {
      const client = createClient([
        {
          name: 'upload_doc',
          description: 'Upload a doc',
          inputSchema: { type: 'object', properties: {}, required: [] },
          operationId: 'upload_doc',
          method: 'post',
          path: '/docs',
          requestBody: {
            required: true,
            content: {
              'text/xml': { schema: { type: 'string' } },
            },
          },
        },
      ]);

      await expect(client.callTool('upload_doc', { body: '<doc/>' })).rejects.toThrow(
        /unsupported content type\(s\): text\/xml/i,
      );
      expect(client.httpClient.request).not.toHaveBeenCalled();
    });
  });
});
