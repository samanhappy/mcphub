jest.mock('../../src/services/oauthServerService.js', () => ({
  getOAuthServer: jest.fn(),
  handleTokenRequest: jest.fn(),
  handleAuthenticateRequest: jest.fn(),
}));

jest.mock('../../src/models/OAuth.js', () => ({
  findOAuthClientById: jest.fn(),
}));

jest.mock('../../src/services/cimdClientService.js', () => ({
  findOAuthClientIncludingCimd: jest.fn(),
  isCimdClientId: jest.fn((clientId: string) => clientId.startsWith('https://')),
}));

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(),
}));

import { postAuthorize } from '../../src/controllers/oauthServerController.js';
import { getOAuthServer } from '../../src/services/oauthServerService.js';
import { findOAuthClientIncludingCimd } from '../../src/services/cimdClientService.js';
import { getSystemConfigDao } from '../../src/dao/index.js';

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
  redirect: jest.Mock;
};

const createResponse = (): MockResponse => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };

  return res;
};

const createRequest = (overrides: Record<string, unknown> = {}) => ({
  body: {},
  query: {},
  headers: {},
  method: 'POST',
  url: '/oauth/authorize',
  protocol: 'https',
  get: jest.fn().mockReturnValue('hub.example.com'),
  header: jest.fn().mockReturnValue(undefined),
  ...overrides,
});

describe('oauthServerController postAuthorize redirect_uri validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (findOAuthClientIncludingCimd as jest.Mock).mockImplementation(
      (clientId: string) =>
        clientId === 'trusted-client'
          ? Promise.resolve({
              clientId: 'trusted-client',
              name: 'Trusted Client',
              redirectUris: ['https://trusted.example.com/callback'],
            })
          : Promise.resolve(undefined),
    );

    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: async () => ({ install: { baseUrl: 'https://hub.example.com' } }),
    });
  });

  it('rejects denied authorizations when redirect_uri is not registered for the client', async () => {
    (getOAuthServer as jest.Mock).mockReturnValue({
      authorize: jest.fn(),
    });

    const req = createRequest({
      body: {
        allow: 'false',
        client_id: 'trusted-client',
        redirect_uri: 'https://evil.example.com/callback',
        state: 'state-123',
      },
    });
    const res = createResponse();

    await postAuthorize(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: 'Invalid redirect_uri',
    });
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('preserves denial redirects for registered redirect URIs and adds RFC 9207 iss', async () => {
    (getOAuthServer as jest.Mock).mockReturnValue({
      authorize: jest.fn(),
    });

    const req = createRequest({
      body: {
        allow: 'false',
        client_id: 'trusted-client',
        redirect_uri: 'https://trusted.example.com/callback',
        state: 'state-123',
      },
    });
    const res = createResponse();

    await postAuthorize(req as any, res as any);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://trusted.example.com/callback?error=access_denied&iss=https%3A%2F%2Fhub.example.com&state=state-123',
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it('adds RFC 9207 iss to successful authorization redirects', async () => {
    (getOAuthServer as jest.Mock).mockReturnValue({
      authorize: jest.fn().mockResolvedValue({ authorizationCode: 'code-abc' }),
    });

    const req = createRequest({
      user: { username: 'alice' },
      body: {
        allow: 'true',
        client_id: 'trusted-client',
        redirect_uri: 'https://trusted.example.com/callback',
        state: 'state-123',
      },
    });
    const res = createResponse();

    await postAuthorize(req as any, res as any);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://trusted.example.com/callback?code=code-abc&iss=https%3A%2F%2Fhub.example.com&state=state-123',
    );
  });

  it('adds RFC 9207 iss to OAuth error redirects', async () => {
    (getOAuthServer as jest.Mock).mockReturnValue({
      authorize: jest.fn().mockRejectedValue(
        Object.assign(new Error('Scope is invalid'), {
          code: 400,
          name: 'invalid_scope',
        }),
      ),
    });

    const req = createRequest({
      user: {
        username: 'alice',
      },
      body: {
        allow: 'true',
        client_id: 'trusted-client',
        redirect_uri: 'https://trusted.example.com/callback',
        state: 'state-123',
      },
    });
    const res = createResponse();

    await postAuthorize(req as any, res as any);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://trusted.example.com/callback?error=invalid_scope&error_description=Scope+is+invalid&iss=https%3A%2F%2Fhub.example.com&state=state-123',
    );
  });

  it('omits iss when no issuer can be resolved', async () => {
    (getOAuthServer as jest.Mock).mockReturnValue({
      authorize: jest.fn(),
    });
    (getSystemConfigDao as jest.Mock).mockReturnValue({
      get: async () => ({}),
    });

    const req = createRequest({ get: jest.fn().mockReturnValue(undefined) });
    req.body = {
      allow: 'false',
      client_id: 'trusted-client',
      redirect_uri: 'https://trusted.example.com/callback',
      state: 'state-123',
    };
    const res = createResponse();

    await postAuthorize(req as any, res as any);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://trusted.example.com/callback?error=access_denied&state=state-123',
    );
  });

  it('rejects OAuth error redirects when redirect_uri is not registered for the client', async () => {
    (getOAuthServer as jest.Mock).mockReturnValue({
      authorize: jest.fn().mockRejectedValue(
        Object.assign(new Error('Scope is invalid'), {
          code: 400,
          name: 'invalid_scope',
        }),
      ),
    });

    const req = createRequest({
      user: {
        username: 'alice',
      },
      body: {
        allow: 'true',
        client_id: 'trusted-client',
        redirect_uri: 'https://evil.example.com/callback',
        state: 'state-123',
      },
    });
    const res = createResponse();

    await postAuthorize(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: 'Invalid redirect_uri',
    });
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
