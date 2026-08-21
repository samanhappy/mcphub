jest.mock('../../src/services/oauthServerService.js', () => ({
  getOAuthServer: jest.fn(),
  handleTokenRequest: jest.fn(),
  handleAuthenticateRequest: jest.fn(),
}));

jest.mock('../../src/models/OAuth.js', () => ({
  findOAuthClientById: jest.fn(),
}));

jest.mock('../../src/services/betterAuthSession.js', () => ({
  resolveBetterAuthUser: jest.fn(),
}));

jest.mock('../../src/utils/frontendShell.js', () => ({
  injectOAuthConsentShell: jest.fn(),
}));

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(),
  getServerDao: jest.fn(),
}));

import { getAuthorize } from '../../src/controllers/oauthServerController.js';
import { getOAuthServer } from '../../src/services/oauthServerService.js';
import { findOAuthClientById } from '../../src/models/OAuth.js';
import { resolveBetterAuthUser } from '../../src/services/betterAuthSession.js';
import { injectOAuthConsentShell } from '../../src/utils/frontendShell.js';
import { getGroupDao, getServerDao } from '../../src/dao/index.js';

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
  redirect: jest.Mock;
  type: jest.Mock;
  send: jest.Mock;
};

const createResponse = (): MockResponse => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };

  return res;
};

const createRequest = (overrides: Record<string, unknown> = {}) => ({
  query: {
    client_id: 'trusted-client',
    redirect_uri: 'https://trusted.example.com/callback',
    response_type: 'code',
    scope: 'read write',
  },
  body: {},
  header: jest.fn().mockReturnValue(undefined),
  originalUrl: '/oauth/authorize?client_id=trusted-client',
  t: (key: string) => key,
  ...overrides,
});

