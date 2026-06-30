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
    expect(client.httpClient.request.mock.calls[0][0].data).toContain(
      'grant_type=client_credentials',
    );
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

  test('refreshes the OAuth2 token and retries once when an upstream call returns 401', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {},
        },
        security: {
          type: 'oauth2',
          oauth2: {
            tokenUrl: 'https://auth.example.com/oauth/token',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            token: 'stale-token',
            expiresAt: Date.now() + 3600_000,
          },
        },
      },
    };
    const persistedOAuth2States: Array<Record<string, unknown>> = [];
    const persistOAuth2Token = jest.fn((oauth2) => {
      persistedOAuth2States.push({ ...oauth2 });
    });
    const client = new OpenAPIClient(config, { persistOAuth2Token }) as OpenAPIClient & {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        operationId: string;
        method: string;
        path: string;
      }>;
      httpClient: {
        request: jest.Mock;
        defaults: {
          headers: {
            common: Record<string, string>;
          };
        };
      };
    };
    const observedAuthorizationHeaders: Array<string | undefined> = [];

    client.tools = [
      {
        name: 'getUsers',
        description: 'Get users',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'getUsers',
        method: 'get',
        path: '/users',
      },
    ];
    client.httpClient = {
      request: jest.fn((requestConfig: { url: string }) => {
        observedAuthorizationHeaders.push(client.httpClient.defaults.headers.common.Authorization);

        if (requestConfig.url === '/users' && observedAuthorizationHeaders.length === 1) {
          return Promise.reject({
            isAxiosError: true,
            response: {
              status: 401,
              statusText: 'Unauthorized',
              data: {
                error: 'invalid_token',
              },
            },
          });
        }

        if (requestConfig.url === 'https://auth.example.com/oauth/token') {
          return Promise.resolve({
            data: {
              access_token: 'fresh-token',
              expires_in: 3600,
            },
          });
        }

        return Promise.resolve({
          data: {
            users: [],
          },
        });
      }),
      defaults: {
        headers: {
          common: {},
        },
      },
    };

    await expect(client.callTool('getUsers', {})).resolves.toEqual({ users: [] });

    expect(client.httpClient.request).toHaveBeenCalledTimes(3);
    expect(client.httpClient.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: 'get', url: '/users' }),
    );
    expect(client.httpClient.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'post',
        url: 'https://auth.example.com/oauth/token',
      }),
    );
    expect(client.httpClient.request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ method: 'get', url: '/users' }),
    );
    expect(observedAuthorizationHeaders).toEqual([
      'Bearer stale-token',
      undefined,
      'Bearer fresh-token',
    ]);
    expect(config.openapi?.security?.oauth2?.token).toBe('fresh-token');
    expect(persistOAuth2Token).toHaveBeenCalledTimes(2);
    expect(persistedOAuth2States[0]).toEqual(
      expect.objectContaining({
        tokenUrl: 'https://auth.example.com/oauth/token',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      }),
    );
    expect(persistedOAuth2States[0]).not.toHaveProperty('token');
    expect(persistedOAuth2States[0]).not.toHaveProperty('expiresAt');
    expect(persistedOAuth2States[1]).toEqual(
      expect.objectContaining({
        token: 'fresh-token',
        expiresAt: expect.any(Number),
      }),
    );
  });

  test('does not invalidate a token refreshed by another in-flight 401 retry', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {},
        },
        security: {
          type: 'oauth2',
          oauth2: {
            tokenUrl: 'https://auth.example.com/oauth/token',
            clientId: 'test-client',
            token: 'stale-token',
            expiresAt: Date.now() + 3600_000,
          },
        },
      },
    };
    const persistedOAuth2States: Array<Record<string, unknown>> = [];
    const client = new OpenAPIClient(config, {
      persistOAuth2Token: (oauth2) => {
        persistedOAuth2States.push({ ...oauth2 });
      },
    }) as OpenAPIClient & {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        operationId: string;
        method: string;
        path: string;
      }>;
      httpClient: {
        request: jest.Mock;
        defaults: {
          headers: {
            common: Record<string, string>;
          };
        };
      };
    };
    const rejectInitialUserRequests: Array<(error: unknown) => void> = [];
    const observedAuthorizationHeaders: Array<string | undefined> = [];
    let userRequestCount = 0;
    let tokenRequestCount = 0;

    client.tools = [
      {
        name: 'getUsers',
        description: 'Get users',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'getUsers',
        method: 'get',
        path: '/users',
      },
    ];
    client.httpClient = {
      request: jest.fn((requestConfig: { url: string }) => {
        observedAuthorizationHeaders.push(client.httpClient.defaults.headers.common.Authorization);

        if (requestConfig.url === 'https://auth.example.com/oauth/token') {
          tokenRequestCount += 1;
          return Promise.resolve({
            data: {
              access_token: 'fresh-token',
              expires_in: 3600,
            },
          });
        }

        if (requestConfig.url === '/users') {
          userRequestCount += 1;

          if (userRequestCount <= 2) {
            return new Promise((_, reject) => {
              rejectInitialUserRequests.push(reject);
            });
          }

          return Promise.resolve({
            data: {
              users: [],
            },
          });
        }

        return Promise.reject(new Error(`Unexpected request URL: ${requestConfig.url}`));
      }),
      defaults: {
        headers: {
          common: {},
        },
      },
    };

    const firstCall = client.callTool('getUsers', {});
    const secondCall = client.callTool('getUsers', {});

    await Promise.resolve();
    await Promise.resolve();
    expect(rejectInitialUserRequests).toHaveLength(2);
    rejectInitialUserRequests[0]({
      isAxiosError: true,
      response: {
        status: 401,
        statusText: 'Unauthorized',
        data: {
          error: 'invalid_token',
        },
      },
    });
    await expect(firstCall).resolves.toEqual({ users: [] });

    expect(client.httpClient.defaults.headers.common.Authorization).toBe('Bearer fresh-token');
    rejectInitialUserRequests[1]({
      isAxiosError: true,
      response: {
        status: 401,
        statusText: 'Unauthorized',
        data: {
          error: 'invalid_token',
        },
      },
    });
    await expect(secondCall).resolves.toEqual({ users: [] });

    expect(tokenRequestCount).toBe(1);
    expect(userRequestCount).toBe(4);
    expect(observedAuthorizationHeaders).toEqual([
      'Bearer stale-token',
      'Bearer stale-token',
      undefined,
      'Bearer fresh-token',
      'Bearer fresh-token',
    ]);
    expect(persistedOAuth2States).toHaveLength(2);
    expect(persistedOAuth2States[0]).not.toHaveProperty('token');
    expect(persistedOAuth2States[1]).toEqual(
      expect.objectContaining({
        token: 'fresh-token',
        expiresAt: expect.any(Number),
      }),
    );
  });

  test('does not retry indefinitely when a refreshed OAuth2 token is still rejected', async () => {
    const config: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: {
          openapi: '3.0.0',
          info: { title: 'Test API', version: '1.0.0' },
          paths: {},
        },
        security: {
          type: 'oauth2',
          oauth2: {
            tokenUrl: 'https://auth.example.com/oauth/token',
            clientId: 'test-client',
            token: 'stale-token',
            expiresAt: Date.now() + 3600_000,
          },
        },
      },
    };
    const client = new OpenAPIClient(config) as OpenAPIClient & {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        operationId: string;
        method: string;
        path: string;
      }>;
      httpClient: {
        request: jest.Mock;
        defaults: {
          headers: {
            common: Record<string, string>;
          };
        };
      };
    };

    client.tools = [
      {
        name: 'getUsers',
        description: 'Get users',
        inputSchema: { type: 'object', properties: {}, required: [] },
        operationId: 'getUsers',
        method: 'get',
        path: '/users',
      },
    ];
    client.httpClient = {
      request: jest
        .fn()
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: {
            status: 401,
            statusText: 'Unauthorized',
            data: {
              error: 'invalid_token',
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            access_token: 'fresh-token',
            expires_in: 3600,
          },
        })
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: {
            status: 401,
            statusText: 'Unauthorized',
            data: {
              error: 'invalid_token',
            },
          },
        }),
      defaults: {
        headers: {
          common: {},
        },
      },
    };

    await expect(client.callTool('getUsers', {})).rejects.toThrow(
      'API call failed: 401 Unauthorized {"error":"invalid_token"}',
    );
    expect(client.httpClient.request).toHaveBeenCalledTimes(3);
  });
});
