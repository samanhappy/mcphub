import { OpenAPIClient } from '../openapi.js';
import type { ServerConfig } from '../../types/index.js';

type TestTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  operationId: string;
  method: string;
  path: string;
  parameters?: any[];
};

type TestClient = OpenAPIClient & {
  baseUrl: string;
  tools: TestTool[];
  httpClient: {
    request: jest.Mock;
    defaults: { headers: { common: Record<string, string> } };
  };
};

const BASE_URL = 'https://8.8.8.8';

const loginTool: TestTool = {
  name: 'login',
  description: 'login',
  inputSchema: { type: 'object', properties: {}, required: [] },
  operationId: 'login',
  method: 'post',
  path: '/login',
};

const protectedTool: TestTool = {
  name: 'getProtected',
  description: 'protected',
  inputSchema: { type: 'object', properties: {}, required: [] },
  operationId: 'getProtected',
  method: 'get',
  path: '/protected',
};

const otherTool: TestTool = {
  name: 'getOther',
  description: 'other',
  inputSchema: { type: 'object', properties: {}, required: [] },
  operationId: 'getOther',
  method: 'get',
  path: '/other',
};

const subTool: TestTool = {
  name: 'getSub',
  description: 'sub',
  inputSchema: { type: 'object', properties: {}, required: [] },
  operationId: 'getSub',
  method: 'get',
  path: '/sub/data',
};

function makeClient(openapi: ServerConfig['openapi'], tools: TestTool[]): TestClient {
  const config: ServerConfig = {
    type: 'openapi',
    openapi: {
      schema: {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
      },
      ...openapi,
    },
  };
  const client = new OpenAPIClient(config) as TestClient;
  client.baseUrl = BASE_URL;
  client.tools = tools;
  client.httpClient = {
    request: jest.fn(async () => ({ data: {}, headers: {} })),
    defaults: { headers: { common: {} } },
  };
  return client;
}

// Find the last request mock call whose config matched the given url path.
const lastCallTo = (mock: jest.Mock, url: string) => {
  const calls = mock.mock.calls.filter((c) => c[0]?.url === url);
  return calls[calls.length - 1];
};

