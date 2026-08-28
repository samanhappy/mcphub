// Regression tests for #1098: since the #937 SSRF rework, resolving tool
// paths with `new URL` reference semantics dropped the server-declared base
// path ('/ping' against 'http://host/api' resolved to '/ping'), 404-ing every
// tool call for specs whose `servers` entry carries a base path. Requests
// must append onto the base path like axios's combineURLs did before #937,
// while the SSRF validation keeps running on the joined URL.

const instances: any[] = [];

const makeInstance = () => ({
  defaults: { headers: { common: {} as Record<string, string> } },
  interceptors: { request: { use: jest.fn() } },
  get: jest.fn(),
  request: jest.fn(),
});

jest.mock('axios', () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => {
        const instance = makeInstance();
        instances.push(instance);
        return instance;
      }),
      isAxiosError: () => false,
    },
  };
});

jest.mock('@apidevtools/swagger-parser', () => ({
  __esModule: true,
  default: {
    dereference: jest.fn(async (_url: unknown, doc: unknown) => doc),
  },
}));

const mockUserDao = { findByUsername: jest.fn() };

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: () => mockUserDao,
}));

import { OpenAPIClient } from '../../src/clients/openapi.js';

const PORT = 8443;
const HOST = `http://127.0.0.1:${PORT}`;

const specWithServers = (serverUrl: string | undefined) => ({
  openapi: '3.0.0',
  info: { title: 'Base Path API', version: '1.0.0' },
  ...(serverUrl ? { servers: [{ url: serverUrl }] } : {}),
  paths: {
    '/ping': {
      get: {
        operationId: 'ping',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
});

async function makeInitializedClient(serverUrl: string | undefined) {
  const client = new OpenAPIClient({
    name: 'basepath',
    type: 'openapi',
    owner: 'admin',
    openapi: { url: `${HOST}/v3/api-docs` },
  });
  instances[0].get.mockResolvedValue({
    data: JSON.stringify(specWithServers(serverUrl)),
    headers: {},
  });
  instances[0].request.mockResolvedValue({ data: { ok: true }, headers: {} });
  await client.initialize();
  return client;
}

beforeEach(() => {
  instances.length = 0;
  jest.clearAllMocks();
  mockUserDao.findByUsername.mockResolvedValue({ username: 'admin', isAdmin: true });
});

describe('OpenAPIClient tool call base path resolution (#1098)', () => {
  test('appends the operation path onto a server-declared base path', async () => {
    const client = await makeInitializedClient(`${HOST}/api/v1`);
    await client.callTool('ping', {});

    expect(instances[0].request.mock.calls[0][0]).toMatchObject({
      baseURL: HOST,
      url: '/api/v1/ping',
    });
  });

  test('strips a trailing slash from the base path instead of doubling it', async () => {
    const client = await makeInitializedClient(`${HOST}/api/v1/`);
    await client.callTool('ping', {});

    expect(instances[0].request.mock.calls[0][0]).toMatchObject({
      baseURL: HOST,
      url: '/api/v1/ping',
    });
  });

  test('keeps root-relative requests unchanged when servers has no base path', async () => {
    const client = await makeInitializedClient(HOST);
    await client.callTool('ping', {});

    expect(instances[0].request.mock.calls[0][0]).toMatchObject({
      baseURL: HOST,
      url: '/ping',
    });
  });

  test('keeps requests unchanged when the spec declares no servers at all', async () => {
    const client = await makeInitializedClient(undefined);
    await client.callTool('ping', {});

    // baseUrl falls back to the spec URL's origin.
    expect(instances[0].request.mock.calls[0][0]).toMatchObject({
      baseURL: HOST,
      url: '/ping',
    });
  });

  test('preserves query parameters alongside the joined base path', async () => {
    const client = await makeInitializedClient(`${HOST}/api/v1`);
    await client.callTool('ping', { q: 'hello' });

    const requestConfig = instances[0].request.mock.calls[0][0];
    expect(requestConfig).toMatchObject({
      baseURL: HOST,
      url: '/api/v1/ping',
      params: { q: 'hello' },
    });
  });
});
