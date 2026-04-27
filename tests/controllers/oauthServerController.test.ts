jest.mock('../../src/services/oauthServerService.js', () => ({
  getOAuthServer: jest.fn(),
  handleTokenRequest: jest.fn(),
  handleAuthenticateRequest: jest.fn(),
}));

jest.mock('../../src/models/OAuth.js', () => ({
  findOAuthClientById: jest.fn(),
}));

import { postAuthorize } from '../../src/controllers/oauthServerController.js';
import { getOAuthServer } from '../../src/services/oauthServerService.js';
import { findOAuthClientById } from '../../src/models/OAuth.js';

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
  header: jest.fn().mockReturnValue(undefined),
  ...overrides,
});

describe('oauthServerController postAuthorize redirect_uri validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (findOAuthClientById as jest.Mock).mockResolvedValue({
      clientId: 'trusted-client',
      name: 'Trusted Client',
      redirectUris: ['https://trusted.example.com/callback'],
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

  it('preserves denial redirects for registered redirect URIs', async () => {
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
      'https://trusted.example.com/callback?error=access_denied&state=state-123',
    );
    expect(res.status).not.toHaveBeenCalled();
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
