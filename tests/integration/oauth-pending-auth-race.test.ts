import express from 'express';
import request from 'supertest';
import { withOAuthPendingAuthLock } from '../../src/services/replicaLock.js';
import { MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import { getServerDao } from '../../src/dao/index.js';
import { updatePendingAuthorization } from '../../src/services/oauthSettingsStore.js';
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

type Stored = ServerConfig & { name: string };

const installDao = (stored: { current: Stored }) => {
  (getServerDao as jest.Mock).mockReturnValue({
    findById: jest.fn(async (_name: string) => structuredClone(stored.current)),
    update: jest.fn(async (_name: string, updates: Partial<ServerConfig>) => {
      stored.current = structuredClone({
        ...stored.current,
        ...updates,
      }) as Stored;
      return structuredClone(stored.current);
    }),
  } as unknown as ReturnType<typeof getServerDao>);
};

/** One SDK auth() leg: state() -> saveCodeVerifier() -> redirectToAuthorization(). */
const runFlow = async (provider: MCPHubOAuthProvider, verifier: string) => {
  const state = await provider.state();
  await provider.saveCodeVerifier(verifier);
  const authorizationUrl = new URL('https://as.example.com/authorize');
  authorizationUrl.searchParams.set('state', state);
  await expect(provider.redirectToAuthorization(authorizationUrl)).rejects.toThrow(
    'OAuth authorization required',
  );
  return state;
};

beforeEach(() => {
  resetOAuthStateTrackingForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('updatePendingAuthorization createdAt rule', () => {
  it('refreshes createdAt only when state changes and clears a stale verifier', async () => {
    const startedAt = 1_800_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(startedAt);
    const stored = {
      current: {
        name: 'upstream',
        url: 'https://upstream.example.com/mcp',
        oauth: { clientId: 'client-id' },
      } as Stored,
    };
    installDao(stored);

    await updatePendingAuthorization('upstream', { state: 'state-1', codeVerifier: 'v1' });
    expect(stored.current.oauth?.pendingAuthorization?.createdAt).toBe(startedAt);

    now.mockReturnValue(startedAt + 60_000);
    // Verifier-only update: TTL stays anchored to the start of the flow.
    await updatePendingAuthorization('upstream', { codeVerifier: 'v2' });
    expect(stored.current.oauth?.pendingAuthorization?.createdAt).toBe(startedAt);
    expect(stored.current.oauth?.pendingAuthorization?.codeVerifier).toBe('v2');

    // A new state starts a new flow: createdAt refreshes...
    now.mockReturnValue(startedAt + 120_000);
    await updatePendingAuthorization('upstream', { state: 'state-2', codeVerifier: 'v3' });
    expect(stored.current.oauth?.pendingAuthorization?.createdAt).toBe(startedAt + 120_000);

    // ...and a state change without its own verifier drops the stale one
    // instead of keeping a (state, verifier) pair from two different flows.
    await updatePendingAuthorization('upstream', { state: 'state-3' });
    expect(stored.current.oauth?.pendingAuthorization?.codeVerifier).toBeUndefined();
  });
});

describe('concurrent connect() calls', () => {
  it('keeps state + codeVerifier paired; stale callbacks are rejected, current ones bind the right verifier', async () => {
    const stored = {
      current: {
        name: 'upstream',
        url: 'https://upstream.example.com/mcp',
        oauth: { clientId: 'client-id' },
      } as Stored,
    };
    installDao(stored);

    const finishAuth = jest.fn().mockResolvedValue(undefined);
    const client = { getServerCapabilities: jest.fn().mockReturnValue({}) };
    const serverInfo = {
      name: 'upstream',
      config: structuredClone(stored.current),
      status: 'disconnected',
      oauth: undefined,
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
    const refreshedTransport = { close: jest.fn().mockResolvedValue(undefined) };
    jest
      .mocked(createTransportFromConfig)
      .mockResolvedValue(
        refreshedTransport as unknown as Awaited<ReturnType<typeof createTransportFromConfig>>,
      );
    jest.mocked(connectClientWithDiagnostics).mockResolvedValue(undefined);

    const providerA = new MCPHubOAuthProvider('upstream', structuredClone(stored.current));
    const providerB = new MCPHubOAuthProvider('upstream', structuredClone(stored.current));

    const [stateA, stateB] = await Promise.all([
      runFlow(providerA, 'verifier-A'),
      runFlow(providerB, 'verifier-B'),
    ]);
    expect(stateA).not.toBe(stateB);

    const pending = stored.current.oauth?.pendingAuthorization;
    expect(pending?.state).toBeDefined();
    // The surviving pair must belong to a single flow, never (stateA, verifier-B).
    expect(pending?.codeVerifier).toBe(pending?.state === stateA ? 'verifier-A' : 'verifier-B');

    const winnerIsA = pending!.state === stateA;
    const winner = winnerIsA ? providerA : providerB;
    const loser = winnerIsA ? providerB : providerA;
    // The loser neither hands out its stale in-memory verifier nor falls back
    // to the winner's stored one; the winner's verifier is the stored one.
    await expect(winner.codeVerifier()).resolves.toBe(pending!.codeVerifier);
    await expect(loser.codeVerifier()).rejects.toThrow('superseded');

    const app = express();
    app.get('/oauth/callback', (req, res) => {
      void handleOAuthCallback(req, res);
    });

    // Stale flow callback: rejected before any token exchange.
    const stale = await request(app)
      .get('/oauth/callback')
      .query({
        code: 'auth-code',
        state: winnerIsA ? stateB : stateA,
        iss: 'https://as.example.com',
      });
    expect(stale.status).toBe(400);
    expect(finishAuth).not.toHaveBeenCalled();

    // Current flow callback: accepted (only one finishAuth call total).
    const fresh = await request(app)
      .get('/oauth/callback')
      .query({ code: 'auth-code', state: pending!.state!, iss: 'https://as.example.com' });
    expect(fresh.status).toBe(200);
    expect(finishAuth).toHaveBeenCalledTimes(1);
    expect(finishAuth).toHaveBeenCalledWith('auth-code', 'https://as.example.com');
    expect(serverInfo.status).toBe('connected');
  });
});

describe('callback waiting on the OAuth lock', () => {
  it('rejects a callback whose state was replaced by another flow while it waited for the lock', async () => {
    const stored = {
      current: {
        name: 'upstream',
        url: 'https://upstream.example.com/mcp',
        oauth: { clientId: 'client-id' },
      } as Stored,
    };
    installDao(stored);

    // Mimics the SDK: finishAuth() asks the transport's provider for the
    // verifier and exchanges the code with it.
    const exchange: { provider?: MCPHubOAuthProvider } = {};
    const verifiersExchanged: string[] = [];
    const finishAuth = jest.fn(async () => {
      verifiersExchanged.push(await exchange.provider!.codeVerifier());
    });
    const serverInfo = {
      name: 'upstream',
      config: structuredClone(stored.current),
      status: 'disconnected',
      oauth: undefined,
      transport: { finishAuth, close: jest.fn().mockResolvedValue(undefined) },
      client: { getServerCapabilities: jest.fn().mockReturnValue({}) },
      tools: [],
      prompts: [],
      resources: [],
    } as unknown as ServerInfo;
    const syncServerInfo = () => {
      serverInfo.config = structuredClone(stored.current);
    };
    jest.mocked(getServerByName).mockImplementation(() => serverInfo);
    jest.mocked(getServerByOAuthState).mockReturnValue(undefined);
    jest
      .mocked(getServerByPendingOAuthState)
      .mockImplementation((state) =>
        serverInfo.config?.oauth?.pendingAuthorization?.state === state ? serverInfo : undefined,
      );
    jest
      .mocked(createTransportFromConfig)
      .mockResolvedValue({ close: jest.fn() } as unknown as Awaited<
        ReturnType<typeof createTransportFromConfig>
      >);
    jest.mocked(connectClientWithDiagnostics).mockResolvedValue(undefined);

    const providerA = new MCPHubOAuthProvider('upstream', structuredClone(stored.current));
    const providerB = new MCPHubOAuthProvider('upstream', structuredClone(stored.current));

    const stateA = await runFlow(providerA, 'verifier-A');
    syncServerInfo();

    const app = express();
    app.get('/oauth/callback', (req, res) => {
      void handleOAuthCallback(req, res);
    });

    let stateB!: string;
    let callbackA!: Promise<request.Response>;
    // Hold the lock so callback A passes its pre-lock state check, then queues.
    await withOAuthPendingAuthLock('upstream', 'shared', async () => {
      callbackA = new Promise<request.Response>((resolve, reject) => {
        request(app)
          .get('/oauth/callback')
          .query({ code: 'code-A', state: stateA })
          .end((err, res) => (err ? reject(err) : resolve(res)));
      });
      // Callback A resolved its server (state valid) and is now waiting for the lock.
      await waitFor(() => jest.mocked(getServerByPendingOAuthState).mock.calls.length > 0);
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
      expect(finishAuth).not.toHaveBeenCalled();

      // Another flow replaces the pending state + verifier while A waits.
      stateB = await runFlow(providerB, 'verifier-B');
    });
    syncServerInfo();
    expect(stateB).not.toBe(stateA);
    expect(stored.current.oauth?.pendingAuthorization?.state).toBe(stateB);

    const responseA = await callbackA;
    expect(responseA.status).toBe(400);
    // A's code is never exchanged, and certainly not with B's verifier.
    expect(finishAuth).not.toHaveBeenCalled();
    expect(verifiersExchanged).toEqual([]);
    await expect(providerA.codeVerifier()).rejects.toThrow('superseded');

    // B's callback is unaffected and exchanges with its own verifier.
    exchange.provider = providerB;
    const responseB = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-B', state: stateB, iss: 'https://as.example.com' });
    expect(responseB.status).toBe(200);
    expect(finishAuth).toHaveBeenCalledTimes(1);
    expect(verifiersExchanged).toEqual(['verifier-B']);
  });
});

const waitFor = async (condition: () => boolean, attempts = 200) => {
  for (let i = 0; i < attempts; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition not met');
};
