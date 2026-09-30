import { auth, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import { getServerDao } from '../../src/dao/index.js';
import type { ServerConfig } from '../../src/types/index.js';

jest.mock('../../src/dao/index.js', () => ({ getServerDao: jest.fn() }));
jest.mock('../../src/services/mcpService.js', () => ({ getServerByName: jest.fn() }));
jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  getRegisteredClient: jest.fn(),
  removeRegisteredClient: jest.fn(),
}));

const issuer = 'https://as.example.com';
const serverUrl = 'https://mcp.example.com/mcp';
let stored: ServerConfig;
let tokenCalls: number;
let issRequired: boolean;
let tokenBody: URLSearchParams;
const fetchFn: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === `${issuer}/token`) {
    tokenCalls++;
    tokenBody = new URLSearchParams(String(init?.body));
    return Response.json({ access_token: 'access-token', token_type: 'Bearer' });
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
    authorization_response_iss_parameter_supported: issRequired,
  });
};
const createProvider = () => new MCPHubOAuthProvider('upstream', structuredClone(stored));
const start = async (provider: MCPHubOAuthProvider) => {
  await expect(auth(provider, { serverUrl, fetchFn })).rejects.toThrow(
    'OAuth authorization required',
  );
};
const finish = (provider: MCPHubOAuthProvider, iss?: string) =>
  new StreamableHTTPClientTransport(new URL(serverUrl), {
    authProvider: provider,
    fetch: fetchFn,
  }).finishAuth('authorization-code', iss);

beforeEach(() => {
  tokenCalls = 0;
  issRequired = false;
  tokenBody = new URLSearchParams();
  stored = {
    url: serverUrl,
    oauth: {
      clientId: 'client-id',
      scopes: [],
      redirectUri: 'https://hub.example.com/oauth/callback',
    },
  };
  jest.mocked(getServerDao).mockReturnValue({
    findById: jest.fn(async () => ({ name: 'upstream', ...structuredClone(stored) })),
    update: jest.fn(async (_name, updates) => {
      stored = structuredClone({ ...stored, ...updates });
      return { name: 'upstream', ...structuredClone(stored) };
    }),
  } as unknown as ReturnType<typeof getServerDao>);
});

it.each([false, true])(
  'completes SDK authorization with recreated provider=%s',
  async (restart) => {
    const provider = createProvider();
    await start(provider);
    const verifier = stored.oauth?.pendingAuthorization?.codeVerifier;
    expect(stored.oauth?.pendingAuthorization?.discoveryState?.authorizationServerUrl).toBe(issuer);
    const callbackProvider = restart ? createProvider() : provider;
    await finish(callbackProvider);
    expect(tokenCalls).toBe(1);
    expect(tokenBody.get('code_verifier')).toBe(verifier);
    expect(tokenBody.get('code')).toBe('authorization-code');
    expect(stored.oauth?.accessToken).toBe('access-token');
    expect(stored.oauth?.pendingAuthorization).toBeUndefined();
  },
);

it('passes the advertised issuer through the SDK callback', async () => {
  issRequired = true;
  await start(createProvider());
  await finish(createProvider(), issuer);
  expect(tokenCalls).toBe(1);
});

it('rejects a legacy pending flow without discovery state before token exchange', async () => {
  await start(createProvider());
  // Simulate a pending flow persisted by a pre-fix installation.
  const pending = stored.oauth!.pendingAuthorization!;
  Reflect.deleteProperty(pending, 'discoveryState');
  await expect(finish(createProvider())).rejects.toThrow('discoveryState was not available');
  expect(tokenCalls).toBe(0);
});

it.each(['discovery', 'verifier', 'all'] as const)(
  'clears cached and persisted discovery on %s invalidation',
  async (scope) => {
    const provider = createProvider();
    await start(provider);
    expect(await provider.discoveryState()).toBeDefined();
    await provider.invalidateCredentials(scope);
    expect(await provider.discoveryState()).toBeUndefined();
    expect(await createProvider().discoveryState()).toBeUndefined();
    if (scope === 'discovery') {
      expect(stored.oauth?.pendingAuthorization?.codeVerifier).toBeDefined();
    } else {
      expect(stored.oauth?.pendingAuthorization).toBeUndefined();
    }
  },
);

it('clears in-memory discovery after token exchange and permits a fresh flow', async () => {
  const provider = createProvider();
  await start(provider);
  await finish(provider);
  expect(await provider.discoveryState()).toBeUndefined();
  await provider.invalidateCredentials('tokens');
  await start(provider);
  expect(stored.oauth?.pendingAuthorization?.discoveryState).toBeDefined();
});

it('rejects a mismatched callback issuer before token exchange', async () => {
  await start(createProvider());
  await expect(finish(createProvider(), 'https://other.example.com')).rejects.toThrow(
    'Issuer mismatch',
  );
  expect(tokenCalls).toBe(0);
});

it('does not expose a redirect when persisting its discovery snapshot fails', async () => {
  const provider = createProvider();
  await start(provider);
  const dao = getServerDao();
  jest.mocked(dao.update).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(provider.redirectToAuthorization(new URL(`${issuer}/authorize`))).rejects.toThrow(
    'storage unavailable',
  );
});
