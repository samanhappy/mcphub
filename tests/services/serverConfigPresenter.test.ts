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
// `futureSetting` simulates an unrecognized ServerConfig field added in a
// future release — the allowlist must withhold it too.
const SENTINELS = [
  'Bearer mcphub-phase1-secret',
  'mcphub-phase1-api-key',
  'mcphub-phase1-client-secret',
  'mcphub-phase1-refresh-token',
  'mcphub-phase1-proxy-password',
  'mcphub-phase1-future-secret',
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
  sharedWithUsers: ['alice'],
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
  // Unrecognized field a future MCPHub version might add. The restricted view
  // is allowlist-based, so this must never leak to shared users.
  futureSetting: 'mcphub-phase1-future-secret',
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

    it('gives shared users an allowlisted view with no connection configuration', () => {
      const raw = buildRawServerConfig();

      const presented = presentServerForPrincipal(raw, alice);

      expect(presented.view).toBe('safe');
      const data = presented.data as Record<string, unknown>;
      expect(data).toEqual({
        name: 'org-search',
        description: 'Org web search',
        type: 'streamable-http',
        visibility: 'public',
        owner: 'bob',
        enabled: true,
        tools: { search: { enabled: true } },
        configRestricted: true,
      });
    });

    it('withholds url, command and every other raw config field from shared users', () => {
      const body = JSON.stringify(presentServerForPrincipal(buildRawServerConfig(), alice));
      for (const withheld of [
        'https://mcp.example.com/mcp',
        '"command"',
        '"args"',
        '"env"',
        '"headers"',
        '"oauth"',
        '"proxy"',
        '"openapi"',
        '"options"',
        '"passthroughHeaders"',
        '"sharedWithUsers"',
        '"perSessionClient"',
        '"startOnDemand"',
        '"idleTimeoutMs"',
        '"enableKeepAlive"',
        '"keepAliveInterval"',
        '"futureSetting"',
      ]) {
        expect(body).not.toContain(withheld);
      }
    });

    it('serializes the safe view without any sentinel secret, including unknown fields', () => {
      const body = JSON.stringify(presentServerForPrincipal(buildRawServerConfig(), alice));
      for (const sentinel of SENTINELS) {
        expect(body).not.toContain(sentinel);
      }
      expect(body).not.toContain('at-secret');
      expect(body).not.toContain('oauth-state-value');
      expect(body).not.toContain('pkce-secret');
    });

    it('an explicitly null principal stays anonymous even when the ambient context is admin', () => {
      mockGetCurrentUser.mockReturnValue(admin);

      const presented = presentServerForPrincipal(buildRawServerConfig(), null);

      expect(presented.view).toBe('safe');
      const body = JSON.stringify(presented.data);
      for (const sentinel of SENTINELS) {
        expect(body).not.toContain(sentinel);
      }
    });

    it('falls back to the ambient user context when no principal is passed', () => {
      mockGetCurrentUser.mockReturnValue(admin);
      const presented = presentServerForPrincipal({ owner: 'bob', visibility: 'private' });
      expect(presented.view).toBe('full');

      mockGetCurrentUser.mockReturnValue(alice);
      const restricted = presentServerForPrincipal({ owner: 'bob', visibility: 'private' });
      expect(restricted.view).toBe('safe');
    });
  });

  describe('presentServerInfoForPrincipal', () => {
    const info = {
      name: 'org-search',
      owner: 'bob',
      status: 'connected',
      tools: [{ name: 'search' }],
      createTime: 1234567890,
      oauth: {
        authorizationUrl: 'https://auth.example.com/authorize?state=oauth-state-value',
        state: 'oauth-state-value',
        clientIdConfigured: true,
        connected: false,
      },
      config: {
        type: 'streamable-http',
        description: 'Org web search',
        command: 'npx',
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

    it('reduces the embedded connection config to the safe allowlist', () => {
      const presented = presentServerInfoForPrincipal(info, alice) as Record<string, unknown>;
      const config = presented.config as Record<string, unknown>;
      expect(config.type).toBe('streamable-http');
      expect(config.description).toBe('Org web search');
      expect(config.command).toBeUndefined();
      expect(config.configRestricted).toBe(true);
    });

    it('never leaks the OAuth state or command values in serialized output', () => {
      const body = JSON.stringify([presentServerInfoForPrincipal(info, alice)]);
      expect(body).not.toContain('oauth-state-value');
      expect(body).not.toContain('"command"');
    });
  });
});
