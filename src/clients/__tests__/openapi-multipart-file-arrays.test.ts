import { OpenAPIClient } from '../openapi.js';

async function createUploadClient() {
  const client = new OpenAPIClient({
    type: 'openapi',
    openapi: {
      schema: {
        openapi: '3.0.0',
        info: { title: 'Multi-file upload', version: '1.0.0' },
        paths: {
          '/files': {
            post: {
              operationId: 'uploadFiles',
              requestBody: {
                required: true,
                content: {
                  'multipart/form-data': {
                    schema: {
                      type: 'object',
                      properties: {
                        files: { type: 'array', items: { type: 'string', format: 'binary' } },
                        tags: { type: 'array', items: { type: 'string' } },
                      },
                      required: ['files'],
                    },
                  },
                },
              },
              responses: { '200': { description: 'Uploaded' } },
            },
          },
        },
      },
    },
  });
  await client.initialize();
  const request = jest.fn().mockResolvedValue({ data: { ok: true } });
  (client as unknown as { httpClient: { request: jest.Mock } }).httpClient = { request };
  return { client, request, tool: client.getTools()[0] };
}

describe('OpenAPIClient multipart file arrays', () => {
  test('uploads advertised base64 array items as repeated binary file parts', async () => {
    const { client, request, tool } = await createUploadClient();
    expect(tool.inputSchema).toMatchObject({
      properties: {
        body: {
          properties: {
            files: {
              type: 'array',
              items: { type: 'string', description: expect.stringContaining('base64') },
            },
          },
        },
      },
    });
    const files = [Buffer.from([0, 255, 128, 13, 10]), Buffer.from('second file')];
    await client.callTool(tool.name, {
      body: { files: files.map((file) => file.toString('base64')), tags: ['first', 'second'] },
    });

    expect(request).toHaveBeenCalledTimes(1);
    const config = request.mock.calls[0][0];
    const boundary = config.headers['Content-Type'].split('boundary=')[1];
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="upload"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    expect(config.data).toEqual(
      Buffer.concat([
        Buffer.from(fileHeader),
        files[0],
        Buffer.from('\r\n'),
        Buffer.from(fileHeader),
        files[1],
        Buffer.from('\r\n'),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\nfirst\r\n`,
        ),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\nsecond\r\n`,
        ),
        Buffer.from(`--${boundary}--\r\n`),
      ]),
    );
  });

  test('rejects invalid base64 array items before sending a request', async () => {
    const { client, request, tool } = await createUploadClient();
    await expect(
      client.callTool(tool.name, {
        body: { files: [Buffer.from('valid').toString('base64'), 'not base64!!'] },
      }),
    ).rejects.toThrow(/'files'.*base64/i);
    expect(request).not.toHaveBeenCalled();
  });

  test('preserves file descriptors within binary arrays', async () => {
    const { client, request, tool } = await createUploadClient();
    await client.callTool(tool.name, {
      body: { files: [{ content: 'aGk=', filename: 'hello.txt', contentType: 'text/plain' }] },
    });
    expect(request.mock.calls[0][0].data.toString()).toContain(
      'name="files"; filename="hello.txt"\r\nContent-Type: text/plain\r\n\r\nhi\r\n',
    );
  });
});
