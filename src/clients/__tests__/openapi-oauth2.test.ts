import { OpenAPIClient } from '../openapi.js';
import type { ServerConfig } from '../../types/index.js';

describe('OpenAPIClient - OAuth2 client credentials', () => {
  test('fetches and persists an OAuth2 client credentials token during initialization', async () => {
    const persistOAuth2Token = jest.fn();
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {
            '/users': {
              get: {
                operationId: 'getUsers',
                responses: {
                  '200': {
                    description: 'OK',
                  },
                },
              },
            },
          },
        },
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

    const client = new OpenAPIClient(config, { persistOAuth2Token }) as OpenAPIClient & {
      httpClient: {
        request: jest.Mock;
        defaults: {
          headers: {
            common: Record<string, string>;
          };
        };
      };
    };

    client.httpClient = {
      request: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            access_token: 'fresh-token',
            expires_in: 3600,
          },
        })
        .mockResolvedValueOnce({
          data: {
            users: [],
          },
        }),
      defaults: {
        headers: {
          common: {},
        },
      },
    };

    await client.initialize();

    expect(client.httpClient.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'post',
        url: 'https://auth.example.com/oauth/token',
        baseURL: undefined,
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    );
    expect(client.httpClient.request.mock.calls[0][0].data).toContain('grant_type=client_credentials');
    expect(client.httpClient.request.mock.calls[0][0].data).toContain('client_id=test-client');
    expect(client.httpClient.request.mock.calls[0][0].data).toContain('client_secret=test-secret');
    expect(client.httpClient.defaults.headers.common.Authorization).toBe('Bearer ' + 'fresh-token');
    expect(config.openapi?.security?.oauth2?.token).toBe('fresh-token');
    expect(config.openapi?.security?.oauth2?.expiresAt).toEqual(expect.any(Number));
    expect(persistOAuth2Token).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'fresh-token',
        expiresAt: expect.any(Number),
      }),
    );

    await expect(client.callTool('getUsers', {})).resolves.toEqual({ users: [] });
    expect(client.httpClient.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'get',
        url: '/users',
      }),
    );
  });
});
