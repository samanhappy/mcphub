import { OpenAPIClient } from '../openapi.js';
import type { ServerConfig } from '../../types/index.js';
import { UnsafeUrlError } from '../../utils/ssrf.js';

type TestClient = OpenAPIClient & {
  baseUrl: string;
  allowInternalNetworks: boolean;
  spec: Record<string, unknown> | null;
  httpClient: { get?: jest.Mock; request: jest.Mock };
};

jest.mock('../../dao/index.js', () => {
  const findByUsername = jest.fn();
  return { getUserDao: () => ({ findByUsername }) };
});

import { getUserDao } from '../../dao/index.js';

const findByUsername = (getUserDao() as unknown as { findByUsername: jest.Mock }).findByUsername;

function specWithExternalRef(ref: string): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    info: { title: 'Test API', version: '1.0.0' },
    paths: {
      '/things': {
        get: {
          operationId: 'get_things',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { $ref: ref },
                },
              },
            },
          },
        },
      },
    },
  };
}

function makeSchemaClient(ref: string, owner?: string): TestClient {
  const config: ServerConfig = {
    type: 'openapi',
    owner,
    openapi: { schema: specWithExternalRef(ref) as never },
  };
  const client = new OpenAPIClient(config) as TestClient;
  client.httpClient = { request: jest.fn() };
  return client;
}

function makeUrlClient(rawSpec: string): TestClient {
  const config: ServerConfig = {
    type: 'openapi',
    openapi: { url: 'http://93.184.216.34/v3/api-docs' },
  };
  const client = new OpenAPIClient(config) as TestClient;
  client.httpClient = {
    get: jest.fn().mockResolvedValue({ data: rawSpec }),
    request: jest.fn(),
  };
  return client;
}

// Response-like stub matching what createRedirectValidatingFetch consumes.
const refFetchResponse = (body: string) => ({
  status: 200,
  headers: { get: () => null },
  body: Buffer.from(body),
  arrayBuffer: async () => new TextEncoder().encode(body),
});

describe('OpenAPIClient - SSRF guard on external $ref resolution', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    findByUsername.mockReset();
    findByUsername.mockResolvedValue(undefined);
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('blocks an inline-schema $ref to an internal host and never dials', async () => {
    const client = makeSchemaClient('http://127.0.0.1:9/ext.json#/schemas/Secret');
    await expect(client.initialize()).rejects.toThrow(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks an inline-schema $ref to the cloud metadata endpoint', async () => {
    const client = makeSchemaClient('http://169.254.169.254/latest/meta-data/');
    await expect(client.initialize()).rejects.toThrow(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still resolves a $ref to a public IP host through the guarded resolver', async () => {
    const client = makeSchemaClient('http://93.184.216.34/ext.json#/schemas/Secret');
    fetchMock.mockResolvedValue(
      refFetchResponse(JSON.stringify({ schemas: { Secret: { type: 'object' } } })),
    );
    await expect(client.initialize()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://93.184.216.34/ext.json');
    // No credentials on external $ref fetches (#1044 semantics preserved).
    expect((fetchMock.mock.calls[0][1] as { headers: unknown }).headers).toEqual({});
  });

  it('allows an internal-host $ref for admin-owned servers', async () => {
    findByUsername.mockResolvedValue({ isAdmin: true });
    const client = makeSchemaClient(
      'http://127.0.0.1:8081/internal.json#/schemas/Secret',
      'boss',
    );
    fetchMock.mockResolvedValue(
      refFetchResponse(JSON.stringify({ schemas: { Secret: { type: 'object' } } })),
    );
    await expect(client.initialize()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks local file:// $refs for non-admin-owned servers', async () => {
    const client = makeSchemaClient('./stolen-secret.yaml');
    await expect(client.initialize()).rejects.toThrow(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('guards external $refs fetched while loading a URL-based spec too', async () => {
    const client = makeUrlClient(JSON.stringify(specWithExternalRef('#/noop')));
    // Replace the main document with one containing an internal absolute ref
    // AFTER construction so only the $ref resolution path sees it.
    (client as unknown as { httpClient: { get: jest.Mock } }).httpClient.get.mockResolvedValue({
      data: JSON.stringify(specWithExternalRef('http://169.254.169.254/meta')),
    });
    await expect(client.initialize()).rejects.toThrow(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
