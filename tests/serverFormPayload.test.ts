import { buildServerPayload } from '../frontend/src/utils/serverFormPayload.js';

describe('buildServerPayload', () => {
  test('emits openapi.specSecurity when the spec download needs its own credential (#1079)', () => {
    const payload = buildServerPayload({
      formData: {
        name: 'layered-openapi',
        description: '',
        url: '',
        command: '',
        arguments: '',
        args: [],
        type: 'openapi',
        env: [],
        headers: [],
        passthroughHeaders: '',
        visibility: 'private',
        options: {},
        oauth: {},
        keepAlive: {},
        openapi: {
          inputMode: 'url',
          url: 'http://internal/v3/api-docs',
          version: '3.1.0',
          securityType: 'http',
          httpScheme: 'bearer',
          httpCredentials: 'api-token',
          // Spec download protected by Basic while the API wants Bearer.
          specSecurityType: 'http',
          specHttpScheme: 'basic',
          specHttpCredentials: 'admin:s3cret',
          passthroughHeaders: '',
        },
      },
      serverType: 'openapi',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.openapi).toMatchObject({
      security: {
        type: 'http',
        http: { scheme: 'bearer', credentials: 'api-token' },
      },
      specSecurity: {
        type: 'http',
        http: { scheme: 'basic', credentials: 'admin:s3cret' },
      },
    });
  });

  test('omits specSecurity when the toggle is off', () => {
    const payload = buildServerPayload({
      formData: {
        name: 'plain-openapi',
        description: '',
        url: '',
        command: '',
        arguments: '',
        args: [],
        type: 'openapi',
        env: [],
        headers: [],
        passthroughHeaders: '',
        visibility: 'private',
        options: {},
        oauth: {},
        keepAlive: {},
        openapi: {
          inputMode: 'url',
          url: 'https://api.example.com/openapi.json',
          version: '3.1.0',
          securityType: 'none',
          specSecurityType: 'none',
          passthroughHeaders: '',
        },
      },
      serverType: 'openapi',
      envVars: [],
      headerVars: [],
    });

    expect(payload.config.openapi).not.toHaveProperty('specSecurity');
  });

  test('includes OpenAPI OAuth2 client credentials fields in the saved payload', () => {
    const payload = buildServerPayload({
      formData: {
        name: 'example-openapi',
        description: '',
        url: '',
        command: '',
        arguments: '',
        args: [],
        type: 'openapi',
        env: [],
        headers: [],
        passthroughHeaders: '',
        visibility: 'private',
        options: {},
        oauth: {},
        keepAlive: {},
        openapi: {
          inputMode: 'url',
          url: 'https://api.example.com/openapi.json',
          version: '3.1.0',
          securityType: 'oauth2',
          oauth2TokenUrl: ' https://auth.example.com/oauth/token ',
          oauth2ClientId: ' client-id ',
          oauth2ClientSecret: ' client-secret ',
          oauth2Token: ' existing-token ',
          passthroughHeaders: '',
        },
      },
      serverType: 'openapi',
      envVars: [],
      headerVars: [],
    });

    expect(payload).toEqual({
      name: 'example-openapi',
      config: {
        type: 'openapi',
        description: '',
        visibility: 'private',
        options: {},
        headers: {},
        openapi: {
          url: 'https://api.example.com/openapi.json',
          version: '3.1.0',
          passthroughHeaders: [],
          security: {
            type: 'oauth2',
            oauth2: {
              tokenUrl: 'https://auth.example.com/oauth/token',
              clientId: 'client-id',
              clientSecret: 'client-secret',
              token: 'existing-token',
            },
          },
        },
      },
    });
  });
});
