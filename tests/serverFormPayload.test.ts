import { buildServerPayload } from '../frontend/src/utils/serverFormPayload.js';

describe('buildServerPayload', () => {
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
