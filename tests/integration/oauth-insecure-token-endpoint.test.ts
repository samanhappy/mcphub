import {
  auth,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import { getServerDao } from '../../src/dao/index.js';
import { logger } from '../../src/utils/logger.js';
import type { ServerConfig } from '../../src/types/index.js';

jest.mock('../../src/dao/index.js', () => ({ getServerDao: jest.fn() }));
jest.mock('../../src/services/mcpService.js', () => ({ getServerByName: jest.fn() }));
jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  getRegisteredClient: jest.fn(),
  removeRegisteredClient: jest.fn(),
}));

let issuer: string;
let stored: Record<string, ServerConfig>;
let tokenRequests: URLSearchParams[];
const serverUrl = 'https://mcp.example.com/mcp';
const fetchFn: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === `${issuer}/token`) {
    tokenRequests.push(new URLSearchParams(String(init?.body)));
    return Response.json({ access_token: 'new-token', token_type: 'Bearer' });
  }
  if (url.includes('oauth-protected-resource')) {
    return Response.json({ resource: serverUrl, authorization_servers: [issuer] });
  }
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  });
};
const provider = (name = 'upstream') =>
  new MCPHubOAuthProvider(name, structuredClone(stored[name]));
const start = async (p: MCPHubOAuthProvider) => {
  await expect(auth(p, { serverUrl, fetchFn })).rejects.toThrow('OAuth authorization required');
};

beforeEach(() => {
  issuer = 'http://gitlab.internal.example';
  tokenRequests = [];
  stored = {
    upstream: {
      url: serverUrl,
      oauth: { clientId: 'client', scopes: [], accessToken: 'expired-token' },
    },
    other: {
      url: serverUrl,
      oauth: { clientId: 'other-client', scopes: [], accessToken: 'expired-token' },
    },
  };
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.mocked(getServerDao).mockReturnValue({
    findById: jest.fn(async (name) => ({ name, ...structuredClone(stored[name]) })),
    update: jest.fn(async (name, updates) => {
      stored[name] = structuredClone({ ...stored[name], ...updates });
      return { name, ...stored[name] };
    }),
  } as unknown as ReturnType<typeof getServerDao>);
});
afterEach(() => jest.restoreAllMocks());

it.each([SSEClientTransport, StreamableHTTPClientTransport])(
  '%p keeps HTTP token exchange blocked by default and permits an explicit exception',
  async (Transport) => {
    await start(provider());
    const finish = () =>
      new Transport(new URL(serverUrl), { authProvider: provider(), fetch: fetchFn }).finishAuth(
        'code',
      );
    await expect(finish()).rejects.toThrow('Refusing to send credentials');
    expect(tokenRequests).toHaveLength(0);
    stored.upstream.oauth!.allowInsecureTokenEndpoint = true;
    await finish();
    expect(tokenRequests[0].get('grant_type')).toBe('authorization_code');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('admin-enabled exception'), {
      serverName: 'upstream',
      tokenEndpointOrigin: issuer,
    });
  },
);

it('limits HTTP refresh to the opted-in upstream and respects revocation on an existing provider', async () => {
  stored.upstream.oauth!.allowInsecureTokenEndpoint = true;
  for (const config of Object.values(stored)) config.oauth!.refreshToken = 'refresh';
  const p = provider();
  await expect(auth(p, { serverUrl, fetchFn })).resolves.toBe('AUTHORIZED');
  expect(tokenRequests[0].get('grant_type')).toBe('refresh_token');
  await expect(auth(provider('other'), { serverUrl, fetchFn })).rejects.toThrow(
    'Refusing to send credentials',
  );
  stored.upstream.oauth!.allowInsecureTokenEndpoint = false;
  await expect(auth(p, { serverUrl, fetchFn })).rejects.toThrow('Refusing to send credentials');
  expect(tokenRequests).toHaveLength(1);
});

it('respects revocation between authorization and callback without discarding the PKCE verifier', async () => {
  stored.upstream.oauth!.allowInsecureTokenEndpoint = true;
  const p = provider();
  await start(p);
  stored.upstream.oauth!.allowInsecureTokenEndpoint = false;
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    authProvider: p,
    fetch: fetchFn,
  });
  await expect(transport.finishAuth('code')).rejects.toThrow('Refusing to send credentials');
  expect(tokenRequests).toHaveLength(0);
  expect(stored.upstream.oauth!.pendingAuthorization?.codeVerifier).toBeDefined();
});

it.each(['https://as.example.com', 'http://localhost', 'http://127.0.0.1', 'http://[::1]'])(
  'preserves the secure default for %s',
  async (url) => {
    issuer = url;
    stored.upstream.oauth!.refreshToken = 'refresh';
    await expect(auth(provider(), { serverUrl, fetchFn })).resolves.toBe('AUTHORIZED');
    expect(tokenRequests).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('admin-enabled exception'),
      expect.anything(),
    );
  },
);