describe('oauthServerController getAuthorize consent shell', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (getOAuthServer as jest.Mock).mockReturnValue({});

    (findOAuthClientById as jest.Mock).mockResolvedValue({
      clientId: 'trusted-client',
      name: 'Trusted Client',
      redirectUris: ['https://trusted.example.com/callback'],
    });

    (resolveBetterAuthUser as jest.Mock).mockResolvedValue({
      username: 'alice',
      isAdmin: false,
    });

    // Default: no group/server matches the target name.
    (getGroupDao as jest.Mock).mockReturnValue({
      findByName: jest.fn().mockResolvedValue(null),
    });
    (getServerDao as jest.Mock).mockReturnValue({
      findById: jest.fn().mockResolvedValue(null),
    });
  });

  it('serves the SPA consent shell with the injected consent context when the frontend build is available', async () => {
    (injectOAuthConsentShell as jest.Mock).mockReturnValue(
      '<html><body data-test="shell">SPA consent shell</body></html>',
    );

    const req = createRequest();
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    expect(injectOAuthConsentShell).toHaveBeenCalledTimes(1);

    const context = (injectOAuthConsentShell as jest.Mock).mock.calls[0][0];
    expect(context).toMatchObject({
      clientName: 'Trusted Client',
      clientId: 'trusted-client',
      redirectUri: 'https://trusted.example.com/callback',
      responseType: 'code',
      scope: 'read write',
    });
    expect(context.scopes).toEqual([
      { name: 'read', description: 'Read access to your MCP servers and tools' },
      { name: 'write', description: 'Execute tools and modify MCP server configurations' },
    ]);

    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send).toHaveBeenCalledWith(
      '<html><body data-test="shell">SPA consent shell</body></html>',
    );
  });

  it('includes state, PKCE and token fields in the injected consent context when present', async () => {
    (injectOAuthConsentShell as jest.Mock).mockReturnValue('<html>shell</html>');

    const req = createRequest({
      query: {
        client_id: 'trusted-client',
        redirect_uri: 'https://trusted.example.com/callback',
        response_type: 'code',
        scope: 'read',
        state: 'state-123',
        code_challenge: 'abc123',
        code_challenge_method: 'S256',
        token: 'jwt-token',
      },
    });
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    const context = (injectOAuthConsentShell as jest.Mock).mock.calls[0][0];
    expect(context).toMatchObject({
      state: 'state-123',
      codeChallenge: 'abc123',
      codeChallengeMethod: 'S256',
      token: 'jwt-token',
    });
  });

  it('falls back to the legacy inline consent HTML when the frontend shell is unavailable', async () => {
    (injectOAuthConsentShell as jest.Mock).mockReturnValue(null);

    const req = createRequest();
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    expect(injectOAuthConsentShell).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith(expect.any(String));

    const html = (res.send as jest.Mock).mock.calls[0][0] as string;
    // Legacy page is still a fully functional consent form POSTing to /oauth/authorize.
    expect(html).toContain('<form method="POST" action="/oauth/authorize"');
    expect(html).toContain('Trusted Client');
  });

  it('redirects unauthenticated users to the login page before rendering consent', async () => {
    (resolveBetterAuthUser as jest.Mock).mockResolvedValue(null);

    const req = createRequest();
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/login?returnUrl='),
    );
    expect(injectOAuthConsentShell).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('passes the RFC 8707 resource target into the consent context', async () => {
    (injectOAuthConsentShell as jest.Mock).mockReturnValue('<html>shell</html>');

    const req = createRequest({
      query: {
        client_id: 'trusted-client',
        redirect_uri: 'https://trusted.example.com/callback',
        response_type: 'code',
        scope: 'read',
        resource: 'https://mcphub.example.com/mcp',
      },
    });
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    const context = (injectOAuthConsentShell as jest.Mock).mock.calls[0][0];
    expect(context.resource).toEqual({
      raw: 'https://mcphub.example.com/mcp',
      path: '/mcp',
      kind: 'all',
    });
  });

  it('resolves /mcp/{name} to a server via the DAOs', async () => {
    (getServerDao as jest.Mock).mockReturnValue({
      findById: jest.fn().mockResolvedValue({ name: 'toggl' }),
    });

    const req = createRequest({
      query: {
        client_id: 'trusted-client',
        redirect_uri: 'https://trusted.example.com/callback',
        response_type: 'code',
        scope: 'read',
        resource: 'https://mcphub.example.com/mcp/toggl',
      },
    });
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    const context = (injectOAuthConsentShell as jest.Mock).mock.calls[0][0];
    expect(context.resource).toMatchObject({ kind: 'server', name: 'toggl' });
  });

  it('resolves /mcp/{name} to a group via the DAOs (group wins over server)', async () => {
    (getGroupDao as jest.Mock).mockReturnValue({
      findByName: jest.fn().mockResolvedValue({ name: 'toggl' }),
    });

    const req = createRequest({
      query: {
        client_id: 'trusted-client',
        redirect_uri: 'https://trusted.example.com/callback',
        response_type: 'code',
        scope: 'read',
        resource: 'https://mcphub.example.com/mcp/toggl',
      },
    });
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    const context = (injectOAuthConsentShell as jest.Mock).mock.calls[0][0];
    expect(context.resource).toMatchObject({ kind: 'group', name: 'toggl' });
  });

  it('marks /mcp/{name} as unknown when it matches no server or group', async () => {
    const req = createRequest({
      query: {
        client_id: 'trusted-client',
        redirect_uri: 'https://trusted.example.com/callback',
        response_type: 'code',
        scope: 'read',
        resource: 'https://mcphub.example.com/mcp/does-not-exist',
      },
    });
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    const context = (injectOAuthConsentShell as jest.Mock).mock.calls[0][0];
    expect(context.resource).toMatchObject({
      kind: 'unknown',
      name: 'does-not-exist',
    });
  });

  it('passes RFC 7591 client metadata into the consent context', async () => {
    (findOAuthClientById as jest.Mock).mockResolvedValue({
      clientId: 'e9d6adf9e48449e6bee3f8b6fb024297',
      name: 'Claude',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      metadata: {
        application_type: 'web',
        contacts: ['security@example.com'],
        logo_uri: 'https://example.com/logo.png',
        client_uri: 'https://example.com',
        policy_uri: 'https://example.com/privacy',
        tos_uri: 'https://example.com/terms',
      },
    });

    const req = createRequest({
      query: {
        client_id: 'e9d6adf9e48449e6bee3f8b6fb024297',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        response_type: 'code',
        scope: 'read',
      },
    });
    const res = createResponse();

    await getAuthorize(req as any, res as any);

    const context = (injectOAuthConsentShell as jest.Mock).mock.calls[0][0];
    expect(context.client).toEqual({
      applicationType: 'web',
      contacts: ['security@example.com'],
      logoUri: 'https://example.com/logo.png',
      clientUri: 'https://example.com',
      policyUri: 'https://example.com/privacy',
      tosUri: 'https://example.com/terms',
    });
  });
});
