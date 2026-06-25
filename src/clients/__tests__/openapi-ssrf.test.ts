import { OpenAPIClient } from '../openapi.js';
import type { ServerConfig } from '../../types/index.js';
import { UnsafeUrlError } from '../../utils/ssrf.js';

type TestClient = OpenAPIClient & {
  baseUrl: string;
  allowInternalNetworks: boolean;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    operationId: string;
    method: string;
    path: string;
  }>;
  httpClient: { request: jest.Mock };
};

jest.mock('../../dao/index.js', () => ({
  getUserDao: () => ({
    findByUsername: jest.fn().mockResolvedValue({ isAdmin: false }),
  }),
}));

const baseConfig: ServerConfig = {
  type: 'openapi',
  openapi: {
    schema: {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
    },
  },
};

function makeClient(baseUrl: string): TestClient {
  const client = new OpenAPIClient(baseConfig) as TestClient;
  client.baseUrl = baseUrl;
  client.tools = [
    {
      name: 'read_internal',
      description: 'read',
      inputSchema: { type: 'object', properties: {}, required: [] },
      operationId: 'read_internal',
      method: 'get',
      path: '/latest/meta-data/iam/creds',
    },
  ];
  client.httpClient = { request: jest.fn() };
  return client;
}

describe('OpenAPIClient - SSRF guard on the request path', () => {
  it('rejects a callTool whose baseURL is loopback and never sends the request', async () => {
    const client = makeClient('http://127.0.0.1:8181');
    await expect(client.callTool('read_internal', {})).rejects.toThrow(
      UnsafeUrlError,
    );
    expect(client.httpClient.request).not.toHaveBeenCalled();
  });

  it('rejects the cloud metadata endpoint as baseURL', async () => {
    const client = makeClient('http://169.254.169.254');
    await expect(client.callTool('read_internal', {})).rejects.toThrow(
      UnsafeUrlError,
    );
    expect(client.httpClient.request).not.toHaveBeenCalled();
  });

  it('rejects a private RFC1918 baseURL', async () => {
    const client = makeClient('http://10.0.0.5');
    await expect(client.callTool('read_internal', {})).rejects.toThrow(
      UnsafeUrlError,
    );
    expect(client.httpClient.request).not.toHaveBeenCalled();
  });

  it('rejects an absolute tool path that overrides baseURL to an internal host', async () => {
    const client = makeClient('http://8.8.8.8');
    client.tools[0].path = 'http://127.0.0.1:8181/internal';
    await expect(client.callTool('read_internal', {})).rejects.toThrow(
      UnsafeUrlError,
    );
    expect(client.httpClient.request).not.toHaveBeenCalled();
  });

  it('allows and sends a request to a public IP target', async () => {
    const client = makeClient('http://8.8.8.8');
    client.httpClient.request.mockResolvedValue({ data: 'ok' });
    await expect(client.callTool('read_internal', {})).resolves.toBe('ok');
    expect(client.httpClient.request).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAPIClient - admin-owned server bypasses internal-IP block', () => {
  it('callTool allows loopback when allowInternalNetworks is set', async () => {
    const client = makeClient('http://127.0.0.1:8181');
    client.allowInternalNetworks = true;
    client.httpClient.request.mockResolvedValue({ data: 'ok' });
    await expect(client.callTool('read_internal', {})).resolves.toBe('ok');
    expect(client.httpClient.request).toHaveBeenCalledTimes(1);
  });

  it('callTool allows metadata endpoint when allowInternalNetworks is set', async () => {
    const client = makeClient('http://169.254.169.254');
    client.allowInternalNetworks = true;
    client.httpClient.request.mockResolvedValue({ data: 'creds' });
    await expect(client.callTool('read_internal', {})).resolves.toBe('creds');
    expect(client.httpClient.request).toHaveBeenCalledTimes(1);
  });
});
