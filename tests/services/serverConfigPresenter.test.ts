import {
  presentServerForPrincipal,
  presentServerInfoForPrincipal,
} from '../../src/services/serverConfigPresenter.js';
import { UserContextService } from '../../src/services/userContextService.js';

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({
      getCurrentUser: mockGetCurrentUser,
    })),
  },
}));

const mockGetCurrentUser = jest.fn();

// Sentinel secrets from the Phase 1 plan. Every safe-view assertion below
// checks the SERIALIZED output so a nested leak cannot slip through.
const SENTINELS = [
  'Bearer mcphub-phase1-secret',
  'mcphub-phase1-api-key',
  'mcphub-phase1-client-secret',
  'mcphub-phase1-refresh-token',
  'mcphub-phase1-proxy-password',
];

const admin = { username: 'admin', isAdmin: true };
const bob = { username: 'bob', isAdmin: false };
const alice = { username: 'alice', isAdmin: false };

const buildRawServerConfig = (): Record<string, unknown> => ({
  name: 'org-search',
  type: 'streamable-http',
  url: 'https://mcp.example.com/mcp',
  command: undefined,
  args: ['--token', 'mcphub-phase1-secret'],
  description: 'Org web search',
  env: { UPSTREAM_API_KEY: 'mcphub-phase1-api-key' },
  headers: { Authorization: 'Bearer mcphub-phase1-secret' },
  passthroughHeaders: ['X-Request-Id'],
  owner: 'bob',
  visibility: 'public',
  sharedWithUsers: undefined,
  enabled: true,
  options: { timeout: 30000 },
  oauth: {
    clientId: 'client-123',
    clientSecret: 'mcphub-phase1-client-secret',
    accessToken: 'at-secret',
    refreshToken: 'mcphub-phase1-refresh-token',
    pendingAuthorization: { state: 'oauth-state-value', codeVerifier: 'pkce-secret' },
  },
  proxy: { server: 'proxy.example.com', password: 'mcphub-phase1-proxy-password' },
  openapi: {
    url: 'https://api.example.com/openapi.json',
    version: '3.1.0',
    security: {
      type: 'apiKey',
      apiKey: { name: 'X-Key', in: 'header', value: 'mcphub-phase1-api-key' },
    },
  },
  perSessionClient: false,
  startOnDemand: false,
  idleTimeoutMs: 300000,
  enableKeepAlive: true,
  keepAliveInterval: 60000,
  tools: { search: { enabled: true } },
});

describe('serverConfigPresenter (#1036 Phase 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUser.mockReturnValue(null);
  });

  describe('presentServerForPrincipal', () => {
    it('returns a full deep copy to admins and owners without mutating the input', () => {
      const raw = buildRawServerConfig();
      const snapshot = JSON.stringify(raw);

      const presented = presentServerForPrincipal(raw, bob);

      expect(presented.view).toBe('full');
      expect(presented.data).toEqual(raw);
      expect(JSON.stringify(raw)).toBe(snapshot);
      // Deep copy: mutating the presented data must not touch the source
      (presented.data as Record<string, unknown>).description = 'tampered';
      expect((raw as Record<string, unknown>).description).toBe('Org web search');
    });

    it('gives shared users a safe view with no secret-bearing fields', () => {
      const raw = buildRawServerConfig();

      const presented = presentServerForPrincipal(raw, alice);

      expect(presented.view).toBe('safe');
      const data = presented.data as Record<string, unknown>;
      expect(data.env).toBeUndefined();
      expect(data.headers).toBeUndefined();
      expect(data.args).toBeUndefined();
      expect(data.oauth).toBeUndefined();
      expect(data.proxy).toBeUndefined();
      expect(data.openapi).toEqual({
        url: 'https://api.example.com/openapi.json',
        version: '3.1.0',
      });
      expect(data.configRestricted).toBe(true);
    });

    it('keeps harmless metadata in the safe view', () => {
      const presented = presentServerForPrincipal(buildRawServerConfig(), alice);
      const data = presented.data as Record<string, unknown>;

      expect(data.name).toBe('org-search');
      expect(data.type).toBe('streamable-http');
      expect(data.url).toBe('https://mcp.example.com/mcp');
      expect(data.description).toBe('Org web search');
      expect(data.visibility).toBe('public');
      expect(data.owner).toBe('bob');
      expect(data.enabled).toBe(true);
      expect(data.passthroughHeaders).toEqual(['X-Request-Id']);
      expect(data.options).toEqual({ timeout: 30000 });
      expect(data.tools).toEqual({ search: { enabled: true } });
    });

    it('serializes the safe view without any sentinel secret', () => {
      const body = JSON.stringify(presentServerForPrincipal(buildRawServerConfig(), alice));
      for (const sentinel of SENTINELS) {
        expect(body).not.toContain(sentinel);
      }
      expect(body).not.toContain('at-secret');
      expect(body).not.toContain('oauth-state-value');
      expect(body).not.toContain('pkce-secret');
    });

    it('fails closed for anonymous principals', () => {
      const presented = presentServerForPrincipal(buildRawServerConfig(), null);
      expect(presented.view).toBe('safe');
      expect(
        (presented.data as Record<string, unknown>).headers,
      ).toBeUndefined();
    });

    it('marks servers without any credentials as restricted too, for uniform handling', () => {
      const plain = { name: 'plain', type: 'sse', url: 'https://x.example.com/sse' };
      const presented = presentServerForPrincipal(plain, alice);
      expect(presented.view).toBe('safe');
      expect((presented.data as Record<string, unknown>).configRestricted).toBe(true);
    });

    it('falls back to the ambient user context when no principal is passed', () => {
      mockGetCurrentUser.mockReturnValue(admin);
      const presented = presentServerForPrincipal({ owner: 'bob', visibility: 'private' });
      expect(presented.view).toBe('full');
    });
  });

  describe('presentServerInfoForPrincipal', () => {
    const info = {
      name: 'org-search',
      owner: 'bob',
      status: 'connected',
      tools: [{ name: 'search' }],
      oauth: {
        authorizationUrl: 'https://auth.example.com/authorize?state=oauth-state-value',
        state: 'oauth-state-value',
        clientIdConfigured: true,
        connected: false,
      },
    };

    it('leaves entries intact for config readers', () => {
      expect(presentServerInfoForPrincipal(info, bob)).toBe(info);
      expect(presentServerInfoForPrincipal(info, admin)).toBe(info);
    });

    it('strips OAuth session fields but keeps indicators for other users', () => {
      const presented = presentServerInfoForPrincipal(info, alice) as Record<string, unknown>;
      const oauth = presented.oauth as Record<string, unknown>;
      expect(oauth.authorizationUrl).toBeUndefined();
      expect(oauth.state).toBeUndefined();
      expect(oauth.clientIdConfigured).toBe(true);
      expect(oauth.connected).toBe(false);
      expect(presented.status).toBe('connected');
    });

    it('never leaks the OAuth state value in serialized output', () => {
      const body = JSON.stringify([presentServerInfoForPrincipal(info, alice)]);
      expect(body).not.toContain('oauth-state-value');
    });
  });
});
