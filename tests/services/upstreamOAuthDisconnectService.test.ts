const mockLoadServerConfig = jest.fn();
const mockClearOAuthData = jest.fn();
const mockResetServerOAuthConnection = jest.fn();
const mockReconnectServer = jest.fn();
const mockGetServerByName = jest.fn();
const mockGetRegisteredClient = jest.fn();
const mockUserDao = {
  findByUsername: jest.fn(),
};
const mockAssertSafeUrl = jest.fn();
const mockCreateRedirectValidatingFetch = jest.fn();

jest.mock('../../src/services/oauthSettingsStore.js', () => ({
  loadServerConfig: mockLoadServerConfig,
  clearOAuthData: mockClearOAuthData,
}));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getUserDao: jest.fn(() => mockUserDao),
}));

jest.mock('../../src/utils/ssrf.js', () => ({
  assertSafeUrl: mockAssertSafeUrl,
  createRedirectValidatingFetch: mockCreateRedirectValidatingFetch,
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: mockGetServerByName,
  reconnectServer: mockReconnectServer,
  resetServerOAuthConnection: mockResetServerOAuthConnection,
}));

jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  getRegisteredClient: mockGetRegisteredClient,
  removeRegisteredClient: jest.fn(),
}));

import { disconnectUpstreamOAuth } from '../../src/services/upstreamOAuthDisconnectService.js';

describe('disconnectUpstreamOAuth', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(''),
    });
    mockUserDao.findByUsername.mockResolvedValue({ isAdmin: true });
    mockAssertSafeUrl.mockResolvedValue(undefined);
    mockCreateRedirectValidatingFetch.mockImplementation((baseFetch) => baseFetch);
    mockClearOAuthData.mockResolvedValue({ oauth: {} });
    mockReconnectServer.mockResolvedValue(undefined);
    mockResetServerOAuthConnection.mockReturnValue(true);
    mockGetServerByName.mockReturnValue({
      status: 'oauth_required',
      oauth: {
        authorizationUrl: 'https://issuer.example.com/oauth/authorize?state=fresh',
      },
    });
    mockGetRegisteredClient.mockReturnValue(undefined);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('revokes stored refresh and access tokens before clearing local tokens and resetting runtime status', async () => {
    mockLoadServerConfig.mockResolvedValue({
      url: 'https://mcp.example.com/mcp',
      owner: 'admin',
      oauth: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        revocationEndpoint: 'https://issuer.example.com/oauth/revoke',
      },
    });

    const result = await disconnectUpstreamOAuth('notion', { scope: 'tokens' });

    expect(mockUserDao.findByUsername).toHaveBeenCalledWith('admin');
    expect(mockAssertSafeUrl).toHaveBeenCalledWith(
      'https://issuer.example.com/oauth/revoke',
      { allowInternal: true },
    );
    expect(mockCreateRedirectValidatingFetch).toHaveBeenCalledWith(fetchMock, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://issuer.example.com/oauth/revoke',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );
    const refreshBody = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(refreshBody.get('token')).toBe('refresh-token');
    expect(refreshBody.get('token_type_hint')).toBe('refresh_token');
    expect(refreshBody.get('client_id')).toBe('client-id');
    expect(refreshBody.get('client_secret')).toBe('client-secret');

    const accessBody = fetchMock.mock.calls[1][1].body as URLSearchParams;
    expect(accessBody.get('token')).toBe('access-token');
    expect(accessBody.get('token_type_hint')).toBe('access_token');

    expect(mockClearOAuthData).toHaveBeenNthCalledWith(1, 'notion', 'tokens');
    expect(mockClearOAuthData).toHaveBeenNthCalledWith(2, 'notion', 'verifier');
    expect(mockResetServerOAuthConnection).toHaveBeenCalledWith('notion');
    expect(mockReconnectServer).toHaveBeenCalledWith('notion');
    expect(result).toEqual({
      success: true,
      scope: 'tokens',
      revoked: {
        attempted: 2,
        succeeded: 2,
        failed: 0,
      },
      revocationEndpoint: 'https://issuer.example.com/oauth/revoke',
    });
  });

  it('uses non-admin SSRF restrictions for non-admin-owned servers', async () => {
    mockUserDao.findByUsername.mockResolvedValue({ isAdmin: false });
    mockLoadServerConfig.mockResolvedValue({
      owner: 'alice',
      oauth: {
        accessToken: 'access-token',
        revocationEndpoint: 'https://issuer.example.com/oauth/revoke',
      },
    });

    await disconnectUpstreamOAuth('notion', { scope: 'tokens' });

    expect(mockAssertSafeUrl).toHaveBeenCalledWith(
      'https://issuer.example.com/oauth/revoke',
      { allowInternal: false },
    );
    expect(mockCreateRedirectValidatingFetch).toHaveBeenCalledWith(fetchMock, false);
  });

  it('clears local OAuth data and resets runtime status when provider revocation fails', async () => {
    mockLoadServerConfig.mockResolvedValue({
      oauth: {
        accessToken: 'access-token',
        clientId: 'client-id',
        revocationEndpoint: 'https://issuer.example.com/oauth/revoke',
      },
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: jest.fn().mockResolvedValue('temporarily unavailable'),
    });

    const result = await disconnectUpstreamOAuth('notion', { scope: 'all' });

    expect(mockClearOAuthData).toHaveBeenCalledWith('notion', 'all');
    expect(mockResetServerOAuthConnection).toHaveBeenCalledWith('notion');
    expect(mockReconnectServer).toHaveBeenCalledWith('notion');
    expect(result).toMatchObject({
      success: true,
      scope: 'all',
      revoked: {
        attempted: 1,
        succeeded: 0,
        failed: 1,
      },
    });
  });

  it('waits for reconnect to expose a fresh authorization URL before returning', async () => {
    mockLoadServerConfig.mockResolvedValue({
      url: 'https://mcp.example.com/mcp',
      oauth: {
        accessToken: 'access-token',
      },
    });
    mockGetServerByName
      .mockReturnValueOnce({ status: 'connecting' })
      .mockReturnValueOnce({
        status: 'oauth_required',
        oauth: {
          authorizationUrl: 'https://issuer.example.com/oauth/authorize?state=fresh',
        },
      });

    await disconnectUpstreamOAuth('linear', { scope: 'tokens' });

    expect(mockClearOAuthData).toHaveBeenNthCalledWith(1, 'linear', 'tokens');
    expect(mockClearOAuthData).toHaveBeenNthCalledWith(2, 'linear', 'verifier');
    expect(mockResetServerOAuthConnection).toHaveBeenCalledWith('linear');
    expect(mockReconnectServer).toHaveBeenCalledWith('linear');
    expect(mockGetServerByName).toHaveBeenCalledTimes(2);
  });
});
