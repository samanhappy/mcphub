import { buildServerPayload } from '../../frontend/src/utils/serverFormPayload';

describe('buildServerPayload', () => {
  it('keeps empty headers and env payloads explicit for SSE servers', () => {
    const payload = buildServerPayload({
      formData: {
        name: 'remote-server',
        description: '',
        url: 'https://example.com/sse',
        command: '',
        arguments: '',
        args: [],
        env: [],
        headers: [],
        passthroughHeaders: '',
        options: {
          timeout: 60000,
          resetTimeoutOnProgress: false,
          maxTotalTimeout: undefined,
        },
        keepAlive: {
          enabled: false,
          interval: 60000,
        },
        oauth: {
          clientId: '',
          clientSecret: '',
          scopes: '',
          accessToken: '',
          refreshToken: '',
          authorizationEndpoint: '',
          tokenEndpoint: '',
          resource: '',
        },
        openapi: {
          inputMode: 'url',
          url: '',
          schema: '',
          version: '3.1.0',
          securityType: 'none',
          passthroughHeaders: '',
        },
      },
      serverType: 'sse',
      envVars: [],
      headerVars: [],
    });

    expect(payload.name).toBe('remote-server');
    expect(payload.config).toMatchObject({
      type: 'sse',
      url: 'https://example.com/sse',
      env: {},
      headers: {},
      passthroughHeaders: [],
      oauth: {},
      options: {},
      enableKeepAlive: false,
      description: '',
    });
    expect(payload.config).toHaveProperty('keepAliveInterval', undefined);
  });

  it('clears remote-only fields when switching to stdio', () => {
    const payload = buildServerPayload({
      formData: {
        name: '  stdio-server  ',
        description: 'local command server',
        url: 'https://example.com/previous-sse',
        command: 'npx',
        arguments: '-y demo-server',
        args: ['-y', 'demo-server'],
        env: [],
        headers: [],
        passthroughHeaders: 'Authorization',
        options: {
          timeout: 60000,
          resetTimeoutOnProgress: false,
          maxTotalTimeout: undefined,
        },
        keepAlive: {
          enabled: true,
          interval: 15000,
        },
        oauth: {
          clientId: 'client-id',
          clientSecret: 'secret',
          scopes: 'openid profile',
          accessToken: 'token',
          refreshToken: 'refresh',
          authorizationEndpoint: 'https://example.com/auth',
          tokenEndpoint: 'https://example.com/token',
          resource: 'https://example.com/mcp',
        },
        openapi: {
          inputMode: 'url',
          url: 'https://example.com/openapi.json',
          schema: '',
          version: '3.1.0',
          securityType: 'none',
          passthroughHeaders: 'Authorization',
        },
      },
      serverType: 'stdio',
      envVars: [],
      headerVars: [],
    });

    expect(payload.name).toBe('stdio-server');
    expect(payload.config).toMatchObject({
      type: 'stdio',
      description: 'local command server',
      command: 'npx',
      args: ['-y', 'demo-server'],
      env: {},
      options: {},
    });
    expect(payload.config).not.toHaveProperty('url');
    expect(payload.config).not.toHaveProperty('openapi');
    expect(payload.config).not.toHaveProperty('headers');
    expect(payload.config).not.toHaveProperty('passthroughHeaders');
    expect(payload.config).not.toHaveProperty('oauth');
  });
});