describe('OpenAPIClient - cookie session handling', () => {
  it('captures Set-Cookie from a login call and replays it on a later call', async () => {
    const client = makeClient({ cookieSession: true }, [loginTool, protectedTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: { 'set-cookie': ['accesstoken=abc; Path=/; HttpOnly'] },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await client.callTool('login', {}, undefined, false, 'sess-1');
    await client.callTool('getProtected', {}, undefined, false, 'sess-1');

    const protectedCall = lastCallTo(client.httpClient.request, '/protected');
    expect(protectedCall[0].headers?.Cookie).toBe('accesstoken=abc');
  });

  it('does not leak a session cookie into a different session', async () => {
    const client = makeClient({ cookieSession: true }, [loginTool, protectedTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: { 'set-cookie': ['accesstoken=abc; Path=/; HttpOnly'] },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await client.callTool('login', {}, undefined, false, 'sess-1');
    await client.callTool('getProtected', {}, undefined, false, 'sess-2');

    const sess2Call = lastCallTo(client.httpClient.request, '/protected');
    expect(sess2Call[0].headers?.Cookie).toBeUndefined();
  });

  it('fail-safes (no capture, no inject) when no sessionId is present', async () => {
    const client = makeClient({ cookieSession: true }, [loginTool, protectedTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: { 'set-cookie': ['accesstoken=abc; Path=/; HttpOnly'] },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await client.callTool('login', {}, undefined, false, undefined);
    await client.callTool('getProtected', {}, undefined, false, undefined);

    const loginCall = lastCallTo(client.httpClient.request, '/login');
    const protectedCall = lastCallTo(client.httpClient.request, '/protected');
    expect(loginCall[0].headers?.Cookie).toBeUndefined();
    expect(protectedCall[0].headers?.Cookie).toBeUndefined();
  });

  it('captures multiple Set-Cookie headers from one response', async () => {
    const client = makeClient({ cookieSession: true }, [loginTool, protectedTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: {
            'set-cookie': ['accesstoken=abc; Path=/', 'csrf=xyz; Path=/'],
          },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await client.callTool('login', {}, undefined, false, 'sess-1');
    await client.callTool('getProtected', {}, undefined, false, 'sess-1');

    const protectedCall = lastCallTo(client.httpClient.request, '/protected');
    const cookie = protectedCall[0].headers?.Cookie;
    expect(cookie).toContain('accesstoken=abc');
    expect(cookie).toContain('csrf=xyz');
  });

  it('scopes captured cookies by Path (does not send to non-matching paths)', async () => {
    const client = makeClient({ cookieSession: true }, [loginTool, otherTool, subTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: { 'set-cookie': ['accesstoken=abc; Path=/sub'] },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await client.callTool('login', {}, undefined, false, 'sess-1');
    await client.callTool('getOther', {}, undefined, false, 'sess-1');
    await client.callTool('getSub', {}, undefined, false, 'sess-1');

    const otherCall = lastCallTo(client.httpClient.request, '/other');
    const subCall = lastCallTo(client.httpClient.request, '/sub/data');
    expect(otherCall[0].headers?.Cookie).toBeUndefined();
    expect(subCall[0].headers?.Cookie).toBe('accesstoken=abc');
  });

  it('clearSessionCookies drops the jar so cookies are no longer sent', async () => {
    const client = makeClient({ cookieSession: true }, [loginTool, protectedTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: { 'set-cookie': ['accesstoken=abc; Path=/; HttpOnly'] },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await client.callTool('login', {}, undefined, false, 'sess-1');
    client.clearSessionCookies('sess-1');
    await client.callTool('getProtected', {}, undefined, false, 'sess-1');

    const protectedCall = lastCallTo(client.httpClient.request, '/protected');
    expect(protectedCall[0].headers?.Cookie).toBeUndefined();
  });

  it('captures Set-Cookie from a non-2xx error response', async () => {
    const client = makeClient({ cookieSession: true }, [loginTool, protectedTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        // Simulate a non-2xx response (e.g. a redirect treated as an error)
        // carrying Set-Cookie. Axios surfaces this as a rejected promise.
        throw {
          isAxiosError: true,
          response: {
            status: 400,
            statusText: 'Bad Request',
            data: {},
            headers: { 'set-cookie': ['accesstoken=abc; Path=/; HttpOnly'] },
          },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await expect(client.callTool('login', {}, undefined, false, 'sess-1')).rejects.toThrow(
      'API call failed: 400',
    );
    await client.callTool('getProtected', {}, undefined, false, 'sess-1');

    const protectedCall = lastCallTo(client.httpClient.request, '/protected');
    expect(protectedCall[0].headers?.Cookie).toBe('accesstoken=abc');
  });

  it('preserves a caller-configured Cookie header, merging with jar cookies', async () => {
    const cookieHeaderTool: TestTool = {
      name: 'getProtected',
      description: 'protected',
      inputSchema: {
        type: 'object',
        properties: { Cookie: { type: 'string' } },
        required: [],
      },
      operationId: 'getProtected',
      method: 'get',
      path: '/protected',
      parameters: [{ name: 'Cookie', in: 'header', required: false, schema: { type: 'string' } }],
    };
    const client = makeClient({ cookieSession: true }, [loginTool, cookieHeaderTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: { 'set-cookie': ['accesstoken=abc; Path=/; HttpOnly'] },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await client.callTool('login', {}, undefined, false, 'sess-1');
    // Caller supplies a Cookie header param alongside the session jar cookie.
    await client.callTool('getProtected', { Cookie: 'pref=dark' }, undefined, false, 'sess-1');

    const protectedCall = lastCallTo(client.httpClient.request, '/protected');
    const cookie = protectedCall[0].headers?.Cookie;
    // Both cookies present; jar value wins for a duplicate name.
    expect(cookie).toContain('pref=dark');
    expect(cookie).toContain('accesstoken=abc');
  });
});

describe('OpenAPIClient - static apiKey.in:cookie', () => {
  const staticConfig: ServerConfig['openapi'] = {
    schema: { openapi: '3.0.0', info: { title: 'Test API', version: '1.0.0' }, paths: {} },
    security: {
      type: 'apiKey',
      apiKey: { name: 'accesstoken', in: 'cookie', value: 'static-val' },
    },
  };

  it('sends the static cookie on every request without cookieSession enabled', async () => {
    const client = makeClient(staticConfig, [protectedTool]);
    await client.callTool('getProtected', {}, undefined, false, undefined);

    const call = lastCallTo(client.httpClient.request, '/protected');
    expect(call[0].headers?.Cookie).toBe('accesstoken=static-val');
  });

  it('does not capture Set-Cookie when cookieSession is not enabled', async () => {
    const client = makeClient(staticConfig, [loginTool, protectedTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: { 'set-cookie': ['accesstoken=dynamic; Path=/; HttpOnly'] },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    await client.callTool('login', {}, undefined, false, undefined);
    await client.callTool('getProtected', {}, undefined, false, undefined);

    // Static cookie is still sent; the dynamic Set-Cookie was not captured.
    const protectedCall = lastCallTo(client.httpClient.request, '/protected');
    expect(protectedCall[0].headers?.Cookie).toBe('accesstoken=static-val');
  });

  it('lets a dynamic Set-Cookie override the static cookie within a session', async () => {
    const client = makeClient({ ...staticConfig, cookieSession: true }, [loginTool, protectedTool]);
    client.httpClient.request.mockImplementation(async (cfg: any) => {
      if (cfg.url === '/login') {
        return {
          data: { ok: true },
          headers: { 'set-cookie': ['accesstoken=dynamic; Path=/; HttpOnly'] },
        };
      }
      return { data: { ok: true }, headers: {} };
    });

    // Before login, the static cookie is sent (jar not yet created).
    await client.callTool('getProtected', {}, undefined, false, 'sess-1');
    const preLogin = lastCallTo(client.httpClient.request, '/protected');
    expect(preLogin[0].headers?.Cookie).toBe('accesstoken=static-val');

    await client.callTool('login', {}, undefined, false, 'sess-1');
    await client.callTool('getProtected', {}, undefined, false, 'sess-1');
    const postLogin = lastCallTo(client.httpClient.request, '/protected');
    expect(postLogin[0].headers?.Cookie).toBe('accesstoken=dynamic');
  });
});
