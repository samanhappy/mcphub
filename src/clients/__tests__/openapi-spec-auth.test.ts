import axios from 'axios';
import { OpenAPIClient } from '../openapi.js';
import type { ServerConfig } from '../../types/index.js';
import { UnsafeUrlError } from '../../utils/ssrf.js';

// Shared mock so per-tests can toggle admin status. getUserDao() returns a new
// object each call but always the same findByUsername reference.
jest.mock('../../dao/index.js', () => {
  const findByUsername = jest.fn();
  return { getUserDao: () => ({ findByUsername }) };
});

import { getUserDao } from '../../dao/index.js';

const findByUsername = (getUserDao() as { findByUsername: jest.Mock }).findByUsername;

const SPEC_URL = 'http://8.8.8.8/v3/api-docs';
const INTERNAL_SPEC_URL = 'http://127.0.0.1:8081/v3/api-docs';

const minimalSpec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/things': {
      get: {
        operationId: 'get_things',
        responses: { '200': { description: 'ok' } },
      },
    },
  },
});

const yamlSpec = [
  'openapi: 3.0.0',
  'info:',
  '  title: Test API',
  '  version: 1.0.0',
  'paths:',
  '  /things:',
  '    get:',
  '      operationId: get_things',
  "      responses:",
  "        '200':",
  '          description: ok',
].join('\n');

type TestClient = OpenAPIClient & {
  httpClient: {
    get: jest.Mock;
    defaults: { adapter?: unknown; headers: { common: Record<string, string> } };
  };
};

// Install a capturing adapter so we can assert on the fully-merged outgoing
// request headers (defaults + per-request) without touching the network. axios
// flattens defaults.headers.common / method buckets into config.headers before
// the adapter runs, so this is the faithful place to verify auth is attached.
function installCapturingAdapter(client: TestClient, body: unknown, captured: { v: unknown }) {
  client.httpClient.defaults.adapter = (config: any) => {
    captured.v = config;
    return Promise.resolve({
      data: body,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  findByUsername.mockReset();
  findByUsername.mockResolvedValue(null);
  // Safety net: any accidental external fetch (e.g. an unexpected $ref) hits a
  // mock instead of the real network.
  (globalThis as { fetch: unknown }).fetch = jest.fn();
});

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = originalFetch;
});

