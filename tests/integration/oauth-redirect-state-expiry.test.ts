import express from 'express';
import request from 'supertest';
import { MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import { getServerDao } from '../../src/dao/index.js';
import {
  connectClientWithDiagnostics,
  createTransportFromConfig,
  getServerByName,
  getServerByOAuthState,
  getServerByPendingOAuthState,
} from '../../src/services/mcpService.js';
import {
  handleOAuthCallback,
  resetOAuthStateTrackingForTests,
} from '../../src/controllers/oauthCallbackController.js';
import type { ServerConfig, ServerInfo } from '../../src/types/index.js';

jest.mock('../../src/dao/index.js', () => ({ getServerDao: jest.fn() }));
jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: jest.fn(),
  getServerByOAuthState: jest.fn(),
  getServerByPendingOAuthState: jest.fn(),
  connectClientWithDiagnostics: jest.fn(),
  createTransportFromConfig: jest.fn(),
  updateServerToolsCache: jest.fn(),
}));
jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  getRegisteredClient: jest.fn(),
  removeRegisteredClient: jest.fn(),
}));

const ttl = 10 * 60 * 1000;

beforeEach(() => {
  resetOAuthStateTrackingForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it.each(['fresh', 'obsolete', 'expired'] as const)(
  'handles %s callback state after replacing an expired pending authorization',
  async (scenario) => {
    const startedAt = 1_800_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(startedAt);
    let stored: ServerConfig = {
      url: 'https://upstream.example.com/mcp',
      oauth: {
        clientId: 'client-id',
        redirectUri: 'https://hub.example.com/oauth/callback',
        pendingAuthorization: {
          state: 'obsolete-state',
          authorizationUrl: 'https://as.example.com/authorize?state=obsolete-state',
          createdAt: startedAt - ttl - 1,
        },
      },
    };
    const staleConfig = structuredClone(stored);
    const finishAuth = jest.fn().mockResolvedValue(undefined);
    const client = {
      getServerCapabilities: jest.fn().mockReturnValue({}),
    };
    const serverInfo = {
      name: 'upstream',
      config: staleConfig,
      status: 'oauth_required',
      oauth: { state: 'obsolete-state' },
      transport: { finishAuth, close: jest.fn().mockResolvedValue(undefined) },
      client,
      tools: [],
      prompts: [],
      resources: [],
    } as unknown as ServerInfo;
    const registry = [serverInfo];
    jest
      .mocked(getServerByName)
      .mockImplementation((name) => registry.find((server) => server.name === name));
    jest
      .mocked(getServerByOAuthState)
      .mockImplementation((state) => registry.find((server) => server.oauth?.state === state));
    jest
      .mocked(getServerByPendingOAuthState)
      .mockImplementation((state) =>
        registry.find((server) => server.config?.oauth?.pendingAuthorization?.state === state),
      );
    jest.mocked(getServerDao).mockReturnValue({
      findById: jest.fn(async () => ({ name: 'upstream', ...structuredClone(stored) })),
      update: jest.fn(async (_name, updates) => {
        stored = structuredClone({ ...stored, ...updates });
        return { name: 'upstream', ...structuredClone(stored) };
      }),
    } as unknown as ReturnType<typeof getServerDao>);
    const refreshedTransport = { close: jest.fn().mockResolvedValue(undefined) };
    jest
      .mocked(createTransportFromConfig)
      .mockResolvedValue(
        refreshedTransport as unknown as Awaited<ReturnType<typeof createTransportFromConfig>>,
      );
    jest.mocked(connectClientWithDiagnostics).mockResolvedValue(undefined);

    // The provider and registry start with separate snapshots, as after startup.
    const provider = new MCPHubOAuthProvider('upstream', structuredClone(stored));
    const authorizationUrl = new URL('https://as.example.com/authorize');
    await expect(provider.redirectToAuthorization(authorizationUrl)).rejects.toThrow(
      'OAuth authorization required',
    );
    const freshState = authorizationUrl.searchParams.get('state')!;
    expect(freshState).toBeTruthy();
    expect(freshState).not.toBe('obsolete-state');
    expect(stored.oauth?.pendingAuthorization?.createdAt).toBe(startedAt);
    expect(staleConfig.oauth?.pendingAuthorization?.createdAt).toBe(startedAt - ttl - 1);

    if (scenario === 'expired') {
      now.mockReturnValue(startedAt + ttl + 1);
    }
    const app = express();
    app.get('/oauth/callback', (req, res) => {
      void handleOAuthCallback(req, res);
    });
    const response = await request(app)
      .get('/oauth/callback')
      .query({
        code: 'auth-code',
        state: scenario === 'obsolete' ? 'obsolete-state' : freshState,
        iss: 'https://as.example.com',
      });

    if (scenario === 'fresh') {
      expect(response.status).toBe(200);
      expect(finishAuth).toHaveBeenCalledWith('auth-code', 'https://as.example.com');
      expect(connectClientWithDiagnostics).toHaveBeenCalledWith(
        client,
        refreshedTransport,
        expect.objectContaining({ timeout: 60000 }),
      );
      expect(serverInfo.status).toBe('connected');
    } else {
      expect(response.status).toBe(400);
      expect(finishAuth).not.toHaveBeenCalled();
      expect(connectClientWithDiagnostics).not.toHaveBeenCalled();
      expect(createTransportFromConfig).not.toHaveBeenCalled();
    }
  },
);
