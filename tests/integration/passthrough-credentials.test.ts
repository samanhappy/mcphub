import { OpenAPIClient } from '../../src/clients/openapi.js';
import { getCachedSystemConfig } from '../../src/utils/systemConfigCache.js';

jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: jest.fn(() => ({ routing: { bearerAuthHeaderName: 'X-Hub-Key' } })),
}));

describe('OpenAPI caller credential isolation', () => {
  beforeEach(() => {
    jest.mocked(getCachedSystemConfig).mockReturnValue({
      routing: { bearerAuthHeaderName: 'X-Hub-Key' },
    });
  });

  it('forwards Authorization only after an explicit instance opt-in', async () => {
    jest.mocked(getCachedSystemConfig).mockReturnValue({
      routing: { bearerAuthHeaderName: 'X-Hub-Key', allowAuthorizationPassthrough: true },
    });
    const client = new OpenAPIClient({
      type: 'openapi',
      openapi: { schema: {}, passthroughHeaders: ['Authorization', 'X-Hub-Key', 'Cookie'] },
    }) as any;
    client.baseUrl = 'https://8.8.8.8';
    client.tools = [
      {
        name: 'test',
        method: 'get',
        path: '/test',
        parameters: [],
        inputSchema: { type: 'object' },
      },
    ];
    const request = jest.fn().mockResolvedValue({ data: {}, status: 200, headers: {} });
    client.httpClient = { request, defaults: { headers: { common: {} } } };
    await client.callTool(
      'test',
      {},
      {
        Authorization: 'Bearer upstream-user',
        'X-Hub-Key': 'Bearer hub-secret',
        Cookie: 'secret',
      },
    );
    expect(request.mock.calls[0][0].headers).toEqual({ Authorization: 'Bearer upstream-user' });
  });

  it('filters persisted sensitive passthrough headers before the HTTP request', async () => {
    const names = [
      'Authorization',
      'cookie',
      'proxy-authorization',
      'x-auth-token',
      'x-api-key',
      'X-Hub-Key',
      'X-Tenant',
    ];
    const client = new OpenAPIClient({
      type: 'openapi',
      openapi: { schema: {}, passthroughHeaders: names },
    }) as any;
    client.baseUrl = 'https://8.8.8.8';
    client.tools = [
      {
        name: 'test',
        method: 'get',
        path: '/test',
        parameters: [],
        inputSchema: { type: 'object' },
      },
    ];
    const request = jest.fn().mockResolvedValue({ data: { ok: true }, status: 200, headers: {} });
    client.httpClient = { request, defaults: { headers: { common: {} } } };
    await client.callTool('test', {}, Object.fromEntries(names.map((name) => [name, 'secret'])));
    expect(request).toHaveBeenCalled();
    expect(request.mock.calls[0][0].headers).toEqual({ 'X-Tenant': 'secret' });
    expect(getCachedSystemConfig).toHaveBeenCalled();
  });
});