describe('OpenAPIClient - authenticated spec document fetch (#1044)', () => {
  it('applies configured HTTP Basic credentials to the document download', async () => {
    const credentials = Buffer.from('user:pass').toString('base64');
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: SPEC_URL,
        security: { type: 'http', http: { scheme: 'basic', credentials } },
      },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const captured = { v: null as unknown };
    installCapturingAdapter(client, minimalSpec, captured);

    await client.initialize();

    const headers = (captured.v as { headers: { get: (n: string) => string } }).headers;
    expect(headers.get('Authorization')).toBe(`Basic ${credentials}`);
    expect((captured.v as { url: string }).url).toBe(SPEC_URL);
    expect(client.getTools().some((t) => t.name === 'get_things')).toBe(true);
  });

  it('honors static config.headers on the document download', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      headers: { 'X-Custom': 'doc-fetch-value' },
      openapi: { url: SPEC_URL },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const captured = { v: null as unknown };
    installCapturingAdapter(client, minimalSpec, captured);

    await client.initialize();

    const headers = (captured.v as { headers: { get: (n: string) => string } }).headers;
    expect(headers.get('X-Custom')).toBe('doc-fetch-value');
  });

  it('fails with a sanitized message when credentials are incorrect', async () => {
    const credentials = Buffer.from('admin:wrongpassword').toString('base64');
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: SPEC_URL,
        security: { type: 'http', http: { scheme: 'basic', credentials } },
      },
    };
    const client = new OpenAPIClient(config) as TestClient;
    client.httpClient.defaults.adapter = () =>
      Promise.reject(
        new axios.AxiosError(
          'Request failed with status code 401',
          'ERR_BAD_REQUEST',
          {},
          {},
          { status: 401, statusText: 'Unauthorized', data: null, headers: {}, config: {} },
        ),
      );

    await expect(client.initialize()).rejects.toThrow('Failed to load OpenAPI specification');
    await expect(client.initialize()).rejects.not.toThrow('wrongpassword');
    await expect(client.initialize()).rejects.not.toThrow(credentials);
  });

  it('parses a YAML spec document fetched with credentials', async () => {
    const credentials = Buffer.from('user:pass').toString('base64');
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: SPEC_URL,
        security: { type: 'http', http: { scheme: 'basic', credentials } },
      },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const captured = { v: null as unknown };
    installCapturingAdapter(client, yamlSpec, captured);

    await client.initialize();

    expect((captured.v as { headers: { get: (n: string) => string } }).headers.get('Authorization')).toBe(
      `Basic ${credentials}`,
    );
    expect(client.getTools().some((t) => t.name === 'get_things')).toBe(true);
  });

  it('leaves the inline schema branch unchanged (no document fetch)', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {
            '/things': {
              get: {
                operationId: 'get_things',
                responses: { '200': { description: 'ok' } },
              },
            },
          },
        },
      },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const getMock = jest.fn();
    (client.httpClient as unknown as { get: jest.Mock }).get = getMock;

    await client.initialize();

    expect(getMock).not.toHaveBeenCalled();
    expect(client.getTools().some((t) => t.name === 'get_things')).toBe(true);
  });

  it('blocks an internal spec URL for non-admin owners (SSRF)', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      owner: 'regular',
      openapi: { url: INTERNAL_SPEC_URL },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const getMock = jest.fn();
    (client.httpClient as unknown as { get: jest.Mock }).get = getMock;

    await expect(client.initialize()).rejects.toThrow(UnsafeUrlError);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('allows an internal spec URL for admin owners and authenticates the fetch', async () => {
    findByUsername.mockResolvedValue({ isAdmin: true });
    const credentials = Buffer.from('user:pass').toString('base64');
    const config: ServerConfig = {
      type: 'openapi',
      owner: 'admin',
      openapi: {
        url: INTERNAL_SPEC_URL,
        security: { type: 'http', http: { scheme: 'basic', credentials } },
      },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const captured = { v: null as unknown };
    installCapturingAdapter(client, minimalSpec, captured);

    await client.initialize();

    expect((captured.v as { headers: { get: (n: string) => string } }).headers.get('Authorization')).toBe(
      `Basic ${credentials}`,
    );
    expect(client.getTools().some((t) => t.name === 'get_things')).toBe(true);
  });

  it('does not forward credentials to a cross-origin external $ref', async () => {
    const credentials = Buffer.from('user:pass').toString('base64');
    const externalUrl = 'https://external.example.com/schema.json';
    const docWithExternalRef = JSON.stringify({
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
                  'application/json': { schema: { $ref: `${externalUrl}#/Thing` } },
                },
              },
            },
          },
        },
      },
    });
    const subSchema = JSON.stringify({ Thing: { type: 'object', properties: { id: { type: 'string' } } } });

    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: SPEC_URL,
        security: { type: 'http', http: { scheme: 'basic', credentials } },
      },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const captured = { v: null as unknown };
    installCapturingAdapter(client, docWithExternalRef, captured);

    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      body: Buffer.from(subSchema),
      arrayBuffer: async () => new TextEncoder().encode(subSchema),
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    await client.initialize();

    // Main document fetch (axios) carried the credentials...
    expect((captured.v as { headers: { get: (n: string) => string } }).headers.get('Authorization')).toBe(
      `Basic ${credentials}`,
    );
    // ...but the external $ref resolution (SwaggerParser's own resolver) did not.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'GET' }),
    );
    const externalHeaders = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(externalHeaders).toEqual({});
    expect(externalHeaders.Authorization).toBeUndefined();
    expect(client.getTools().some((t) => t.name === 'get_things')).toBe(true);
  });

  it('applies a static apiKey cookie to the document download', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: SPEC_URL,
        security: {
          type: 'apiKey',
          apiKey: { name: 'session', in: 'cookie', value: 'abc123' },
        },
      },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const captured = { v: null as unknown };
    installCapturingAdapter(client, minimalSpec, captured);

    await client.initialize();

    expect((captured.v as { headers: { get: (n: string) => string } }).headers.get('Cookie')).toBe(
      'session=abc123',
    );
    expect(client.getTools().some((t) => t.name === 'get_things')).toBe(true);
  });

  it('fetches an OAuth2 client-credentials token before the document download', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        url: SPEC_URL,
        security: {
          type: 'oauth2',
          oauth2: {
            tokenUrl: 'https://auth.example.com/oauth/token',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            token: '',
          },
        },
      },
    };
    const client = new OpenAPIClient(config) as TestClient;
    const captured = { v: null as unknown };
    // Both the token POST (httpClient.request) and the doc GET (httpClient.get)
    // route through the configured adapter; differentiate by method.
    let tokenFetchIndex: number | null = null;
    let docFetchIndex: number | null = null;
    let callCount = 0;
    client.httpClient.defaults.adapter = (cfg: any) => {
      callCount += 1;
      if (cfg.method === 'post') {
        tokenFetchIndex = callCount;
        return Promise.resolve({
          data: { access_token: 'fresh-token', expires_in: 3600 },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: cfg,
        });
      }
      docFetchIndex = callCount;
      captured.v = cfg;
      return Promise.resolve({ data: minimalSpec, status: 200, statusText: 'OK', headers: {}, config: cfg });
    };

    await client.initialize();

    expect(tokenFetchIndex).not.toBeNull();
    expect(docFetchIndex).not.toBeNull();
    expect(tokenFetchIndex!).toBeLessThan(docFetchIndex!);
    expect(
      (captured.v as { headers: { get: (n: string) => string } }).headers.get('Authorization'),
    ).toBe('Bearer fresh-token');
    expect(client.getTools().some((t) => t.name === 'get_things')).toBe(true);
  });
});
