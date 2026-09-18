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
      options: {
        resetTimeoutOnProgress: false,
      },
      enableKeepAlive: false,
      description: '',
    });
    expect(payload.config).toHaveProperty('keepAliveInterval', undefined);
  });

  it('keeps keep-alive disabled by default for remote server payloads', () => {
    const payload = buildServerPayload({
      formData: {
        name: 'remote-server',
        description: '',
        url: 'https://example.com/mcp',
        command: '',
        arguments: '',
        args: [],
        env: [],
        headers: [],
        passthroughHeaders: '',
        options: {},
        oauth: {},
        openapi: {
          inputMode: 'url',
          url: '',
          schema: '',
          version: '3.1.0',
          securityType: 'none',
          passthroughHeaders: '',
        },
      },
      serverType: 'streamable-http',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config).toMatchObject({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: false,
    });
    expect(payload.config).toHaveProperty('keepAliveInterval', undefined);
  });

  it('persists explicit user sharing only for group visibility', () => {
    const payload = buildServerPayload({
      formData: {
        name: 'shared-server',
        description: '',
        url: 'https://example.com/mcp',
        command: '',
        arguments: '',
        args: [],
        env: [],
        headers: [],
        visibility: 'group',
        sharedWithUsers: [' alice ', 'bob', 'alice', ''],
        options: {},
        oauth: {},
        openapi: {
          inputMode: 'url',
          url: '',
          schema: '',
          version: '3.1.0',
          securityType: 'none',
          passthroughHeaders: '',
        },
      },
      serverType: 'streamable-http',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config).toMatchObject({
      visibility: 'group',
      sharedWithUsers: ['alice', 'bob'],
    });
  });

  it('clears remote-only fields when switching to stdio', () => {
    const payload = buildServerPayload({
      formData: {
        name: '  stdio-server  ',
        credentialTemplate: [{ target: 'env', name: 'PERSONAL_KEY' }],
        idleTimeoutMs: 12000,
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
    expect(payload.config.credentialTemplate).toEqual([{ target: 'env', name: 'PERSONAL_KEY' }]);
    expect(payload.config.idleTimeoutMs).toBe(12000);
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

  // ── #F1 OAuth sub-field round-trip ────────────────────────────────────────
  // The form has no in-form editor for dynamicRegistration/revocationEndpoint/
  // redirectUri, so they must be carried through the edit/duplicate → submit
  // round-trip instead of being silently dropped.
  const dynamicRegistration = {
    enabled: true,
    issuer: 'https://auth.example.com',
    registrationEndpoint: 'https://auth.example.com/register',
    metadata: {
      client_name: 'MCPHub',
      client_uri: 'https://mcphub.example.com',
      logo_uri: 'https://mcphub.example.com/logo.png',
      scope: 'openid profile',
      redirect_uris: ['https://mcphub.example.com/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
      contacts: ['admin@example.com'],
      software_id: 'mcphub',
      software_version: '1.0.0',
    },
    initialAccessToken: 'reg-token',
  };

  const buildSseForm = (oauth: Record<string, unknown>) =>
    ({
      name: 'oauth-server',
      description: '',
      url: 'https://example.com/mcp',
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
      oauth,
      openapi: {
        inputMode: 'url',
        url: '',
        schema: '',
        version: '3.1.0',
        securityType: 'none',
        passthroughHeaders: '',
      },
    }) as any;

  it('preserves a full dynamicRegistration sub-object verbatim (deep equal)', () => {
    const payload = buildServerPayload({
      formData: buildSseForm({
        clientId: 'static-client',
        clientSecret: 'secret',
        scopes: 'openid',
        accessToken: 'tok',
        refreshToken: 'refresh',
        authorizationEndpoint: 'https://example.com/auth',
        tokenEndpoint: 'https://example.com/token',
        resource: 'https://example.com/mcp',
        dynamicRegistration,
      }),
      serverType: 'sse',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.oauth?.dynamicRegistration).toEqual(dynamicRegistration);
    expect(payload.config.oauth?.dynamicRegistration).toBe(dynamicRegistration);
    // Static OAuth fields are still normalized/emitted as before.
    expect(payload.config.oauth).toMatchObject({
      clientId: 'static-client',
      clientSecret: 'secret',
      scopes: ['openid'],
      accessToken: 'tok',
      refreshToken: 'refresh',
      authorizationEndpoint: 'https://example.com/auth',
      tokenEndpoint: 'https://example.com/token',
      resource: 'https://example.com/mcp',
    });
  });

  it('does not emit a dynamicRegistration key when the source lacks it', () => {
    const payload = buildServerPayload({
      formData: buildSseForm({
        clientId: 'static-client',
        clientSecret: 'secret',
        scopes: 'openid',
        accessToken: 'tok',
        refreshToken: 'refresh',
        authorizationEndpoint: 'https://example.com/auth',
        tokenEndpoint: 'https://example.com/token',
        resource: 'https://example.com/mcp',
      }),
      serverType: 'sse',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.oauth).not.toHaveProperty('dynamicRegistration');
    expect(payload.config.oauth).toMatchObject({
      clientId: 'static-client',
      clientSecret: 'secret',
      scopes: ['openid'],
      accessToken: 'tok',
      refreshToken: 'refresh',
    });
  });

  it('keeps static OAuth field behavior unchanged when no carry fields are present', () => {
    // Regression protection: an oauth object with only static fields must not
    // gain a dynamicRegistration/revocationEndpoint key, and an entirely empty
    // oauth must still produce `oauth: {}`.
    const payload = buildServerPayload({
      formData: buildSseForm({
        clientId: 'c',
        clientSecret: 's',
        scopes: 'a b',
      }),
      serverType: 'sse',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.oauth).toEqual({
      clientId: 'c',
      clientSecret: 's',
      scopes: ['a', 'b'],
    });
    expect(payload.config.oauth).not.toHaveProperty('dynamicRegistration');
    expect(payload.config.oauth).not.toHaveProperty('revocationEndpoint');
  });

  it('preserves revocationEndpoint, redirectUri and dynamicRegistration together (deep equal)', () => {
    const payload = buildServerPayload({
      formData: buildSseForm({
        clientId: 'static-client',
        scopes: 'openid',
        revocationEndpoint: 'https://auth.example.com/revoke',
        redirectUri: 'https://mcphub.example.com/oauth/callback',
        dynamicRegistration,
      }),
      serverType: 'sse',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.oauth?.dynamicRegistration).toEqual(dynamicRegistration);
    expect(payload.config.oauth?.revocationEndpoint).toEqual('https://auth.example.com/revoke');
    expect(payload.config.oauth?.redirectUri).toEqual('https://mcphub.example.com/oauth/callback');
    // Static OAuth fields keep their existing normalization alongside the
    // carry-over fields.
    expect(payload.config.oauth).toMatchObject({
      clientId: 'static-client',
      scopes: ['openid'],
    });
  });

  it('does not emit revocationEndpoint, redirectUri or dynamicRegistration keys when absent', () => {
    const payload = buildServerPayload({
      formData: buildSseForm({
        clientId: 'static-client',
        scopes: 'openid',
      }),
      serverType: 'sse',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.oauth).toBeDefined();
    expect(payload.config.oauth).not.toHaveProperty('dynamicRegistration');
    expect(payload.config.oauth).not.toHaveProperty('revocationEndpoint');
    expect(payload.config.oauth).not.toHaveProperty('redirectUri');
    expect(Object.keys(payload.config.oauth ?? {})).toEqual(['clientId', 'scopes']);
  });
});
