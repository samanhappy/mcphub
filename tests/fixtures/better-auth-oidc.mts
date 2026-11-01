import assert from 'node:assert/strict';
import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';

// Run in Node's ESM runtime so the installed Better Auth is exercised without Jest mocks.
const origin = 'http://localhost:3000';
const issuer = 'https://issuer.example.com';
const nativeFetch = globalThis.fetch;
for (const [basePath, authPath] of [
  ['', '/api/auth/better'],
  ['/hub', '/custom/auth'],
]) {
  let authorizationURL = '';
  let cookies = '';
  const auth = betterAuth({
    baseURL: `${origin}${basePath}${authPath}`,
    basePath: `${basePath}${authPath}`,
    secret: 'oidc-integration-test-secret-at-least-32-characters',
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: 'local-oidc',
            discoveryUrl: `${issuer}/.well-known/openid-configuration`,
            clientId: 'test-client',
            clientSecret: 'test-secret',
            scopes: ['openid', 'profile', 'email'],
            pkce: true,
          },
        ],
      }),
    ],
  });
  globalThis.window = {
    __MCPHUB_CONFIG__: { basePath },
    location: {
      origin,
      assign: (url: string) => {
        authorizationURL = url;
      },
    },
  } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer,
        id_token_signing_alg_values_supported: ['RS256'],
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
      });
    }
    if (url === `${issuer}/token`) {
      return Response.json({ access_token: 'test-access-token', token_type: 'Bearer' });
    }
    if (url === `${issuer}/userinfo`) {
      return Response.json({
        sub: 'oidc-user',
        name: 'OIDC Test',
        email: 'oidc@example.com',
        email_verified: true,
      });
    }
    const response = await auth.handler(new Request(url, init));
    cookies = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    return response;
  };
  try {
    const { startOidcLogin } = await import('../../frontend/src/services/betterAuthClient.ts');
    await startOidcLogin({
      providerId: 'local-oidc',
      callbackURL: '/success',
      errorCallbackURL: '/login',
      basePathOverride: authPath,
    });
    const authorization = new URL(authorizationURL);
    assert.equal(authorization.origin, issuer);
    assert.equal(authorization.searchParams.get('client_id'), 'test-client');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    assert.equal(callback.href, `${origin}${basePath}${authPath}/callback/local-oidc`);
    callback.searchParams.set('code', 'test-code');
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    const response = await auth.handler(new Request(callback, { headers: { cookie: cookies } }));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/success');
    const sessionCookies = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const session = await auth.handler(
      new Request(`${origin}${basePath}${authPath}/get-session`, {
        headers: { cookie: sessionCookies },
      }),
    );
    assert.equal((await session.json()).user.email, 'oidc@example.com');
  } finally {
    globalThis.fetch = nativeFetch;
  }
}
console.log('OIDC sign-in, PKCE, callback and session passed for default and custom base paths');
