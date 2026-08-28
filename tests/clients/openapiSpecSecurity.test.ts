// Tests for the `openapi.specSecurity` credential slot (#1079): a dedicated
// axios instance used only to download the specification document when the
// spec endpoint authenticates differently from the API, plus the automatic
// encoding of raw `user:pass` HTTP Basic credentials.

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

const SPEC_URL = 'http://127.0.0.1:8443/v3/api-docs';

const specDocument = {
  openapi: '3.0.0',
  info: { title: 'Layered API', version: '1.0.0' },
  servers: [{ url: 'http://127.0.0.1:8443/api' }],
  paths: {
    '/ping': {
      get: {
        operationId: 'ping',
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

const baseConfig = (openapi: Record<string, unknown>) => ({
  name: 'layered',
  type: 'openapi' as const,
  owner: 'admin',
  openapi,
});

beforeEach(() => {
  instances.length = 0;
  jest.clearAllMocks();
  mockUserDao.findByUsername.mockResolvedValue({ username: 'admin', isAdmin: true });
});

describe('OpenAPIClient specSecurity', () => {
  test('downloads the spec with specSecurity credentials while API calls keep security', async () => {
    const client = new OpenAPIClient(
      baseConfig({
        url: SPEC_URL,
        security: { type: 'http', http: { scheme: 'bearer', credentials: 'api-token' } },
        specSecurity: { type: 'http', http: { scheme: 'basic', credentials: 'admin:s3cret' } },
      }),
    );

    // Two instances: main first, spec-download second.
    expect(instances).toHaveLength(2);
    expect(instances[0].defaults.headers.common['Authorization']).toBe('Bearer api-token');
    expect(instances[1].defaults.headers.common['Authorization']).toBe(
      `Basic ${Buffer.from('admin:s3cret', 'utf8').toString('base64')}`,
    );

    instances[1].get.mockResolvedValue({ data: JSON.stringify(specDocument), headers: {} });
    instances[0].request.mockResolvedValue({ data: { ok: true }, headers: {} });

    await client.initialize();

    // The document download went through the spec client, never the main one.
    expect(instances[1].get).toHaveBeenCalledTimes(1);
    expect(instances[1].get.mock.calls[0][0]).toBe(SPEC_URL);
    expect(instances[0].get).not.toHaveBeenCalled();

    // And API calls go through the main client.
    await client.callTool('ping', {});
    expect(instances[0].request).toHaveBeenCalledTimes(1);
    expect(instances[1].request).not.toHaveBeenCalled();
  });

  test('without specSecurity the spec download reuses the main client', async () => {
    const client = new OpenAPIClient(
      baseConfig({
        url: SPEC_URL,
        security: { type: 'http', http: { scheme: 'basic', credentials: 'admin:s3cret' } },
      }),
    );

    expect(instances).toHaveLength(1);
    instances[0].get.mockResolvedValue({ data: JSON.stringify(specDocument), headers: {} });

    await client.initialize();

    expect(instances[0].get).toHaveBeenCalledTimes(1);
    expect(instances[0].get.mock.calls[0][0]).toBe(SPEC_URL);
  });

  test('specSecurity type none does not create a second instance', () => {
    new OpenAPIClient(
      baseConfig({
        url: SPEC_URL,
        security: { type: 'http', http: { scheme: 'bearer', credentials: 'api-token' } },
        specSecurity: { type: 'none' },
      }),
    );

    expect(instances).toHaveLength(1);
  });

  test('specSecurity oauth2 without a pre-obtained token is rejected', () => {
    expect(
      () =>
        new OpenAPIClient(
          baseConfig({
            url: SPEC_URL,
            specSecurity: { type: 'oauth2', oauth2: { tokenUrl: 'http://127.0.0.1/token' } },
          }),
        ),
    ).toThrow(/pre-obtained token/);
  });

  test('specSecurity apiKey in cookie applies only to the spec download', async () => {
    const client = new OpenAPIClient(
      baseConfig({
        url: SPEC_URL,
        specSecurity: {
          type: 'apiKey',
          apiKey: { name: 'SESSION', in: 'cookie', value: 'abc123' },
        },
      }),
    );

    expect(instances).toHaveLength(2);
    instances[1].get.mockResolvedValue({ data: JSON.stringify(specDocument), headers: {} });
    instances[0].request.mockResolvedValue({ data: { ok: true }, headers: {} });

    await client.initialize();

    expect(instances[1].get.mock.calls[0][1]).toMatchObject({
      headers: { Cookie: 'SESSION=abc123' },
    });

    await client.callTool('ping', {});
    const callConfig = instances[0].request.mock.calls[0][0];
    expect(callConfig.headers?.Cookie ?? undefined).toBeUndefined();
  });
});

describe('OpenAPIClient HTTP Basic credential encoding', () => {
  const makeClient = (credentials: string) =>
    new OpenAPIClient(
      baseConfig({
        url: SPEC_URL,
        security: { type: 'http', http: { scheme: 'basic', credentials } },
      }),
    );

  test.each([
    // Raw user:pass is encoded automatically (#1079).
    ['admin:s3cret', 'Basic YWRtaW46czNjcmV0'],
    // Pre-encoded user:pass is preserved.
    ['YWRtaW46czNjcmV0', 'Basic YWRtaW46czNjcmV0'],
    // Valid-base64-shaped raw text that does not decode to printable user:pass
    // is treated as raw and encoded.
    ['test1234', `Basic ${Buffer.from('test1234', 'utf8').toString('base64')}`],
    // Short raw secrets that cannot be base64 are encoded.
    ['user', `Basic ${Buffer.from('user', 'utf8').toString('base64')}`],
  ])('credentials %j → Authorization %j', (credentials, expected) => {
    makeClient(credentials);
    expect(instances[0].defaults.headers.common['Authorization']).toBe(expected);
  });
});
