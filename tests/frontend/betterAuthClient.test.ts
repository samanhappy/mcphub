jest.mock('better-auth/react', () => ({
  createAuthClient: jest.fn(() => ({
    signIn: {
      social: jest.fn(),
    },
  })),
}));

describe('betterAuthClient', () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
    global.window = {
      location: {
        origin: 'http://localhost:5173',
        assign: jest.fn(),
      },
    } as any;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    global.window = originalWindow;
  });

  it('starts the OIDC login flow through Better Auth and redirects to the returned URL', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        url: 'https://auth.example.com/authorize?client_id=oidc-client-id',
        redirect: true,
      }),
    });

    const { startOidcLogin } = await import('../../frontend/src/services/betterAuthClient');

    await startOidcLogin({
      providerId: 'local-oidc',
      callbackURL: '/oauth/authorize?client_id=mcphub',
      errorCallbackURL: '/login',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5173/api/auth/better/sign-in/oauth2',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providerId: 'local-oidc',
          callbackURL: '/oauth/authorize?client_id=mcphub',
          errorCallbackURL: '/login',
        }),
      }),
    );
    expect(global.window.location.assign).toHaveBeenCalledWith(
      'https://auth.example.com/authorize?client_id=oidc-client-id',
    );
  });

  it('throws when Better Auth does not return a redirect URL', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        redirect: false,
      }),
    });

    const { startOidcLogin } = await import('../../frontend/src/services/betterAuthClient');

    await expect(
      startOidcLogin({
        providerId: 'local-oidc',
        callbackURL: '/',
        errorCallbackURL: '/login',
      }),
    ).rejects.toThrow('OIDC sign-in did not return a redirect URL.');
  });
});
